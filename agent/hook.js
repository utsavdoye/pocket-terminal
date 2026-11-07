#!/usr/bin/env node
// Claude Code hook (set up with "npx pocket-terminal claude on"). Claude Code runs this on its own
// events, wherever it runs: a terminal, the VS Code extension, the desktop app.
//
//   PermissionRequest  You're away from the computer: the question goes to your phone. Allow or
//                      Deny there and Claude carries on. At the computer (or back at it): the
//                      normal question shows on screen, as if this hook wasn't there.
//   other events       "working" / "finished": keeps the computer awake with the lid closed while
//                      Claude works, and tells your phone when it's done.
//
// It never gets in Claude's way: if Pocket Terminal isn't running, or anything goes wrong, it
// exits at once and Claude behaves exactly as without it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { connect, lines } = require('./lib/local');
const { idleSeconds } = require('./lib/idle');

const DIR = process.env.POCKET_HOME || path.join(os.homedir(), '.pocket-terminal');
const AGENT = 'Claude Code';
const MAX_WAIT = 50 * 60e3; // below the hook timeout set up by "claude on" (1 h)
const quit = (out) => { if (out) process.stdout.write(JSON.stringify(out)); process.exit(0); };
const settings = () => { try { return { mode: 'away', awaySeconds: 60, ...JSON.parse(fs.readFileSync(path.join(DIR, 'claude.json'), 'utf8')) }; } catch { return { mode: 'away', awaySeconds: 60 }; } };

// One short line saying what Claude wants to do.
function describe(tool, input = {}) {
  const short = (s, n = 160) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const file = (p) => short(String(p || '').replace(os.homedir(), '~'), 120);
  switch (tool) {
    case 'Bash': return `Run: ${short(input.command)}`;
    case 'Edit': case 'MultiEdit': return `Edit ${file(input.file_path)}`;
    case 'Write': return `Write ${file(input.file_path)}`;
    case 'NotebookEdit': return `Edit notebook ${file(input.notebook_path)}`;
    case 'WebFetch': return `Open ${short(input.url, 120)}`;
    case 'WebSearch': return `Search the web: ${short(input.query, 120)}`;
    default: return `Use ${short(tool, 60)}${input && typeof input === 'object' && Object.keys(input).length ? ': ' + short(JSON.stringify(input), 120) : ''}`;
  }
}

async function permission(h) {
  const cfg = settings();
  if (cfg.mode === 'off') return quit();
  const awayFor = Math.max(10, Number(cfg.awaySeconds) || 60);
  const idle = cfg.mode === 'always' ? null : await idleSeconds();
  if (cfg.mode !== 'always' && idle !== null && idle < awayFor) return quit(); // you're here: ask on screen as usual
  let c;
  try { c = await connect(DIR, { t: 'ask', agent: AGENT, text: describe(h.tool_name, h.tool_input), cwd: h.cwd }); } catch { return quit(); }
  const give = () => { try { c.destroy(); } catch {} quit(); }; // let the normal question show
  setTimeout(give, MAX_WAIT);
  // Back at the computer while it waits? Hand the question back to the screen.
  if (cfg.mode !== 'always') {
    setInterval(async () => { const i = await idleSeconds(); if (i !== null && i < 3) give(); }, 2000).unref();
  }
  if (cfg.mode !== 'always' && idle === null) setTimeout(give, 45e3); // can't tell if you're here: don't block the screen for long
  lines(c, (m) => {
    if (m.t !== 'decision') return;
    if (m.v === 'yes') quit({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    if (m.v === 'no') quit({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Denied from Pocket Terminal on the phone.' } } });
    quit();
  });
  c.on('close', () => quit());
}

async function event(h, kind) {
  try {
    let away = true; // "finished" only buzzes your phone when you're away from the computer
    if (kind === 'stop') { const cfg = settings(); if (cfg.mode === 'off') return quit(); if (cfg.mode !== 'always') { const i = await idleSeconds(); away = i === null || i >= Math.max(10, Number(cfg.awaySeconds) || 60); } }
    const c = await connect(DIR, { t: 'event', agent: AGENT, session: h.session_id, cwd: h.cwd, kind, away }, { timeout: 800 });
    c.on('data', () => c.end()); c.on('close', () => quit()); setTimeout(quit, 800);
  } catch { quit(); }
}

// Claude running inside a Pocket Terminal session ("npx pocket-terminal run claude", or started from
// the phone): Pocket Terminal already sees its questions on screen. Stay out, so nothing comes twice.
if (process.env.POCKET_TERMINAL === '1') process.exit(0);

let raw = '';
process.stdin.on('data', (d) => { raw += d; if (raw.length > 4 << 20) quit(); });
process.stdin.on('end', () => {
  let h; try { h = JSON.parse(raw); } catch { return quit(); }
  const ev = h.hook_event_name;
  if (ev === 'PermissionRequest') return permission(h).catch(() => quit());
  if (ev === 'Stop' || ev === 'SessionEnd') return event(h, 'stop');
  if (ev === 'UserPromptSubmit' || ev === 'PreToolUse' || ev === 'PostToolUse') return event(h, 'busy');
  quit();
});
setTimeout(() => { if (!raw) quit(); }, 3000);
