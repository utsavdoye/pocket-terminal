// What your phones did on this computer, for "npx pocket-terminal activity".
// One line per event: when, which phone, what (connected, opened a terminal, downloaded a
// file, answered a question, made a live-view link…). Never what you typed or what a
// command printed: keystrokes are only counted. The file is readable only by you and
// keeps about the last 2000 events.

const fs = require('fs');
const path = require('path');

const FILE = 'activity.log';
const MAX = 512 * 1024;

function record(dir, ev) {
  const f = path.join(dir, FILE);
  try {
    fs.appendFileSync(f, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n', { mode: 0o600 });
    if (fs.statSync(f).size > MAX) { // keep the newer half
      const s = fs.readFileSync(f, 'utf8'); fs.writeFileSync(f, s.slice(s.indexOf('\n', s.length / 2) + 1), { mode: 0o600 });
    }
  } catch {}
}

function read(dir, n = 50) {
  let s = ''; try { s = fs.readFileSync(path.join(dir, FILE), 'utf8'); } catch { return []; }
  return s.split('\n').filter(Boolean).slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// One line for people: "Sat 7 Nov 19:04  Utsav's iPhone  downloaded ~/notes.txt"
const WHAT = {
  connected: (e) => `connected${e.how ? ' ' + e.how : ''}`,
  disconnected: (e) => `disconnected${e.keys ? ` (typed ${e.keys} key${e.keys === 1 ? '' : 's'})` : ''}`,
  terminal: (e) => `opened terminal ${e.sid}`,
  command: () => 'ran a one-off command',
  answered: (e) => `answered a question${e.where ? ' ' + e.where : ''}`,
  download: (e) => `downloaded ${e.path}`,
  upload: (e) => `uploaded ${e.path}`,
  website: (e) => `opened localhost:${e.port}`,
  share: (e) => `made a live-view link (${e.minutes} min${e.canAnswer ? ', can answer' : ''})`,
  unshare: () => 'stopped a live-view link',
  'close-terminal': (e) => `closed terminal ${e.sid}`,
  notifications: (e) => `turned notifications ${e.on ? 'on' : 'off'}`,
  paired: () => 'was paired',
  removed: () => 'was removed',
};
function line(e) {
  const d = new Date(e.ts);
  const when = d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${when}  ${e.phone || 'a phone'}  ${(WHAT[e.ev] || (() => e.ev))(e)}`;
}

module.exports = { record, read, line };
