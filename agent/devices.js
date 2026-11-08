// Every paired phone has its own key and its own private mailbox (see pair.js).
// This runs one direct-mode connection per phone and follows direct.json: pair or remove
// a phone and the agent picks it up within a few seconds, no restart needed.
//
// It also owns what phones share: phone notification addresses (push-subs.json) and
// live-view links (shares.json), each its own little mailbox that can only watch.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { startDirect } = require('./direct');
const webpush = require('./lib/webpush');
const { newSecret } = require('./lib/crypto');
const activity = require('./lib/activity');

const DEFAULT_APP = 'https://pocket-terminal.utsavdoye.com/app/';

function startDevices({ core, power, log, dir }) {
  const FILE = path.join(dir, 'direct.json');
  const SUBS = path.join(dir, 'push-subs.json');
  const SHARES = path.join(dir, 'shares.json');
  const running = new Map(); // device id -> { t, secret, name }
  const watching = new Map(); // share id -> { t, timer }
  const want = new Map(), conn = new Map();
  const any = (m) => [...m.values()].some(Boolean);
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const writeJson = (f, v) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 }); fs.renameSync(tmp, f); };
  let pushKeys = null; try { pushKeys = webpush.loadKeys(dir); } catch (e) { log('phone notifications unavailable: ' + e.message); }
  let cfg = {};

  // Each phone's connection gets a view of the power brain; "a phone wants me awake"
  // is true if ANY phone wants it.
  const powerFor = (id) => power && new Proxy(power, {
    get(t, k) {
      if (k === 'setPhoneWanting') return (v) => { want.set(id, !!v); t.setPhoneWanting(any(want)); };
      if (k === 'setConnected') return (v) => { conn.set(id, !!v); t.setConnected(any(conn)); };
      const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
    },
  });

  // --- phone notification addresses, per phone ---
  const subsOf = (id) => (readJson(SUBS, {})[id] || []);
  const saveSub = (id, sub) => {
    const all = readJson(SUBS, {}); const list = (all[id] || []).filter((s) => s.endpoint !== sub.endpoint);
    list.push({ endpoint: String(sub.endpoint), keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } });
    all[id] = list.slice(-3); writeJson(SUBS, all); log('phone notifications turned on');
  };
  const removeSub = (id, endpoint) => {
    const all = readJson(SUBS, {}); all[id] = (all[id] || []).filter((s) => s.endpoint !== endpoint);
    if (!all[id].length) delete all[id]; writeJson(SUBS, all);
  };

  // --- live-view links: a one-off key that can only watch one session, for a limited time ---
  const sharesAll = () => readJson(SHARES, []).filter((s) => s.expires > Date.now());
  function startWatch(sh) {
    if (watching.has(sh.id)) return;
    const t = startDirect({ cfg: { ...cfg, secret: sh.secret, deviceId: sh.deviceId, role: 'viewer', watchKey: sh.key, canAnswer: !!sh.canAnswer, stateFile: `state-share-${sh.id}.json`, notify: false },
      core, power: null, log: (...a) => log(`[share ${sh.id.slice(0, 4)}]`, ...a), dir, x: { activity: (ev) => activity.record(dir, { phone: 'live-view link', ...ev }) } });
    const timer = setTimeout(() => stopWatch(sh.id), Math.min(sh.expires - Date.now(), 2 ** 31 - 1));
    watching.set(sh.id, { t, timer });
  }
  function stopWatch(id) {
    const w = watching.get(id); if (!w) return;
    clearTimeout(w.timer); watching.delete(id);
    try { w.t.closeAll(); } catch {} setTimeout(() => w.t.stop(), 500);
    try { fs.rmSync(path.join(dir, `state-share-${id}.json`), { force: true }); } catch {}
    writeJson(SHARES, readJson(SHARES, []).filter((s) => s.id !== id && s.expires > Date.now()));
    log(`live view link ${id.slice(0, 4)} ended`);
  }
  const shareX = (deviceId) => ({
    share: (key, minutes, canAnswer = false) => {
      minutes = Math.min(24 * 60, Math.max(5, minutes));
      const sh = { id: crypto.randomBytes(6).toString('hex'), secret: newSecret(), deviceId, key, canAnswer: !!canAnswer, expires: Date.now() + minutes * 60e3 };
      writeJson(SHARES, [...sharesAll(), sh]); startWatch(sh);
      const params = new URLSearchParams({ watch: sh.secret, name: cfg.name || os.hostname() });
      if ((cfg.boards || []).join(',') !== 'https://ntfy.sh') params.set('boards', (cfg.boards || []).join(','));
      log(`live view link made (${minutes} min${canAnswer ? ', can answer' : ''})`);
      const app = !cfg.appUrl || /^https:\/\/(utsavdoye(20122005)?\.github\.io\/pocket-terminal|terminal\.utsavdoye\.com\/app)\/?$/i.test(cfg.appUrl) ? DEFAULT_APP : cfg.appUrl; // the official app moved
      return { id: sh.id, link: app.replace(/#.*$/, '') + '#' + params, expires: sh.expires };
    },
    shares: () => sharesAll().filter((s) => s.deviceId === deviceId).map((s) => ({ id: s.id, expires: s.expires, canAnswer: !!s.canAnswer, sid: s.key.split(':').slice(1).join(':') })),
    unshare: (id) => { if (sharesAll().some((s) => s.id === id && s.deviceId === deviceId)) stopWatch(id); },
  });

  let warned = false;
  function sync() {
    try { cfg = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return; }
    const devices = Array.isArray(cfg.devices) ? cfg.devices : [];
    if (cfg.secret && !warned) { warned = true; log('the old reusable pairing code is no longer accepted. Pair again: node pair.js'); }
    for (const [id, r] of running) {
      const d = devices.find((x) => x.id === id);
      if (!d || d.secret !== r.secret) {
        if (!d) Promise.resolve(r.t.revoke && r.t.revoke()).catch(() => {}).finally(() => r.t.stop()); else r.t.stop();
        running.delete(id); want.delete(id); conn.delete(id);
        if (power) { power.setPhoneWanting(any(want)); power.setConnected(any(conn)); }
        if (!d) { // a removed phone loses its notifications and its live-view links too
          const all = readJson(SUBS, {}); if (all[id]) { delete all[id]; writeJson(SUBS, all); }
          for (const s of sharesAll()) if (s.deviceId === id) stopWatch(s.id);
        }
        log(`phone removed: ${r.name}`);
        if (!d) activity.record(dir, { phone: r.name, ev: 'removed' });
      }
    }
    for (const d of devices) {
      if (running.has(d.id) || typeof d.secret !== 'string') continue;
      const plog = (...a) => log(`[${d.name}]`, ...a);
      try {
        const x = { pushKeys, pushKey: pushKeys && webpush.publicKey(pushKeys), subs: () => subsOf(d.id), saveSub: (s) => saveSub(d.id, s), removeSub: (e) => removeSub(d.id, e), ...shareX(d.id), activity: (ev) => activity.record(dir, { phone: d.name, ...ev }) };
        const t = startDirect({ cfg: { ...cfg, secret: d.secret, deviceId: d.id, stateFile: `state-${d.id}.json`, role: 'owner' }, core, power: powerFor(d.id), log: plog, dir, x });
        running.set(d.id, { t, secret: d.secret, name: d.name });
        log(`phone ready: ${d.name}`);
      } catch (e) { log(`could not start ${d.name}: ${e.message}`); }
    }
    for (const sh of sharesAll()) if (running.has(sh.deviceId)) startWatch(sh);
    if (!running.size) log('no phones paired yet. Run: node pair.js');
  }

  // A program finished or is waiting for an answer: tell the phone whose session it is.
  core.events && core.events.on('alert', (ev) => {
    const owner = String(ev.key).split(':')[0];
    // "local:" belongs to the computer itself (started there, or an agent's hook): every phone hears it
    for (const [id, r] of running) if ((owner === 'local' || owner === id) && r.t.alert) Promise.resolve(r.t.alert(ev)).catch(() => {});
  });

  sync();
  fs.watchFile(FILE, { interval: 1500 }, sync);
  const each = (fn) => Promise.all([...running.values(), ...watching.values()].map((r) => Promise.resolve().then(() => fn(r.t)).catch(() => {})));
  return {
    onWake: () => each((t) => t.onWake()),
    onSleep: (s) => each((t) => t.onSleep(s)),
    onPower: (s) => { for (const r of running.values()) r.t.onPower(s); },
    stop: () => { fs.unwatchFile(FILE); for (const r of running.values()) r.t.stop(); for (const w of watching.values()) { clearTimeout(w.timer); w.t.stop(); } },
  };
}

module.exports = { startDevices };
