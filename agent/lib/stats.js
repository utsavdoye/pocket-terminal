// How many computers use Pocket Terminal each week: one small "I'm here" a day to our own board.
//
// What is sent: a random id made on this computer (not linked to you, your phone, your pairing
// or anything else), the Pocket Terminal version and the kind of computer (darwin / linux / win32).
// Nothing else: no name, no folders, no IP address kept (the board keeps no request logs).
// The board stores, per week, only a one-way hash of (week + id), so this week's count can't
// be joined to next week's. Anyone can see the totals: https://pocket-terminal-board.utsavdoye.workers.dev/v1/stats
//
// Turn it off:  npx pocket-terminal stats off     (or POCKET_STATS=0)
//
//   startStats({ dir, log, version })   the first one ~10 min after start, then once a day

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BOARD = 'https://pocket-terminal-board.utsavdoye.workers.dev';
const DAY = 24 * 3600e3;
const offFile = (dir) => path.join(dir, 'stats-off');
const isOff = (dir) => process.env.POCKET_STATS === '0' || fs.existsSync(offFile(dir));
function setOff(dir, off) {
  if (off) fs.writeFileSync(offFile(dir), 'Weekly count turned off. Delete this file (or run: npx pocket-terminal stats on) to turn it on.\n', { mode: 0o600 });
  else try { fs.unlinkSync(offFile(dir)); } catch {}
}
function idOf(dir) {
  const f = path.join(dir, 'stats-id');
  try { const s = fs.readFileSync(f, 'utf8').trim(); if (/^[A-Za-z0-9_-]{16,32}$/.test(s)) return s; } catch {}
  const s = crypto.randomBytes(16).toString('base64url'); // 22 characters
  try { fs.writeFileSync(f, s + '\n', { mode: 0o600 }); } catch {}
  return s;
}

function startStats({ dir, log = () => {}, version }) {
  // Tests run with their own POCKET_HOME: they never count, unless they point it somewhere else.
  const url = process.env.POCKET_STATS_URL || (process.env.POCKET_HOME ? null : BOARD);
  if (!url || !dir) return { stop() {} };
  const send = async () => {
    if (isOff(dir)) return;
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 15e3);
      await fetch(url.replace(/\/+$/, '') + '/v1/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: idOf(dir), v: String(version || ''), os: process.platform }), signal: c.signal }).finally(() => clearTimeout(t));
    } catch {} // offline: try again tomorrow; never worth a log line
  };
  const first = setTimeout(send, Number(process.env.POCKET_STATS_FIRST_MS) || 10 * 60e3); first.unref && first.unref();
  const every = setInterval(send, DAY); every.unref && every.unref();
  return { stop() { clearTimeout(first); clearInterval(every); }, send };
}

module.exports = { startStats, isOff, setOff, BOARD };
