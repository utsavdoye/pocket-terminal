// The part of the agent that actually does things on your computer:
//   - terminal sessions (zsh/bash/PowerShell) that keep running when your phone disconnects
//   - one-off commands ("jobs") that run on their own and report their output
//   - a watcher that notices when a program finishes, or stops to ask you something
//     (an AI coding agent waiting for "yes", a [y/N] prompt, "Press Enter…")
// Transports (direct P2P, or the optional relay) plug in as "clients" of a terminal session.

const fs = require('fs');
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

// ---------- smart auto-approve ----------
// Off by default. When on, a question is answered "yes" by itself only if the screen shows one of
// your allowed words AND none of the risky ones. Anything else still asks you.
const RISKY = /\b(rm|rmdir|del|delete|remove|drop|truncate|force|--force|-f\b|push|deploy|publish|release|sudo|chmod|chown|kill|reset|revert|overwrite|format|mkfs|dd|curl|wget|install|uninstall|payment|secret|token|password|passphrase|prod|production|migrat)/i;
const DEFAULT_AUTO = { enabled: false, allow: ['npm test', 'npm run test', 'pytest', 'go test', 'cargo test', 'git status', 'git diff', 'ls', 'cat ', 'Read(', 'Read file', 'Search(', 'Grep'] };
function autoDecision(cfg, tail, text, menu) {
  if (!cfg || !cfg.enabled || !Array.isArray(cfg.allow) || !cfg.allow.length) return null;
  if (/password|passphrase/i.test(text)) return null;
  const screen = tail.toLowerCase();
  if (RISKY.test(tail)) return null;
  const hit = cfg.allow.map((a) => String(a).trim()).filter(Boolean).find((a) => screen.includes(a.toLowerCase()));
  if (!hit) return null;
  const c = choicesFor(text, menu).find((x) => x.a === 'yes');
  return c ? { d: c.d, rule: hit } : null;
}

