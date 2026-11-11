// Open the app and see something at once: while the link to the computer comes up (a few
// seconds, longer if it's asleep), the terminal shows the screen from last time, dimmed and
// marked as old. The live screen replaces it the moment the link is up.
//
// The saved screen is plain text, kept on this phone only and encrypted with this computer's
// pairing key, so it can't be read without your PIN any more than the pairing itself.

import { $ } from '../core/dom.js';
import { store } from '../core/store.js';
import { DEMO } from '../core/env.js';
import { state } from '../core/state.js';
import { seal, open } from '../crypto.js';
import { on } from '../connection/messages.js';

const name = () => 'screen:' + state.S.topic;
let live = false; // the computer has sent its screen in this launch

export async function showLastScreen(term) {
  if (DEMO) return;
  on('reset', () => { live = true; const t = $('staleTag'); if (t) t.remove(); $('term').classList.remove('stale'); });
  const saved = store.get(name()); if (!saved) return;
  const s = await open(state.keys, saved);
  if (live || !s || !Array.isArray(s.lines) || !s.lines.length) return;
  term.write('\x1b[2m' + s.lines.map((l) => String(l).slice(0, term.cols)).slice(-term.rows).join('\r\n') + '\x1b[0m');
  $('term').classList.add('stale');
  const tag = document.createElement('div'); tag.id = 'staleTag'; tag.className = 'stale-tag'; tag.textContent = 'From last time';
  $('term').appendChild(tag);
}

export function keepLastScreen(term) {
  if (DEMO) return;
  let timer = null;
  const save = async () => {
    timer = null; if (!live) return; // never save the old screen over itself
    const b = term.buffer.active, lines = [];
    for (let y = b.baseY; y < b.baseY + term.rows; y++) { const l = b.getLine(y); lines.push(l ? l.translateToString(true).slice(0, 300) : ''); }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) return;
    try { store.set(name(), await seal(state.keys, { at: Date.now(), lines })); } catch {}
  };
  term.onWriteParsed(() => { if (!timer) timer = setTimeout(save, 3000); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { clearTimeout(timer); save(); } });
}
