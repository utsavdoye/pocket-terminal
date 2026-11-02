#!/usr/bin/env node
// Pocket Terminal from npm:
//
//   npx pocket-terminal            install (or update) and pair a phone
//   npx pocket-terminal pair       pair another phone
//   npx pocket-terminal list       phones that can connect
//   npx pocket-terminal remove N   lock a phone out (number or name, or "all")
//   npx pocket-terminal logs       what the agent is doing
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
  process.exit(code);
}

const node = (args) => process.exit(run(process.execPath, [path.join(AGENT, 'pair.js'), ...args], { cwd: AGENT }));

switch (cmd) {
  case 'install': case 'update': case 'i': install(); break;
  case 'pair': need(); node(rest); break;
  case 'list': need(); node(['--list']); break;
  case 'remove': need(); if (!rest.length) { console.error('Which phone? See:  npx pocket-terminal list'); process.exit(1); } node(['--remove', ...rest]); break;
  case 'logs': {
    const log = path.join(HOME, 'agent.log');
    if (!fs.existsSync(log)) { console.error('No log yet.'); process.exit(1); }
    process.exit(WIN ? run('powershell.exe', ['-NoProfile', '-Command', `Get-Content -Wait -Tail 40 '${log}'`]) : run('tail', ['-n', '40', '-f', log]));
    break;
  }
  case 'uninstall': need(); process.exit(WIN
    ? run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(AGENT, 'uninstall.ps1'), ...(rest.includes('--purge') ? ['-Purge'] : [])])
    : run('bash', [path.join(AGENT, 'uninstall.sh'), ...rest]));
    break;
  case 'version': case '-v': case '--version': console.log(VERSION); break;
  default:
    console.log(`Pocket Terminal ${VERSION}: your computer's terminal on your phone.

  npx pocket-terminal            install or update, then pair a phone
  npx pocket-terminal pair       pair another phone
  npx pocket-terminal list       phones that can connect
  npx pocket-terminal remove N   lock a phone out (number, name or "all")
  npx pocket-terminal logs       what it's doing
  npx pocket-terminal uninstall  remove it (--purge also deletes the pairing key)`);
}
