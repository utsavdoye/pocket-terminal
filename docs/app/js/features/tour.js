// First-run tour: three short cards the first time the app connects, then never again
// (Settings → About → Show the tour again). It sits above the key row and never blocks typing.

import { $, esc } from '../core/dom.js';
import { store } from '../core/store.js';
import { DEMO } from '../core/env.js';
import { state } from '../core/state.js';

const STEPS = [
  ['This is your terminal', 'Type with the phone keyboard. The row above it has Esc, Tab, Ctrl and arrows. Swipe up and down to scroll, left and right to switch terminals.'],
  ['Agents, commands and files', 'The bar at the bottom: see which AI agent needs you, send a command that runs even while the computer sleeps, or move files.'],
  ['More than one computer?', 'Tap the computer\'s name at the top to switch, or to pair another one. Your phone buzzes when something needs you.'],
];

export function showTour(force = false) {
  if (!force && (store.get('toured') || DEMO || state.S.viewer || navigator.webdriver)) return; // automated tests skip it
  let i = 0;
  const card = document.createElement('div'); card.className = 'tour'; card.setAttribute('role', 'dialog');
  const paint = () => {
    const [t, p] = STEPS[i];
    card.innerHTML = `<b>${esc(t)}</b><p>${esc(p)}</p><div class="tbar"><span class="tdots">${STEPS.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</span>
      <button class="btn small ghost" data-skip type="button">Skip</button><button class="btn small" data-next type="button">${i === STEPS.length - 1 ? 'Got it' : 'Next'}</button></div>`;
  };
  const end = () => { store.set('toured', true); card.remove(); };
  card.onclick = (e) => {
    if (e.target.closest('[data-skip]')) return end();
    if (e.target.closest('[data-next]')) { if (++i >= STEPS.length) return end(); paint(); }
  };
  paint(); document.body.appendChild(card);
}

export function setupTour() {
  $('tourAgain').onclick = () => { document.querySelector('.tour')?.remove(); showTour(true); $('sheetClose').click(); };
}
