#!/usr/bin/env node
// npx pocket-terminal doctor
//
// Checks this computer's Pocket Terminal setup and prints a short report you can paste into a
// bug report. Each line says what's fine (✓), what to look at (!) and what's broken (✗), with
// the fix. The report never contains pairing keys, phone names, folder names or what you typed.
//
//   node doctor.js            the report
//   POCKET_DOCTOR_NET=0       skip the checks that need the internet (tests)

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const DIR = process.env.POCKET_HOME || path.join(os.homedir(), '.pocket-terminal');
const AGENT = path.join(DIR, 'app', 'agent');
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const NET = process.env.POCKET_DOCTOR_NET !== '0';
const VERSION = require('./package.json').version;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const sh = (file, args, ms = 5000) => new Promise((res) => execFile(file, args, { timeout: ms }, (err, out) => res({ ok: !err, out: String(out || '') })));
const get = async (url, ms = 6000) => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 0, text: String(e.cause && e.cause.code || e.name || e) }; } finally { clearTimeout(t); }
};
// Nothing private leaves in a report: the home folder becomes ~, long random strings (keys,
// mailbox names, ids) become …, and anything after "name" is dropped.
const HOME_RE = new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
const redact = (s) => String(s).replace(HOME_RE, '~').replace(/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)\S*/g, '~/…').replace(/pt-[-_A-Za-z0-9]{16,}/g, 'pt-…').replace(/[-_A-Za-z0-9]{24,}/g, '…').replace(/https?:\/\/[^\s/]+\/[^\s]+/g, (u) => u.split('/').slice(0, 3).join('/') + '/…');

const rows = [];
const add = (state, what, fix) => rows.push({ state, what, fix });
const ok = (what) => add('ok', what), warn = (what, fix) => add('warn', what, fix), bad = (what, fix) => add('bad', what, fix);

function newer(a, b) { // is version a newer than b?
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

async function versions() {
  let have = null; try { have = fs.readFileSync(path.join(DIR, 'app', 'VERSION'), 'utf8').trim(); } catch {}
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 18 || (maj === 18 && min < 20)) bad(`Node.js ${process.versions.node} is too old`, 'Install the LTS from https://nodejs.org (18.20 or newer).');
  else ok(`Node.js ${process.versions.node} on ${process.platform} ${os.release()} (${process.arch})`);
  if (!have) { bad('Pocket Terminal is not installed on this computer', 'Run:  npx pocket-terminal'); return null; }
  let latest = null;
  if (NET) { const r = await get('https://registry.npmjs.org/pocket-terminal/latest'); try { latest = JSON.parse(r.text).version; } catch {} }
  if (latest && newer(latest, have)) warn(`Pocket Terminal ${have} is installed; ${latest} is out`, 'Update:  npx pocket-terminal@latest');
  else ok(`Pocket Terminal ${have}${latest ? ' (the latest)' : ''}`);
  return have;
}

function running() {
  const sock = WIN ? `\\\\.\\pipe\\pocket-terminal-${crypto.createHash('sha256').update(path.resolve(DIR)).digest('hex').slice(0, 16)}` : path.join(DIR, 'ctl.sock');
  return new Promise((res) => {
    const c = net.connect(sock); const t = setTimeout(() => { c.destroy(); res(false); }, 2000);
    c.on('connect', () => { clearTimeout(t); c.destroy(); res(true); });
    c.on('error', () => { clearTimeout(t); res(false); });
  });
}

function phones(cfg) {
  const n = cfg && Array.isArray(cfg.devices) ? cfg.devices.length : 0;
  if (!cfg) return bad('No pairing found', 'Run:  npx pocket-terminal');
  if (!n) return warn('No phone is paired', 'Pair one:  npx pocket-terminal pair');
  ok(`${n} phone${n === 1 ? '' : 's'} paired`);
}

async function boards(cfg) {
  if (!NET) return;
  for (const b of require('./lib/board').boardsFor(cfg && cfg.boards)) {
    const host = String(b).split('/').slice(0, 3).join('/');
    const r = await get(String(b).replace(/\/+$/, '') + '/v1/health');
    if (r.status === 200) ok(`Message board ${host} answers`);
    else if (r.status === 429) warn(`Message board ${host} says: too many messages today from this internet connection`, 'It resets at midnight UTC. Until then, put the phone on mobile data or the computer on another network.');
    else bad(`Message board ${host} is not reachable (${r.status || r.text})`, 'Check this computer\'s internet. If a firewall blocks ntfy.sh, phones can\'t find this computer.');
    if (r.status === 200 && b !== 'https://ntfy.sh') ok('Networks that block a direct link (mobile data, strict Wi-Fi) go through this board');
  }
}

// Can this network do a direct link? Ask the same public helpers (STUN) the agent uses for this
// computer's address on the internet. No answer usually means a firewall that blocks UDP.
async function direct(cfg) {
  if (!NET) return;
  let ndc = null;
  for (const p of [path.join(AGENT, 'node_modules', 'node-datachannel'), 'node-datachannel']) { try { ndc = require(p); break; } catch {} }
  if (!ndc) return warn('Could not test the direct link (the link library is missing)', 'Run:  npx pocket-terminal   to install it again.');
  const found = await new Promise((res) => {
    let pc; const done = (v) => { try { pc && pc.close(); } catch {} res(v); };
    try {
      pc = new ndc.PeerConnection('doctor', { iceServers: (cfg && cfg.iceServers) || ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] });
      let got = false;
      pc.onLocalCandidate((c) => { if (/ typ srflx /.test(c)) { got = true; done(true); } });
      pc.onGatheringStateChange((s) => { if (s === 'complete') done(got); });
      pc.createDataChannel('doctor');
      setTimeout(() => done(got), 6000);
    } catch { done(null); }
  });
  try { ndc.cleanup && ndc.cleanup(); } catch {}
  if (found) ok('This network allows a direct link to the phone');
  else if (found === false) warn('This network may block the direct link (no answer from the address helpers)', 'Phones on the same Wi-Fi still connect. From outside, commands go by the slower backup route. Try another network or turn off a VPN.');
  else warn('Could not test the direct link');
}

