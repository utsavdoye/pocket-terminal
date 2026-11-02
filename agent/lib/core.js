// The part of the agent that actually does things on your computer:
//   - terminal sessions (zsh/bash/PowerShell) that keep running when your phone disconnects
//   - one-off commands ("jobs") that run on their own and report their output
//   - a watcher that notices when a program finishes, or stops to ask you something
//     (an AI coding agent waiting for "yes", a [y/N] prompt, "Press Enter…")
// Transports (direct P2P, or the optional relay) plug in as "clients" of a terminal session.

const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const pty = require('node-pty');

const BUFFER_LIMIT = 256 * 1024;
const JOB_TIMEOUT_MS = 10 * 60e3;
const JOB_OUTPUT_LIMIT = 64 * 1024;
const WIN = process.platform === 'win32';
// Terminal: zsh/bash on Mac/Linux, PowerShell on Windows (set POCKET_SHELL to change, e.g. pwsh.exe or cmd.exe).
const SHELL = process.env.POCKET_SHELL || (WIN ? 'powershell.exe' : process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'));
const SHELL_ARGS = WIN ? ['-NoLogo'] : ['-l'];
const SHELLS = new Set(['zsh', 'bash', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'login', 'powershell', 'pwsh', 'cmd', 'nu', path.basename(SHELL).replace(/\.exe$/i, '')]);
// One-off commands: run through the same shell so they behave like typing them.
const jobArgs = (cmd) => WIN
  ? (/cmd(\.exe)?$/i.test(SHELL) ? ['/d', '/s', '/c', cmd] : ['-NoProfile', '-NonInteractive', '-Command', cmd])
  : ['-lc', cmd];

// ---------- the watcher's rules ----------
const ANSI = /\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const plain = (s) => s.replace(ANSI, '').replace(/\r(?!\n)/g, '\n');
// "Is the screen asking me something?" Checked on the last few lines, once output goes quiet.
const ASKS = [
  /do you want to\b/i,                                   // Claude Code, Codex: "Do you want to proceed?"
  /(?:❯|›|>)\s*1\.\s*(?:yes|allow|approve)/i,            // numbered choice menus
  /\b1\.\s*yes\b[\s\S]{0,240}\b2\.\s/i,
  /[(\[]\s*(?:y\/n|y\/N|Y\/n|yes\/no)\s*[)\]]\s*[:?]?\s*$/im, // [y/N]  (yes/no)
  /press (?:enter|return|any key)/i,
  /^\s*\?\s.+(?:›|\(Y\/n\)|\(y\/N\)|:)\s*.*$/m,           // npm / inquirer style "? Pick one ›"
  /\b(?:allow|approve|proceed|continue|overwrite|confirm)\b[^\n]{0,80}\?\s*$/im,
  /(?:password|passphrase)[^\n]{0,40}:\s*$/im,           // sudo, ssh, git
];
const asksForInput = (tail) => ASKS.some((r) => r.test(tail));
const lastLine = (tail) => tail.split('\n').map((l) => l.trim()).filter(Boolean).slice(-1)[0] || '';
// The line that asks (has a "?", [y/N], "password:"…), else the last line.
const question = (tail) => { const ls = tail.split('\n').map((l) => l.trim()).filter(Boolean); return [...ls].reverse().find((l) => /\?|\[y\/n\]|\(y\/n\)|password|passphrase|press (enter|return|any key)/i.test(l)) || ls.slice(-1)[0] || ''; };
const isMenu = (tail) => /(?:^|\n)\s*(?:❯|›|>)?\s*1\.\s+\S[\s\S]*\n\s*2\.\s+\S/.test(tail);

function createCore({ log, power }) {
  const events = new EventEmitter();
  const ran = new Set();
  let running = 0;

  // Terminal sessions. Each phone app launch has its own session id: come back to the app and you
  // continue where you left off; open it fresh and you get a new terminal, while anything still
  // running (an AI agent, a build) stays alive in its own session and shows in the Sessions list.
  const sessions = new Map(); // key -> session
  const MAX_SESSIONS = 8;

  function getSession(key) {
    let s = sessions.get(key);
    if (!s) {
      s = { key, term: null, buffer: '', tail: '', clients: new Set(), last: Date.now(), created: Date.now(),
        lastOut: 0, program: null, progSince: 0, asked: false, quietT: null, burst: 0 };
      sessions.set(key, s); trim();
    }
    s.last = Date.now();
    return s;
  }
  function kill(s) { clearTimeout(s.quietT); try { s.term && s.term.kill(); } catch {} s.term = null; sessions.delete(s.key); busyChanged(); }
  // Windows can't name the running program, so there "printed something in the last 10 min" counts as running.
  const busy = (s) => !!s.program || (WIN && !!s.term && Date.now() - s.lastOut < 10 * 60e3);
  const idle = (s) => !s.clients.size && !busy(s) && !s.asked;
  function trim() { // too many? close the oldest one nobody is looking at and that isn't running anything
    while (sessions.size > MAX_SESSIONS) {
      const old = [...sessions.values()].filter(idle).sort((a, b) => a.last - b.last)[0]
        || [...sessions.values()].filter((s) => !s.clients.size).sort((a, b) => a.last - b.last)[0];
      if (!old) break; kill(old);
    }
  }
  const emit = (s, kind, extra = {}) => {
    const ev = { key: s.key, kind, program: s.program || extra.program || null, ...extra };
    for (const c of s.clients) { try { c({ t: 'alert', ...ev, key: undefined, sid: s.key.split(':').slice(1).join(':') }); } catch {} }
    events.emit('alert', ev);
  };

  // A program (not the shell) runs in the foreground: note when it started and when it ends.
  function foreground(s) {
    if (!s.term || WIN) return null; // Windows' terminal API can't tell us; the quiet rule covers it
    let p = null; try { p = s.term.process; } catch {}
    p = String(p || '').replace(/^-/, '').split('/').pop();
    return !p || SHELLS.has(p) ? null : p.slice(0, 40);
  }
  // "node" or "python" says little: Claude Code, Codex, Aider all run on one. Look at what it runs.
  const GENERIC = /^(node|python[\d.]*|ruby|bun|deno|java|perl|php)$/;
  function refine(s, p) {
    const tty = s.term && s.term._pty;
    if (WIN || !GENERIC.test(p) || !tty) return;
    execFile('ps', ['-o', 'stat=,args=', '-t', String(tty).replace('/dev/', '')], { timeout: 3000 }, (e, out) => {
      if (e || s.raw !== p) return;
      const fg = String(out).split('\n').map((l) => l.trim()).filter((l) => /^\S*\+/.test(l)).map((l) => l.replace(/^\S+\s+/, ''));
      for (const a of fg.reverse()) {
        const parts = a.split(/\s+/), bin = parts[0].split('/').pop();
        const script = parts.slice(1).find((x) => !x.startsWith('-'));
        if (GENERIC.test(bin) && script) { s.program = script.split('/').pop().replace(/\.(c|m)?js$|\.py$/, '').slice(0, 40) || p; return; }
      }
    });
  }
  function checkPrograms() {
    for (const s of sessions.values()) {
      const p = foreground(s);
      if (p === s.raw) continue;
      const was = s.program, since = s.progSince;
      s.raw = p; s.program = p; s.progSince = Date.now(); s.asked = false;
      if (p) refine(s, p);
      if (was && !p && Date.now() - since > 20e3) emit(s, 'done', { program: was, seconds: Math.round((Date.now() - since) / 1000) });
    }
    busyChanged();
  }
  let lastBusy = -1;
  function busyChanged() {
    // A program that printed something in the last 3 minutes and isn't waiting for you keeps
    // the computer awake on battery (an AI agent working with the lid closed).
    const n = [...sessions.values()].filter((s) => busy(s) && !s.asked && Date.now() - s.lastOut < 3 * 60e3).length;
    if (n !== lastBusy) { lastBusy = n; power && power.setBusy && power.setBusy(n); }
  }
  const watch = setInterval(checkPrograms, 2000); watch.unref && watch.unref();

  function onQuiet(s) {
    if (!s.term) return;
    const tail = s.tail.split('\n').slice(-12).join('\n');
    if (!s.asked && asksForInput(tail)) {
      s.asked = true; busyChanged();
      emit(s, 'input', { text: question(tail).slice(0, 120), menu: isMenu(tail) });
    } else if (WIN && s.burst && Date.now() - s.burst > 30e3 && !s.asked) {
      // Windows: no foreground-program info, so "busy for 30 s, then quiet for 15 s" means done.
      emit(s, 'quiet', { text: lastLine(tail).slice(0, 120) });
    }
    s.burst = 0;
  }

  function startShell(s, cols = 80, rows = 24) {
    s.buffer = ''; s.tail = '';
    const t = pty.spawn(SHELL, SHELL_ARGS, {
      name: 'xterm-256color', cols, rows, cwd: os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', POCKET_TERMINAL: '1', PROMPT_EOL_MARK: '' }, // no stray '%' after a screen replay
    });
    s.term = t;
    const send = (msg) => { for (const c of s.clients) { try { c(msg); } catch {} } };
    t.onData((d) => {
      s.buffer += d; if (s.buffer.length > BUFFER_LIMIT) s.buffer = s.buffer.slice(-BUFFER_LIMIT);
      s.tail = (s.tail + plain(d)).slice(-2000);
      const now = Date.now();
      if (!s.burst) s.burst = now;
      s.lastOut = now;
      clearTimeout(s.quietT); s.quietT = setTimeout(() => onQuiet(s), WIN ? 15e3 : 1200);
      send({ t: 'o', d });
    });
    t.onExit(() => { if (s.term === t) { s.term = null; s.program = null; busyChanged(); send({ t: 'o', d: '\r\n\x1b[33m[shell exited, press Enter for a new one]\x1b[0m\r\n' }); } });
  }
  function session(key) {
    const s = getSession(key);
    return {
      key, clients: s.clients,
      input: (d) => {
        power && power.activity(); s.last = Date.now();
        if (s.asked) { s.asked = false; busyChanged(); }
        if (WIN) s.burst = 0;
        if (!s.term) startShell(s); else s.term.write(d);
      },
      resize: (cols, rows) => {
        if (!(cols > 0 && rows > 0 && cols < 1000 && rows < 1000)) return;
        if (!s.term) startShell(s, cols, rows); else s.term.resize(cols, rows);
        for (const c of s.clients) { try { c({ t: 'size', cols, rows }); } catch {} } // people watching follow the new size
      },
      size: () => (s.term ? { cols: s.term.cols, rows: s.term.rows } : null),
      screen: () => s.buffer,
      hasShell: () => !!s.term,
    };
  }
  // A phone started a new session: close its older sessions that nobody is looking at and
  // that are just sitting at the prompt. Anything still running is kept.
  function dropOthers(prefix, keepKey) {
    checkPrograms();
    for (const s of [...sessions.values()]) if (s.key !== keepKey && s.key.startsWith(prefix) && idle(s)) kill(s);
  }
  function list(prefix) {
    checkPrograms();
    return [...sessions.values()].filter((s) => s.key.startsWith(prefix)).sort((a, b) => a.created - b.created).map((s) => ({
      sid: s.key.slice(prefix.length), program: s.program, busy: busy(s), running: !!s.term, waiting: s.asked,
      lastOut: s.lastOut || null, created: s.created, viewers: s.clients.size, line: lastLine(s.tail.split('\n').slice(-6).join('\n')).slice(0, 80),
    }));
  }
  function close(key) { const s = sessions.get(key); if (s) kill(s); }

  // The relay transport and older phones use one shared session.
  const legacy = session('shared');

  // Run one command by itself. Never runs the same id twice.
  function runJob(id, cmd, onDone) {
    if (ran.has(id) || typeof cmd !== 'string' || !cmd.trim() || cmd.length > 4000) return false;
    ran.add(id); if (ran.size > 2000) ran.delete(ran.values().next().value);
    log(`command ${id} started`); // the command text itself is never logged
    running++; power && power.setJobs(running);
    let out = '';
    const child = spawn(SHELL, jobArgs(cmd), { cwd: os.homedir(), env: process.env, windowsHide: true });
    const add = (d) => { out += d; if (out.length > JOB_OUTPUT_LIMIT) out = out.slice(-JOB_OUTPUT_LIMIT); };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const timer = setTimeout(() => { add('\n[stopped after 10 minutes]\n'); child.kill('SIGKILL'); }, JOB_TIMEOUT_MS);
    let done = false;
    const finish = (code, extra = '') => {
      if (done) return; done = true;
      clearTimeout(timer);
      running--; power && power.setJobs(running);
      onDone({ id, code, out: out + extra });
    };
    child.on('close', (code) => finish(code));
    child.on('error', (e) => finish(-1, String(e)));
    return true;
  }

  return {
    events, session, dropOthers, list, close, runJob,
    clients: legacy.clients, input: legacy.input, resize: legacy.resize, screen: legacy.screen, hasShell: legacy.hasShell,
    stop: () => { clearInterval(watch); for (const s of [...sessions.values()]) kill(s); },
  };
}

module.exports = { createCore, asksForInput, plain, SHELL };
