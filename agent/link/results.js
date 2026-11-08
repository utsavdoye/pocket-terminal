// What this computer reports back to the phone: its status (awake, asleep, battery),
// the results of commands, and power settings the phone changed.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { seal, msgId } = require('../lib/crypto');
const { MAX_NOTE } = require('../lib/board');

// Sets ctx.postStatus, ctx.deliver and ctx.applySettings. Needs ctx.board and ctx.post (mailbox.js).
function startResults(ctx) {
  const { cfg, power, log, dir, keys, peers, board, post } = ctx;
  let lastStatus = { state: null, at: 0, checkIn: null };

  // --- status: posted rarely, to stay well inside the board's free daily limit ---
  function statusBody(st) {
    const p = power ? power.status() : null;
    return { state: st, name: cfg.name || os.hostname(), os: process.platform, nextWake: p && st === 'sleeping' ? p.nextWake : null,
      checkIn: p ? p.nextCheckInMinutes : null, power: p ? { percent: p.percent, onCharger: p.onCharger, settings: p.settings } : null };
  }
  async function postStatus(st, { force = false } = {}) {
    const b = statusBody(st);
    const same = lastStatus.state === st && lastStatus.checkIn === b.checkIn && Date.now() - lastStatus.at < 60 * 60e3;
    if (same && !force) return;
    lastStatus = { state: st, at: Date.now(), checkIn: b.checkIn };
    await post('status', b);
  }

  // --- results: over the direct link if open, otherwise as an encrypted note ---
  async function deliver(r) {
    if (peers.size) { for (const s of peers.keys()) s({ t: 'result', ...r }); return; }
    let out = r.out;
    for (;;) { // shrink the output until the note fits on the board
      const sealed = seal(keys, { id: msgId(), ts: Date.now(), from: 'mac', type: 'result', cid: r.id, code: r.code, out });
      if (sealed.length <= MAX_NOTE || out.length < 50) { await board.publish(sealed).catch((e) => log('result post failed: ' + e.message)); break; }
      out = '…(start cut)…\n' + out.slice(Math.floor(out.length * 0.4));
    }
    if (cfg.notify !== false) {
      board.publish(r.code === 0 ? 'Command finished ✅' : `Command failed ❌ (exit ${r.code})`, keys.notifyTopic, { Title: 'Pocket Terminal' }).catch(() => {});
    }
  }

  function applySettings(p) {
    if (!power || !p || typeof p !== 'object') return;
    const allowed = ['enabled', 'awakeOnCharger', 'batteryMode', 'checkInMinutes', 'smartCheckIn', 'idleMinutes', 'minBattery', 'stopAlarmsBelow'];
    const next = {}; for (const k of allowed) if (k in p) next[k] = p[k];
    if ('checkInMinutes' in next) next.checkInMinutes = Math.min(120, Math.max(1, Number(next.checkInMinutes) || 5));
    if ('minBattery' in next) next.minBattery = Math.min(90, Math.max(5, Number(next.minBattery) || 20));
    if ('batteryMode' in next && !['saver', 'instant'].includes(next.batteryMode)) delete next.batteryMode;
    power.update(next);
    try { fs.writeFileSync(path.join(dir, 'power.json'), JSON.stringify(power.s, null, 2), { mode: 0o600 }); } catch {}
    log('power settings updated ' + JSON.stringify(next));
    for (const s of peers.keys()) s({ t: 'power', ...power.status() });
  }

  Object.assign(ctx, { postStatus, deliver, applySettings });
}

module.exports = { startResults };