function notifications() {
  const subs = readJson('push-subs.json');
  const n = subs ? Object.values(subs).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0) : 0;
  if (n) ok(`Phone notifications are on (${n} phone address${n === 1 ? '' : 'es'})`);
  else warn('No phone has notifications turned on', 'In the app: ⋯ → Settings → Phone notifications → Turn on.');
}

async function wakeups() {
  if (WIN) return ok('Wake-ups use Task Scheduler (no admin needed)');
  const tool = MAC ? '/usr/bin/pmset' : ['/usr/sbin/rtcwake', '/sbin/rtcwake', '/usr/bin/rtcwake'].find((p) => fs.existsSync(p));
  if (!tool) return warn('rtcwake is not installed, so a sleeping laptop can\'t wake itself', 'Install util-linux, then run the installer again.');
  const r = await sh(MAC ? '/usr/bin/sudo' : 'sudo', ['-n', '-l', tool]);
  if (r.ok) ok(`May set wake-up alarms (${path.basename(tool)})`);
  else warn('Not allowed to set wake-up alarms, so it can\'t be reached while asleep with the lid closed', 'Run the installer again and enter your password when it asks:  npx pocket-terminal');
}

function log() {
  const f = path.join(DIR, 'agent.log');
  let text = ''; try { const st = fs.statSync(f), fd = fs.openSync(f, 'r'), n = Math.min(st.size, 60000), b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, st.size - n); fs.closeSync(fd); text = b.toString(); } catch { return { last: null, errors: [] }; }
  const lines = text.split('\n').filter(Boolean);
  const at = (l) => { const t = Date.parse(l.slice(0, 24)); return Number.isFinite(t) ? t : null; };
  const last = lines.length ? at(lines[lines.length - 1]) : null;
  const errors = lines.filter((l) => /\b(error|failed|could not|cannot|unavailable|refused|denied|crash|exception)\b/i.test(l)).slice(-6).map(redact);
  return { last, errors };
}

(async () => {
  const have = await versions();
  const cfg = readJson('direct.json');
  let up = false;
  if (have) {
    up = await running();
    if (up) ok('The agent is running');
    else bad('The agent is not running', 'Start it:  npx pocket-terminal   (it also starts by itself when you log in)');
    phones(cfg);
  }
  if (have && up && !WIN) { // the terminal holder: terminals that survive a restart of the agent
    let pid = 0; try { pid = Number(fs.readFileSync(path.join(DIR, 'holder.pid'), 'utf8')); } catch {}
    let alive = false; try { alive = pid > 0 && (process.kill(pid, 0), true); } catch {}
    if (alive) ok('Terminals keep running when the agent restarts (terminal holder)');
    else warn('Terminals end when the agent restarts (the terminal holder is not running)', 'It starts with the agent. If this stays, look in ~/.pocket-terminal/holder.log');
  }
  await boards(cfg);
  if (have) { await direct(cfg); notifications(); await wakeups(); }
  const lg = log();
  if (have && lg.last) {
    const min = Math.round((Date.now() - lg.last) / 60e3);
    (up && min > 30 ? warn : ok)(`Last log line ${min < 1 ? 'just now' : min + ' min ago'}`);
  }
  const p = readJson('power.json');

  const mark = { ok: '✓', warn: '!', bad: '✗' };
  const n = { warn: rows.filter((r) => r.state === 'warn').length, bad: rows.filter((r) => r.state === 'bad').length };
  console.log(`Pocket Terminal doctor ${VERSION}\n`);
  for (const r of rows) { console.log(` ${mark[r.state]} ${r.what}`); if (r.fix) console.log(`     ${r.fix}`); }
  console.log(n.bad ? `\n${n.bad} thing${n.bad === 1 ? '' : 's'} to fix${n.warn ? `, ${n.warn} to look at` : ''}.` : n.warn ? `\nWorking, with ${n.warn} thing${n.warn === 1 ? '' : 's'} to look at.` : '\nEverything looks fine.');

  // The part to paste into a bug report.
  const out = ['```', `pocket-terminal doctor ${VERSION}`, ...rows.map((r) => `${mark[r.state]} ${redact(r.what)}`)];
  if (p) out.push(`power: speed=${p.speed || 'smart'} mode=${p.batteryMode || '-'} minBattery=${p.minBattery ?? '-'}`);
  if (lg.errors.length) out.push('recent problems in the log:', ...lg.errors.map((l) => '  ' + l.slice(0, 200)));
  out.push('```');
  console.log(`\nStill stuck? Open https://github.com/utsavdoye/pocket-terminal/issues/new and paste this\n(no keys, phone names or folder names are in it):\n\n${out.join('\n')}`);
  process.exit(n.bad ? 1 : 0);
})();
