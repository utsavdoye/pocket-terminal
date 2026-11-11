#!/usr/bin/env node
// Pocket Terminal from npm:
//
//   npx pocket-terminal            install (or update) and pair a phone
//   npx pocket-terminal pair       pair another phone
//   npx pocket-terminal list       phones that can connect
//   npx pocket-terminal remove N   lock a phone out (number or name, or "all")
//   npx pocket-terminal run CMD    run a command here AND on your phone (e.g. run claude)
//   npx pocket-terminal claude on  Claude Code's permission questions reach your phone when you're away
//   npx pocket-terminal activity   what your phones did here (connected, files, answers…)
//   npx pocket-terminal logs       what the agent is doing
//   npx pocket-terminal doctor     check the setup; prints a report for a bug report
//   npx pocket-terminal uninstall  remove it (add --purge to delete the pairing key too)
//
// npx keeps its copy in a cache that gets cleaned up, so the agent is copied to
// ~/.pocket-terminal/app first and runs from there, started by the same installer as always.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOME = process.env.POCKET_HOME || path.join(os.homedir(), '.pocket-terminal');
const APP = path.join(HOME, 'app');
const AGENT = path.join(APP, 'agent');
const WIN = process.platform === 'win32';
const VERSION = require('./package.json').version;
const [cmd = 'install', ...rest] = process.argv.slice(2);
process.env.POCKET_VIA_NPX = '1'; // so hints say "npx pocket-terminal pair", not "node pair.js"

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 18 || (maj === 18 && min < 20)) { console.error(`Pocket Terminal needs Node.js 18.20 or newer (you have ${process.versions.node}). Get the LTS from https://nodejs.org`); process.exit(1); }
if (!['darwin', 'linux', 'win32'].includes(process.platform)) { console.error('Pocket Terminal runs on macOS, Linux and Windows.'); process.exit(1); }

const run = (file, args, opts = {}) => {
  const r = spawnSync(file, args, { stdio: 'inherit', ...opts });
  if (r.error) { console.error(r.error.message); process.exit(1); }
  return r.status || 0;
};
const installed = () => fs.existsSync(path.join(AGENT, 'agent.js'));
const need = () => { if (!installed()) { console.error('Not installed yet. Run:  npx pocket-terminal'); process.exit(1); } };
// The installed agent is older than a feature needs (e.g. "claude on" with a 7.2 agent): say how to update.
const needFile = (file, what) => {
  need();
  if (fs.existsSync(path.join(AGENT, file))) return;
  let have = 'an older version'; try { have = fs.readFileSync(path.join(APP, 'VERSION'), 'utf8').trim(); } catch {}
  console.error(`${what} needs a newer Pocket Terminal on this computer (you have ${have}). Update first:\n\n  npx pocket-terminal@latest\n\nthen run this again.`);
  process.exit(1);
};

function copyAgent() {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  // Keep nothing old except the installed packages folder (the installer refreshes it).
  fs.mkdirSync(AGENT, { recursive: true });
  for (const f of fs.readdirSync(AGENT)) if (f !== 'node_modules') fs.rmSync(path.join(AGENT, f), { recursive: true, force: true });
  const src = path.join(__dirname, 'agent'); // npx itself lives in a node_modules folder: only look inside agent/
  fs.cpSync(src, AGENT, { recursive: true, filter: (f) => !/^node_modules([\\/]|$)/.test(path.relative(src, f)) });
  for (const f of ['install.sh', 'install-linux.sh', 'uninstall.sh']) { try { fs.chmodSync(path.join(AGENT, f), 0o755); } catch {} }
  fs.writeFileSync(path.join(APP, 'VERSION'), VERSION + '\n');
}

function install() {
  const was = installed() ? (fs.readFileSync(path.join(APP, 'VERSION'), 'utf8').trim() || 'an older version') : null;
  console.log(was ? `Updating Pocket Terminal ${was} → ${VERSION}` : `Installing Pocket Terminal ${VERSION}`);
  copyAgent();
  const code = WIN
    ? run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(AGENT, 'install.ps1')], { cwd: AGENT })
    : run('bash', [path.join(AGENT, 'install.sh')], { cwd: AGENT });
  if (!code) {
    console.log('\nTip: start an agent here and keep it on your phone too:  npx pocket-terminal run claude');
    if (fs.existsSync(path.join(os.homedir(), '.claude'))) console.log('Claude Code (also in VS Code): let its questions reach your phone:  npx pocket-terminal claude on');
  }
  process.exit(code);
}

