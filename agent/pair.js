#!/usr/bin/env node
// Pair a phone with this computer.
//
//   node pair.js                 show a ONE-TIME QR code, then approve the phone here
//   node pair.js --list          phones that can connect
//   node pair.js --remove NAME   lock one phone out (or --remove all)
//   node pair.js --app-url URL   use your own copy of the phone app
//   node pair.js --board URL     add a second message board (e.g. your own ntfy server)
//   node pair.js --name NAME     the name phones see for this computer
//
// The QR code works once, for 10 minutes, and only after you approve the phone here,
// with a 6-digit code that matches the one on the phone. Each phone gets its own key, so
// you can remove one phone without touching the others.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const qrcode = require('qrcode-terminal');
const { newSecret, derive, seal, open, msgId } = require('./lib/crypto');
const { Board, DEFAULT_BOARDS, boardsFor, sameAsDefault } = require('./lib/board');
const { codeFor, wrapFor } = require('./lib/pairing');

const DIR = process.env.POCKET_HOME || path.join(os.homedir(), '.pocket-terminal');
const FILE = path.join(DIR, 'direct.json');
const DEFAULT_APP = 'https://pocket-terminal.utsavdoye.com/app/';
const INVITE_MINUTES = 10;
// Hints say how YOU started it: through npx, or from the agent folder.
const VIA_NPX = !!process.env.POCKET_VIA_NPX;
const CMD = VIA_NPX ? 'npx pocket-terminal pair' : 'node pair.js';
const LIST = VIA_NPX ? 'npx pocket-terminal list' : 'node pair.js --list';
const REMOVE = VIA_NPX ? 'npx pocket-terminal remove' : 'node pair.js --remove';

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const flag = (name) => args.includes(name);

let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
cfg.name = arg('--name') || cfg.name || os.hostname().replace(/\.local$/, '');
// The official app moved from utsavdoye20122005.github.io/pocket-terminal to pocket-terminal.utsavdoye.com/app.
if (/^https:\/\/(utsavdoye(20122005)?\.github\.io\/pocket-terminal|terminal\.utsavdoye\.com\/app)\/?$/i.test(cfg.appUrl || '')) cfg.appUrl = DEFAULT_APP;
cfg.appUrl = arg('--app-url') || process.env.POCKET_APP_URL || cfg.appUrl || DEFAULT_APP;
// cfg.boards stays as it was saved (nothing saved, or only ntfy.sh: the default boards are used).
const extra = arg('--board'); if (extra) { cfg.boards = cfg.boards || ['https://ntfy.sh']; if (!cfg.boards.includes(extra)) cfg.boards.push(extra.replace(/\/+$/, '')); }
const boards = boardsFor(cfg.boards);
cfg.notify = cfg.notify !== false;
cfg.devices = Array.isArray(cfg.devices) ? cfg.devices : [];
if (cfg.secret) { delete cfg.secret; console.log('The old reusable QR code no longer works. Phones paired with it must pair again.\n'); }
const save = () => { fs.mkdirSync(DIR, { recursive: true, mode: 0o700 }); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 }); fs.renameSync(tmp, FILE); };
save();