function createCore({ log, power, dir }) {
  const events = new EventEmitter();
  const AUTO = dir ? path.join(dir, 'auto.json') : null;
  let auto = { ...DEFAULT_AUTO }; try { auto = { ...DEFAULT_AUTO, ...JSON.parse(fs.readFileSync(AUTO, 'utf8')) }; } catch {}
  const setAuto = (c) => {
    const allow = Array.isArray(c.allow) ? c.allow.map((x) => String(x).slice(0, 60)).filter((x) => x.trim()).slice(0, 40) : auto.allow;
    auto = { enabled: !!c.enabled, allow };
    if (AUTO) try { fs.writeFileSync(AUTO, JSON.stringify(auto, null, 2), { mode: 0o600 }); } catch {}
    log(`auto-approve ${auto.enabled ? 'on' : 'off'} (${auto.allow.length} rules)`);
    return auto;
  };
  const ran = new Set();
  let running = 0;

  // Terminal sessions. Each phone app launch has its own session id: come back to the app and you
  // continue where you left off; open it fresh and you get a new terminal, while anything still
  // running (an AI agent, a build) stays alive in its own session and shows in the Sessions list.
  const sessions = new Map(); // key -> session
  const asks = new Map(); // permission questions from agents outside Pocket Terminal: key -> { key, agent, text, cwd, at, done }
  const ext = new Map(); // agents outside Pocket Terminal, from their hooks: key -> { key, agent, cwd, since, last, busy, done }
  const EXT_BUSY_MS = 15 * 60e3; // no word from it for 15 min: stop keeping the computer awake for it
  const MAX_SESSIONS = 8;

  function getSession(key) {
    let s = sessions.get(key);
    if (!s) {
      s = { key, term: null, buffer: '', tail: '', clients: new Set(), last: Date.now(), created: Date.now(),
        lastOut: 0, program: null, progSince: 0, asked: false, quietT: null, burst: 0,
        askText: '', askMenu: false, askedAt: 0, done: null, cwd: null, cwdAt: 0, outN: 0, mark: 0 };
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
      // A new program means any old question is gone. A program that just ended may have been
      // followed straight away by a question from the shell (seen < 3 s ago): keep that one.
      if (p || !(s.asked && Date.now() - s.askedAt < 3000)) s.asked = false;
      s.raw = p; s.program = p; s.progSince = Date.now();
      if (p) { refine(s, p); s.done = null; }
      if (was && !p && Date.now() - since > 20e3) {
        s.done = { program: was, at: Date.now(), seconds: Math.round((Date.now() - since) / 1000), changes: null };
        const d = s.done;
        changesIn(s, (ch) => { d.changes = ch; emit(s, 'done', { program: was, seconds: d.seconds, changes: ch }); });
      }
    }
    busyChanged();
  }
  let lastBusy = -1;
  function busyChanged() {
    // A program that printed something in the last 3 minutes and isn't waiting for you keeps
    // the computer awake on battery (an AI agent working with the lid closed).
    const n = [...sessions.values()].filter((s) => busy(s) && !s.asked && Date.now() - s.lastOut < 3 * 60e3).length
      + [...ext.values()].filter((e) => e.busy && Date.now() - e.last < EXT_BUSY_MS).length;
    if (n !== lastBusy) { lastBusy = n; power && power.setBusy && power.setBusy(n); }
  }
  const watch = setInterval(checkPrograms, 2000); watch.unref && watch.unref();

  // Only what appeared after your last keystroke counts: an answered question stays in the
  // scrollback, and must not look like it's being asked again.
  const fresh = (s) => { const n = s.outN - s.mark; return n <= 0 ? '' : n >= s.tail.length ? s.tail : s.tail.slice(-n); };
  function onQuiet(s) {
    if (!s.term) return;
    const tail = fresh(s).split('\n').slice(-12).join('\n');
    if (!s.asked && asksForInput(tail)) {
      s.asked = true; s.askText = question(tail).slice(0, 120); s.askMenu = isMenu(tail); s.askedAt = Date.now(); busyChanged();
      const ok = autoDecision(auto, tail.split('\n').slice(-10).join('\n'), s.askText, s.askMenu); // just the agent's question box
      if (ok) { // answered by your own rule: tell the phone quietly, don't ask
        log(`auto-approved a question (rule: ${ok.rule.slice(0, 20)})`);
        setTimeout(() => { if (s.asked && s.term) session(s.key).input(ok.d); }, 800);
        emit(s, 'auto', { text: s.askText, rule: ok.rule });
      } else emit(s, 'input', { text: s.askText, menu: s.askMenu });
    } else if (WIN && s.burst && Date.now() - s.burst > 30e3 && !s.asked) {
      // Windows: no foreground-program info, so "busy for 30 s, then quiet for 15 s" means done.
      emit(s, 'quiet', { text: lastLine(tail).slice(0, 120) });
    }
    s.burst = 0;
  }

  function startShell(s, cols = 80, rows = 24, run = null) {
    s.buffer = ''; s.tail = '';
    // run: a command started from the computer ("npx pocket-terminal run claude"), with that
    // terminal's own folder and environment, so it behaves exactly as if typed there.
    const args = run ? (WIN ? ['-NoLogo', '-Command', run.cmd] : ['-c', run.cmd]) : SHELL_ARGS;
    const env = run && run.env && typeof run.env === 'object' ? run.env : process.env;
    let cwd = os.homedir(); if (run && run.cwd) { try { if (fs.statSync(run.cwd).isDirectory()) cwd = run.cwd; } catch {} }
    const t = pty.spawn(SHELL, args, {
      name: 'xterm-256color', cols, rows, cwd,
      env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', POCKET_TERMINAL: '1', PROMPT_EOL_MARK: '' }, // no stray '%' after a screen replay
    });
    s.term = t;
    const send = (msg) => { for (const c of s.clients) { try { c(msg); } catch {} } };
    t.onData((d) => {
      s.buffer += d; s.total = (s.total || 0) + d.length; if (s.buffer.length > BUFFER_LIMIT) s.buffer = s.buffer.slice(-BUFFER_LIMIT);
      const pd = plain(d); s.tail = (s.tail + pd).slice(-2000); s.outN += pd.length;
      const now = Date.now();
      if (!s.burst) s.burst = now;
      s.lastOut = now;
      clearTimeout(s.quietT); s.quietT = setTimeout(() => onQuiet(s), WIN ? 15e3 : 1200);
      send({ t: 'o', d });
    });
    t.onExit(({ exitCode } = {}) => {
      if (s.term !== t) return;
      s.term = null; s.program = null; busyChanged();
      send({ t: 'o', d: run ? `\r\n\x1b[33m[finished${exitCode ? `, exit code ${exitCode}` : ''}. Press Enter for a new shell]\x1b[0m\r\n` : '\r\n\x1b[33m[shell exited, press Enter for a new one]\x1b[0m\r\n' });
      send({ t: 'exit', code: exitCode || 0 });
    });
  }
  function session(key) {
    const s = getSession(key);
    return {
      key, clients: s.clients,
      input: (d) => {
        power && power.activity(); s.last = Date.now(); s.mark = s.outN;
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
      // The screen for a viewer of this size. Same size: the history as is. A different size (a
      // session shared with the computer's own window): resize, let the program redraw itself for
      // the new size, and give just that redraw on a clean screen. Replaying output drawn for
      // another width is what makes full-screen apps (Claude Code, vim…) look broken.
      fit: (cols, rows, cb) => {
        const ok = cols > 0 && rows > 0 && cols < 1000 && rows < 1000;
        if (!s.term) { if (ok) startShell(s, cols, rows); return cb(s.buffer); } // a new terminal starts at this size
        if (!ok || (s.term.cols === cols && s.term.rows === rows)) return cb(s.buffer);
        const mark = s.total || 0, t0 = Date.now();
        s.term.resize(cols, rows);
        for (const c of s.clients) { try { c({ t: 'size', cols, rows }); } catch {} }
        checkPrograms();
        if (!s.program) return cb(s.buffer); // just a shell: keep its history (it only redraws its prompt)
        const check = () => {
          const fresh = (s.total || 0) - mark, quiet = Date.now() - s.lastOut;
          if (fresh > 0 && quiet >= 250 || Date.now() - t0 > 1500) {
            if (fresh > 0 && fresh <= s.buffer.length) return cb('\x1b[H\x1b[2J\x1b[3J' + s.buffer.slice(-fresh));
            return cb(s.buffer); // nothing redrew (a plain shell): the history is fine as is
          }
          setTimeout(check, 80);
        };
        setTimeout(check, 120);
      },
      hasShell: () => !!s.term,
    };
  }
  // Start a command in a new session (from the computer). Returns the session.
  function runIn(key, run, cols, rows) {
    const s = getSession(key);
    if (!s.term) startShell(s, cols > 0 && cols < 1000 ? cols : 80, rows > 0 && rows < 1000 ? rows : 24, run);
    return session(key);
  }

  // ---- AI agents running outside Pocket Terminal (e.g. Claude Code in VS Code), via their hooks ----
  // A permission question waits here until a phone answers, the computer answers it, or it's dropped.
  function ask({ agent, text, cwd }) {
    const key = 'local:Q-' + Math.random().toString(36).slice(2, 10);
    let done;
    const p = new Promise((res) => { done = res; });
    const a = { key, agent: String(agent || 'AI agent').slice(0, 40), text: String(text || '').slice(0, 300), cwd: tidy(cwd), at: Date.now(), done };
    asks.set(key, a);
    log(`${a.agent} asks for permission (sent to the phone)`); // what it asks is never logged
    events.emit('alert', { key, kind: 'input', program: a.agent, text: a.text, ask: true, cwd: a.cwd,
      choices: [{ a: 'yes', title: 'Allow', d: 'yes' }, { a: 'no', title: 'Deny', d: 'no' }] });
    const end = (v) => { if (!asks.has(key)) return; asks.delete(key); done(v); events.emit('alert', { key, kind: 'gone' }); };
    return { key, decision: p, cancel: () => end(null), settle: end };
  }
  // Working / finished, from the agent's own hooks. Keeps the computer awake while it works.
  function extEvent({ session, agent, cwd, kind, away = true }) {
    const id = String(session || 'x').replace(/[^\w-]/g, '').slice(0, 12) || 'x';
    const key = 'local:C-' + id, now = Date.now();
    let e = ext.get(key);
    if (!e) { e = { key, agent: String(agent || 'AI agent').slice(0, 40), cwd: null, since: now, last: now, busy: false, done: null, dir: null }; ext.set(key, e); }
    if (cwd) { e.dir = String(cwd); e.cwd = tidy(e.dir); }
    e.last = now;
    if (kind === 'stop') {
      if (e.busy) {
        e.busy = false;
        const seconds = Math.round((now - e.since) / 1000), d = { program: e.agent, at: now, seconds, changes: null }; e.done = d;
        gitChanges(e.dir, (ch) => { d.changes = ch; if (seconds >= 20 && away !== false) events.emit('alert', { key, kind: 'done', program: e.agent, seconds, changes: ch }); });
      }
    } else if (!e.busy) { e.busy = true; e.since = now; e.done = null; }
    for (const [k, x] of ext) if (now - x.last > 2 * 3600e3) ext.delete(k); // forget agents unheard of for 2 h
    busyChanged();
  }

  // A phone started a new session: close its older sessions that nobody is looking at and
  // that are just sitting at the prompt. Anything still running is kept.
  function dropOthers(prefix, keepKey) {
    checkPrograms();
    for (const s of [...sessions.values()]) if (s.key !== keepKey && s.key.startsWith(prefix) && idle(s)) kill(s);
  }
  function list(prefix) {
    checkPrograms();
    const extra = prefix !== 'local:' ? [] : [
      ...[...asks.values()].map((a) => ({ sid: a.key.slice(6), program: a.agent, ask: true, busy: false, running: true, waiting: true, lastOut: a.at, created: a.at, viewers: 0, line: '',
        question: a.text, menu: false, askedAt: a.at, since: null, done: null, cwd: a.cwd })),
      ...[...ext.values()].map((e) => ({ sid: e.key.slice(6), program: e.busy ? e.agent : null, ext: true, agent: e.agent, busy: e.busy, running: true, waiting: false, lastOut: e.last, created: e.since, viewers: 0, line: '',
        question: null, menu: false, askedAt: null, since: e.busy ? e.since : null, done: e.done, cwd: e.cwd })),
    ];
    return extra.concat([...sessions.values()].filter((s) => s.key.startsWith(prefix)).sort((a, b) => a.created - b.created).map((s) => ({
      sid: s.key.slice(prefix.length), program: s.program, busy: busy(s), running: !!s.term, waiting: s.asked,
      lastOut: s.lastOut || null, created: s.created, viewers: s.clients.size, line: lastLine(s.tail.split('\n').slice(-6).join('\n')).slice(0, 80),
      // for the agents dashboard: what it asks, since when it runs, what just finished, where it runs
      question: s.asked ? s.askText : null, menu: s.asked ? s.askMenu : false, askedAt: s.asked ? s.askedAt : null,
      since: s.program ? s.progSince : null, done: s.done, cwd: cwdOf(s),
    })));
  }
  // The folder a terminal is in (its shell's working folder). Cached; refreshed in the background.
  const home = os.homedir();
  const tidy = (d) => (d && d.startsWith(home) ? '~' + d.slice(home.length) : d) || null;
  function cwdOf(s) {
    const pid = s.term && s.term.pid;
    if (pid && Date.now() - s.cwdAt > 5000) {
      s.cwdAt = Date.now();
      if (process.platform === 'linux') { try { s.cwd = tidy(fs.readlinkSync(`/proc/${pid}/cwd`)); } catch {} }
      else if (process.platform === 'darwin') {
        execFile('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 3000 }, (e, out) => {
          const l = !e && String(out).split('\n').find((x) => x.startsWith('n')); if (l) s.cwd = tidy(l.slice(1));
        });
      }
    }
    return s.cwd;
  }
  // What changed in the terminal's folder (git): files, lines added/removed. null if it isn't a git folder.
  function folderOf(s, cb) {
    const pid = s.term && s.term.pid; if (!pid) return cb(null);
    if (process.platform === 'linux') { try { return cb(fs.readlinkSync(`/proc/${pid}/cwd`)); } catch { return cb(null); } }
    if (process.platform === 'darwin') return execFile('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 3000 }, (e, out) => { const l = !e && String(out).split('\n').find((x) => x.startsWith('n')); cb(l ? l.slice(1) : null); });
    cb(null);
  }
  function changesIn(s, cb) { folderOf(s, (dirp) => gitChanges(dirp, cb)); }
  function gitChanges(dirp, cb) {
    {
      if (!dirp) return cb(null);
      execFile('git', ['-C', dirp, 'diff', '--numstat', 'HEAD'], { timeout: 5000, maxBuffer: 1 << 20 }, (e, out) => {
        if (e) return cb(null);
        let files = 0, add = 0, del = 0;
        for (const l of String(out).split('\n')) { const m = l.match(/^(\d+|-)\t(\d+|-)\t/); if (m) { files++; add += +m[1] || 0; del += +m[2] || 0; } }
        execFile('git', ['-C', dirp, 'ls-files', '--others', '--exclude-standard'], { timeout: 5000, maxBuffer: 1 << 20 }, (e2, o2) => {
          const fresh = e2 ? 0 : String(o2).split('\n').filter(Boolean).length;
          cb({ files: files + fresh, add, del, fresh });
        });
      });
    }
  }
  // The full change list (git diff) of a terminal's folder, for "See changes" on the phone.
  function diff(key, cb) {
    const e = ext.get(key), s = sessions.get(key); if (!s && !e) return cb({ error: 'That terminal is gone.' });
    (e ? (f) => f(e.dir) : (f) => folderOf(s, f))((dirp) => {
      if (!dirp) return cb({ error: 'Could not find its folder.' });
      execFile('git', ['-C', dirp, 'diff', '--no-color', '--stat', '-p', 'HEAD'], { timeout: 8000, maxBuffer: 4 << 20 }, (e, out) => {
        if (e) return cb({ error: /not a git repository/i.test(String(e.message)) ? 'This folder is not a git project, so there is no change list.' : 'git could not show the changes.' });
        execFile('git', ['-C', dirp, 'ls-files', '--others', '--exclude-standard'], { timeout: 5000 }, (e2, o2) => {
          const fresh = e2 ? [] : String(o2).split('\n').filter(Boolean);
          let text = String(out); const cut = text.length > 200e3; if (cut) text = text.slice(0, 200e3);
          cb({ folder: tidy(dirp), diff: text, cut, fresh: fresh.slice(0, 100) });
        });
      });
    });
  }
  // Answer a terminal that is waiting for you, without switching to it. Does nothing if it isn't waiting.
  function answer(key, d) {
    const a = asks.get(key);
    if (a) { if (d !== 'yes' && d !== 'no') return false; log(`${a.agent}: ${d === 'yes' ? 'allowed' : 'denied'} from the phone`); a.done(d); asks.delete(key); events.emit('alert', { key, kind: 'gone' }); return true; }
    const s = sessions.get(key);
    if (!s || !s.term || !s.asked || typeof d !== 'string' || !d || d.length > 16) return false;
    session(key).input(d); return true;
  }
  // Answer in your own words (voice or typed). On an AI agent's choice menu, Esc first: that's
  // "No, tell it what to do instead", then your words go in as the instruction.
  function reply(key, text) {
    const s = sessions.get(key);
    if (!s || !s.term || !s.asked || typeof text !== 'string') return false;
    text = text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim().slice(0, 500); if (!text) return false;
    const io = session(key);
    if (s.askMenu || /do you want/i.test(s.askText)) { io.input('\x1b'); setTimeout(() => s.term && s.term.write(text + '\r'), 600); }
    else io.input(text + '\r');
    return true;
  }
  function close(key) { const s = sessions.get(key); if (s) kill(s); if (ext.delete(key)) busyChanged(); }

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
    events, session, dropOthers, list, close, runJob, answer, reply, diff, getAuto: () => auto, setAuto, runIn, ask, extEvent,
    isSession: (key) => sessions.has(key),
    question: (key) => { const s = sessions.get(key); return s && s.asked ? { text: s.askText, menu: s.askMenu } : null; },
    clients: legacy.clients, input: legacy.input, resize: legacy.resize, screen: legacy.screen, hasShell: legacy.hasShell,
    stop: () => { clearInterval(watch); for (const s of [...sessions.values()]) kill(s); },
  };
}

// The one-tap answers that fit a question. The phone only ever sends the choice's name;
// what gets typed is decided here, on the computer.
function choicesFor(text, menu) {
  const t = String(text || '');
  if (menu || /(?:❯|›)\s*1\./.test(t) || /do you want/i.test(t)) return [{ a: 'yes', title: '1 · Yes', d: '1' }, { a: 'no', title: 'No (Esc)', d: '\x1b' }];
  if (/y\/n|yes\/no/i.test(t)) return [{ a: 'yes', title: 'Yes', d: 'y\r' }, { a: 'no', title: 'No', d: 'n\r' }];
  if (/password|passphrase/i.test(t)) return []; // never from a notification
  if (/press (?:enter|return|any key)/i.test(t)) return [{ a: 'yes', title: 'Enter', d: '\r' }];
  return [];
}

module.exports = { createCore, asksForInput, plain, SHELL, choicesFor, autoDecision };
