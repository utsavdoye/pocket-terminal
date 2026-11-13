// The sheet: the ⋯ menu and every page in it (Ask, Send a command, Files…), opened from the
// header or the dock along the bottom. Tools can run something when their page opens (onPage).

import { $ } from '../core/dom.js';
import { APP_VERSION } from '../core/env.js';
import { state } from '../core/state.js';
import { closeQuick } from '../terminal/keyrow.js';
import { paintAsk } from '../features/ask.js';

const PAGE_TITLES = { home: 'Menu', queue: 'Send a command', snippets: 'Saved commands', ask: 'Ask AI', power: 'Power and battery', settings: 'Settings', sessions: 'Agents & terminals', diff: 'Changes', computers: 'Computers', files: 'Files', web: 'Local websites', work: 'Tasks', clip: 'Clipboard' };
const pageHooks = {};
let sheetTab = null;
export function openSheet(tab) {
  closeQuick();
  const sh = $('sheet'), wasOpen = sh.classList.contains('show') && !sh.classList.contains('closing');
  sh.classList.remove('closing');
  $('tabs').hidden = tab !== 'home';
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + tab));
  // pages slide in from the right; going back slides the menu in from the left
  const el = tab === 'home' ? $('tabs') : $('pane-' + tab);
  el.classList.remove('in', 'back-in');
  if (wasOpen && sheetTab !== tab) { void el.offsetWidth; el.classList.add(tab === 'home' ? 'back-in' : 'in'); }
  sheetTab = tab;
  $('sheetTitle').textContent = PAGE_TITLES[tab] || 'Menu';
  $('sheet').classList.toggle('home', tab === 'home');
  $('sheet').classList.add('show');
  if (tab === 'queue') setTimeout(() => $('qcmd').focus(), 50);
  if (tab === 'ask') { paintAsk(); setTimeout(() => $('askIn').focus(), 50); }
  pageHooks[tab] && pageHooks[tab]();
}
export function closeSheet() {
  const sh = $('sheet'); if (!sh.classList.contains('show') || sh.classList.contains('closing')) return;
  sh.classList.add('closing'); sheetTab = null;
  setTimeout(() => { sh.classList.remove('show', 'closing'); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 190);
}
export const pageOpen = (t) => $('sheet').classList.contains('show') && sheetTab === t;
export const onPage = (t, fn) => { pageHooks[t] = fn; };

// Swipe the sheet down by its top bar to close it, like any phone sheet. It follows the finger;
// let go past a third of the way (or with a quick flick) and it closes, otherwise it springs back.
function setupSwipeDown() {
  const sh = $('sheet'), panel = sh.querySelector('.panel'), head = panel.querySelector('.sheethead');
  let y0 = null, dy = 0, t0 = 0, drag = false;
  head.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) return; y0 = e.touches[0].clientY; dy = 0; t0 = performance.now(); drag = false; }, { passive: true });
  head.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (!drag && dy < 8) return;
    drag = true; e.preventDefault();
    panel.style.transition = 'none'; panel.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  const end = () => {
    if (y0 === null) return; y0 = null;
    if (!drag) return;
    const fast = dy / Math.max(1, performance.now() - t0) > 0.5;
    panel.style.transition = 'transform .18s ease-out';
    if (dy > Math.min(140, panel.offsetHeight / 3) || (dy > 40 && fast)) {
      panel.style.transform = 'translateY(100%)'; sheetTab = null;
      navigator.vibrate && navigator.vibrate(6);
      setTimeout(() => { sh.classList.remove('show', 'closing'); panel.style.transition = panel.style.transform = ''; state.term.focus(); }, 180);
    } else {
      panel.style.transform = '';
      setTimeout(() => { panel.style.transition = ''; }, 200);
    }
  };
  head.addEventListener('touchend', end); head.addEventListener('touchcancel', end);
  // a drag that ends on Back or Done must not also press it
  head.addEventListener('click', (e) => { if (drag) { e.stopPropagation(); e.preventDefault(); drag = false; } }, true);
}

export function setupSheet() {
  setupSwipeDown();
  // The dock: keyboard, agents, send a command, files.
  document.querySelectorAll('#dock [data-dock]').forEach((b) => b.addEventListener('click', () => {
    navigator.vibrate && navigator.vibrate(6);
    if (b.dataset.dock === 'kb') { state.term.focus(); return; }
    openSheet(b.dataset.dock);
  }));
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => (b.onclick = () => openSheet(b.dataset.tab)));
  $('menuBtn').onclick = () => openSheet('home');
  $('askBtn').onclick = () => openSheet('ask');
  $('sheetBack').onclick = () => openSheet('home');
  $('sheetClose').onclick = () => { closeSheet(); state.term.focus(); };
  $('menuFoot').textContent = `Pocket Terminal ${'v' + APP_VERSION}`;
  $('sheet').onclick = (e) => { if (e.target.id === 'sheet') { closeSheet(); state.term.focus(); } };
}