if (flag('--list')) {
  if (!cfg.devices.length) console.log(`No phones paired yet. Run:  ${CMD}`);
  cfg.devices.forEach((d, i) => console.log(`${i + 1}. ${d.name}  (paired ${new Date(d.added).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})`));
  if (cfg.devices.length > 1) console.log(`The last one is the newest. Remove one with:  ${REMOVE} <number>`);
  process.exit(0);
}
if (flag('--remove')) {
  const norm = (x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const who = norm(args.slice(args.indexOf('--remove') + 1).filter((x) => !x.startsWith('--')).join(' '));
  const before = cfg.devices.length;
  const n = /^\d+$/.test(who) ? Number(who) : 0;
  cfg.devices = who === 'all' ? [] : cfg.devices.filter((d, i) => i + 1 !== n && norm(d.name) !== who && d.id !== who);
  save();
  console.log(before === cfg.devices.length ? `No phone called "${who}". See: ${LIST}` : `Removed. ${cfg.devices.length} phone(s) can still connect. It takes effect within a few seconds.`);
  process.exit(0);
}

// ---------- one-time invite ----------
const invite = newSecret();
const ik = derive(invite);
const params = new URLSearchParams({ join: invite, name: cfg.name });
if (!sameAsDefault(cfg.boards)) params.set('boards', boards.join(','));
const link = cfg.appUrl.replace(/#.*$/, '') + '#' + params.toString();
const started = Date.now();

if (flag('--print-link')) console.log('LINK ' + link); // for tests
else {
  console.log('iPhone: open Pocket Terminal from your Home Screen and tap "Scan QR code".');
  console.log('Android / first time: scan this with the phone camera.\n');
  qrcode.generate(link, { small: true });
  console.log(`\nOr copy this link and use "Paste pairing link" in the app:\n${link}\n`);
  console.log(`This code works ONCE, for ${INVITE_MINUTES} minutes, and only after you approve the phone here.`);
}
console.log('Waiting for your phone…');

const board = new Board(boards, ik.topic, { log: () => {} });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const joins = new Map(); // nonce -> join
let asking = false, finished = false;

function finish(code, msg) {
  if (finished) return; finished = true;
  if (msg) console.log(msg);
  board.stop(); rl.close();
  setTimeout(() => process.exit(code), 300);
}
const post = (obj) => board.publish(seal(ik, { id: msgId(), ts: Date.now(), from: 'mac', ...obj })).catch(() => {});

setTimeout(() => finish(1, `\nThe code expired. Run  ${CMD}  for a new one.`), INVITE_MINUTES * 60e3).unref();

board.stream(async (text) => {
  const m = open(ik, text);
  if (!m || m.from !== 'phone' || m.type !== 'join' || finished) return;
  if (typeof m.nonce !== 'string' || typeof m.pub !== 'string' || joins.has(m.nonce)) return;
  if (Number(m.ts) < started - 60e3) return;
  let code; try { code = codeFor(m.pub); } catch { return; }
  joins.set(m.nonce, m);
  if (joins.size > 1) {
    for (const j of joins.values()) await post({ type: 'denied', for: j.nonce, why: 'Two phones tried this code. Make a new one on your computer.' });
    return finish(1, `\n⚠️  A second phone tried to use this QR code, so someone else may have seen it.\n   Nothing was paired. Run  ${CMD}  again, somewhere private.`);
  }
  if (asking) return;
  asking = true;
  const device = String(m.device || 'Phone').replace(/[^\w .,'()-]/g, '').slice(0, 40) || 'Phone';
  console.log(`\nA phone wants to connect: ${device}`);
  console.log(`Its code:  ${code.slice(0, 3)} ${code.slice(3)}`);
  rl.question('Is this your phone, and does it show the same code? Type y to allow: ', async (ans) => {
    if (finished) return;
    if (joins.size > 1) return;
    if (!/^y(es)?$/i.test(ans.trim())) {
      await post({ type: 'denied', for: m.nonce, why: 'Your computer said no.' });
      return finish(1, 'Not paired.');
    }
    let name = device, n = 2; while (cfg.devices.some((d) => d.name === name)) name = `${device} ${n++}`;
    const dev = { id: msgId(), name, secret: newSecret(), added: new Date().toISOString() };
    cfg.devices.push(dev); save();
    require('./lib/activity').record(DIR, { phone: name, ev: 'paired' });
    await post({ type: 'welcome', for: m.nonce, wrap: wrapFor(m.pub, m.nonce, { secret: dev.secret, name: cfg.name, boards: sameAsDefault(cfg.boards) ? ['https://ntfy.sh'] : boards, device: name }) });
    console.log(`\n✅ Paired "${name}". It can connect now.`);
    console.log(`Notifications (optional): in the ntfy app, subscribe to  ${derive(dev.secret).notifyTopic}`);
    console.log(`Lock this phone out later with:  ${REMOVE} "${name}"`);
    finish(0);
  });
});
