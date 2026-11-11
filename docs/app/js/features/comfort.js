// Look-and-feel settings that are about your hands, not the computer: bigger keys and
// vibration (on by default), drawing with the graphics chip, and typing ahead on a slow link. Text size lives with the terminal (term.js); turning the phone
// sideways just works (the terminal refits).

import { $ } from '../core/dom.js';
import { store } from '../core/store.js';

// Before anything else runs: with vibration off, every navigator.vibrate() in the app does nothing.
export function applyComfort() {
  document.body.classList.toggle('bigkeys', store.get('bigKeys') === true);
  if (store.get('haptics') === false && navigator.vibrate) {
    try { Object.defineProperty(navigator, 'vibrate', { value: () => false, configurable: true }); } catch {}
  }
}

export function setupComfort(relayout) {
  const seg = (id, key, def, after) => {
    const paint = () => document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === String(store.get(key, def))));
    document.querySelectorAll(`#${id} button`).forEach((b) => (b.onclick = () => { store.set(key, b.dataset.v === 'true'); paint(); after(b.dataset.v === 'true'); }));
    paint();
  };
  seg('bigKeysSeg', 'bigKeys', false, (on) => { document.body.classList.toggle('bigkeys', on); relayout(); });
  seg('hapticsSeg', 'haptics', true, (on) => { if (on) location.reload(); else applyComfort(); });
  seg('gpuSeg', 'gpu', true, () => location.reload()); // the terminal picks its drawing when it starts
  seg('echoSeg', 'echo', true, () => {});
}