// ---- Claude Code: add (or remove) our hook in ~/.claude/settings.json, keeping everything else ----
const CLAUDE = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK = path.join(AGENT, 'hook.js');
const ours = (h) => h && typeof h.command === 'string' && h.command.includes('hook.js') && h.command.includes('.pocket-terminal');
function claudeHooks(on) {
  let cfg = {};
  if (fs.existsSync(CLAUDE)) {
    try { cfg = JSON.parse(fs.readFileSync(CLAUDE, 'utf8')); } catch { console.error(`Could not read ${CLAUDE} (is it valid JSON?). Nothing changed.`); process.exit(1); }
    const bak = CLAUDE + '.before-pocket-terminal';
    if (!fs.existsSync(bak)) fs.copyFileSync(CLAUDE, bak);
  }
  const hooks = cfg.hooks && typeof cfg.hooks === 'object' ? cfg.hooks : {};
  for (const ev of Object.keys(hooks)) { // drop our old entries, keep yours
    if (!Array.isArray(hooks[ev])) continue;
    hooks[ev] = hooks[ev].map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !ours(h)) })).filter((g) => g.hooks.length);
    if (!hooks[ev].length) delete hooks[ev];
  }
  if (on) {
    const command = `"${process.execPath}" "${HOOK}"`;
    const add = (ev, timeout, matcher) => { (hooks[ev] = hooks[ev] || []).push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout }] }); };
    add('PermissionRequest', 3600, '*');
    add('UserPromptSubmit', 5); add('PreToolUse', 5, '*'); add('PostToolUse', 5, '*'); add('Stop', 5);
  }
  cfg.hooks = hooks; if (!Object.keys(hooks).length) delete cfg.hooks;
  fs.mkdirSync(path.dirname(CLAUDE), { recursive: true });
  fs.writeFileSync(CLAUDE, JSON.stringify(cfg, null, 2) + '\n');
}
function claude(sub) {
  const isOn = () => { try { return JSON.stringify(JSON.parse(fs.readFileSync(CLAUDE, 'utf8')).hooks || {}).includes('.pocket-terminal'); } catch { return false; } };
  if (sub === 'on') {
    needFile('hook.js', '"claude on"'); claudeHooks(true);
    console.log(`Claude Code is connected to Pocket Terminal.

  • Away from the computer? Its permission questions go to your phone: Allow or Deny there.
    At the computer, they show on screen as usual.
  • While it works, the computer stays awake, even with the lid closed.
  • Your phone tells you when it finishes.

Works in the terminal, VS Code and the desktop app. Restart Claude Code to pick it up.
Turn off:  npx pocket-terminal claude off`);
  } else if (sub === 'off') { claudeHooks(false); console.log('Claude Code is no longer connected to Pocket Terminal.'); }
  else console.log(isOn() ? 'Claude Code is connected. (npx pocket-terminal claude off to stop)' : 'Not connected. Run:  npx pocket-terminal claude on');
}

const node = (args) => process.exit(run(process.execPath, [path.join(AGENT, 'pair.js'), ...args], { cwd: AGENT }));

switch (cmd) {
  case 'install': case 'update': case 'i': install(); break;
  case 'pair': need(); node(rest); break;
  case 'list': need(); node(['--list']); break;
  case 'remove': need(); if (!rest.length) { console.error('Which phone? See:  npx pocket-terminal list'); process.exit(1); } node(['--remove', ...rest]); break;
  case 'run': needFile('run.js', '"run"'); process.exit(run(process.execPath, [path.join(AGENT, 'run.js'), ...rest]));
  case 'claude': claude(rest[0]); break;
  case 'activity': { // what your phones did here (never what was typed)
    needFile('lib/activity.js', '"activity"');
    const a = require(path.join(AGENT, 'lib', 'activity.js'));
    const list = a.read(HOME, Number(rest[0]) || 50);
    console.log(list.length ? list.map(a.line).join('\n') : 'Nothing yet. Phones connecting, files, answers and live-view links show up here.');
    console.log('\nNever what you typed or what commands printed. Lock a phone out:  npx pocket-terminal remove N');
    break;
  }
  case 'logs': {
    const log = path.join(HOME, 'agent.log');
    if (!fs.existsSync(log)) { console.error('No log yet.'); process.exit(1); }
    process.exit(WIN ? run('powershell.exe', ['-NoProfile', '-Command', `Get-Content -Wait -Tail 40 '${log}'`]) : run('tail', ['-n', '40', '-f', log]));
    break;
  }
  case 'doctor': process.exit(run(process.execPath, [path.join(__dirname, 'agent', 'doctor.js')])); break; // works before (and without) an install
  case 'uninstall': need(); process.exit(WIN
    ? run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(AGENT, 'uninstall.ps1'), ...(rest.includes('--purge') ? ['-Purge'] : [])])
    : run('bash', [path.join(AGENT, 'uninstall.sh'), ...rest]));
    break;
  case 'version': case '-v': case '--version': console.log(VERSION); break;
  default:
    console.log(`Pocket Terminal ${VERSION}: your computer's terminal on your phone.

  npx pocket-terminal            install or update, then pair a phone
  npx pocket-terminal pair       pair another phone
  npx pocket-terminal run CMD    run a command here and on your phone (e.g. run claude)
  npx pocket-terminal claude on  Claude Code asks your phone when you're away
  npx pocket-terminal list       phones that can connect
  npx pocket-terminal remove N   lock a phone out (number, name or "all")
  npx pocket-terminal activity   what your phones did here
  npx pocket-terminal logs       what it's doing
  npx pocket-terminal doctor     something not working? check the setup
  npx pocket-terminal uninstall  remove it (--purge also deletes the pairing key)`);
}
