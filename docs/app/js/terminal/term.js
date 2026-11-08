// The terminal itself (xterm.js): colours for light and dark, font size, fitting it to the
// screen above the phone keyboard, phone-keyboard quirks, and swipe-to-scroll.

import { $ } from '../core/dom.js';
import { store } from '../core/store.js';
import { state } from '../core/state.js';
import { sendTerm } from '../connection/link.js';
import { viewerSize } from '../features/viewer.js';
import { input } from './input.js';
import { KEYS, applyMods } from './keyrow.js';

// ---------- terminal ----------
const TERM_THEMES = {
  light: { background: '#FFFFFF', foreground: '#1B1F27', cursor: '#C98A00', cursorAccent: '#FFFFFF', selectionBackground: '#F8E2B0',
    black: '#1B1F27', red: '#D1343B', green: '#0B8A5E', yellow: '#A86A00', blue: '#2D62D8', magenta: '#8A4FD8', cyan: '#0E8A9E', white: '#9AA1AC',
    brightBlack: '#5F6672', brightRed: '#E5484D', brightGreen: '#0E9F6E', brightYellow: '#C98A00', brightBlue: '#3B74F0', brightMagenta: '#9E63EC', brightCyan: '#13A3BA', brightWhite: '#C7CCD4' },
  dark: { background: '#0C0D12', foreground: '#ECEAF4', cursor: '#F5B843', cursorAccent: '#0C0D12', selectionBackground: '#3A3424',
    black: '#1E2338', red: '#FF7A7A', green: '#4FD1A1', yellow: '#F4B740', blue: '#7AA2FF', magenta: '#C79BFF', cyan: '#6FD3E6', white: '#E9E7F2',
    brightBlack: '#5D6283', brightRed: '#FF9C9C', brightGreen: '#7BE3BD', brightYellow: '#FFD07A', brightBlue: '#9DBBFF', brightMagenta: '#DAB8FF', brightCyan: '#9BE6F2', brightWhite: '#FFFFFF' },
};
const termTheme = () => TERM_THEMES[document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'];

export function setupTerminal() {
  let size = store.get('font', matchMedia('(max-width:700px)').matches ? 13 : 15);
  const term = (state.term = new Terminal({ fontFamily: '"JB Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace', fontSize: size, cursorBlink: true, scrollback: 5000, allowTransparency: true,
    theme: termTheme() }));
  document.addEventListener('pt-theme', () => { term.options.theme = termTheme(); });
  state.fit = new FitAddon.FitAddon(); term.loadAddon(state.fit); term.open($('term')); setupTouchScroll();
  if (state.S.viewer) { term.options.disableStdin = true; term.options.cursorBlink = false; state.fit = { fit: () => viewerSize() }; }
  term.onData((d) => input(applyMods(d)));
  // Holding delete on a phone keyboard: some keyboards send only "delete" events (no key press)
  // and speed up to whole words after a moment. Turn those into terminal deletes, so holding it
  // clears text the way it does in a message. A real key press is left to the terminal (no doubles).
  let lastBs = 0;
  // A terminal is not a chat box: no autocorrect, word predictions, auto-capitals or spell check.
  // (On Android, Gboard otherwise "fixes" the word when you press space: "ls" becomes "Is".)
  for (const [k, v] of [['autocorrect', 'off'], ['autocapitalize', 'off'], ['autocomplete', 'off'], ['spellcheck', 'false'], ['data-gramm', 'false'], ['enterkeyhint', 'send']]) term.textarea.setAttribute(k, v);
  term.textarea.addEventListener('keydown', (e) => { if (e.key === 'Backspace') lastBs = performance.now(); }, true);
  term.textarea.addEventListener('beforeinput', (e) => {
    const t = e.inputType;
    if (state.S.viewer || (t !== 'deleteContentBackward' && t !== 'deleteWordBackward' && t !== 'deleteSoftLineBackward')) return;
    e.preventDefault();
    if (performance.now() - lastBs < 80) return;
    input(t === 'deleteContentBackward' ? '\x7f' : t === 'deleteWordBackward' ? '\x17' : '\x15'); // ^W word, ^U line
  }, true);
  term.onResize(() => sendTerm({ t: 'r', cols: term.cols, rows: term.rows }));
  const setFont = (n) => { size = Math.max(9, Math.min(24, n)); term.options.fontSize = size; store.set('font', size); state.fit.fit(); };
  $('smaller').onclick = () => setFont(size - 1); $('bigger').onclick = () => setFont(size + 1);
  const app = $('app');
  const layout = () => {
    const vv = window.visualViewport, h = vv ? vv.height : innerHeight;
    app.style.height = h + 'px'; if (vv) app.style.top = vv.offsetTop + 'px';
    app.classList.toggle('kb', !!vv && innerHeight - vv.height > 120); // keyboard is up: drop the home-bar padding under the keys
    state.fit.fit();
  };
  if (window.visualViewport) { visualViewport.addEventListener('resize', layout); visualViewport.addEventListener('scroll', layout); }
  addEventListener('resize', layout); layout();
  if (document.fonts) document.fonts.ready.then(layout); // refit once the terminal font has loaded
  // Phones scroll the page to show a focused input; put it back when the keyboard closes.
  document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) { window.scrollTo(0, 0); layout(); } }, 50));
}

// Swipe up/down on the terminal scrolls only the terminal (never the page). In full-screen
// programs (nano, less, top) a swipe sends arrow keys instead. Swipe left/right: the next or
// previous terminal (agents.js listens for 'pt-swipe').
function setupTouchScroll() {
  const term = state.term;
  const el = $('term'); let ty = null, acc = 0, x0 = 0, y0 = 0, axis = null, dx = 0;
  const lineH = () => { const r = el.querySelector('.xterm-rows > div'); return (r && r.offsetHeight) || term.options.fontSize * 1.2; };
  el.addEventListener('touchstart', (e) => {
    ty = e.touches.length === 1 ? e.touches[0].clientY : null; acc = 0; axis = null; dx = 0;
    if (ty !== null) { x0 = e.touches[0].clientX; y0 = ty; }
  }, { passive: true, capture: true });
  el.addEventListener('touchmove', (e) => {
    if (ty === null) return;
    e.preventDefault(); e.stopPropagation();
    const t = e.touches[0]; dx = t.clientX - x0;
    if (!axis && (Math.abs(dx) > 14 || Math.abs(t.clientY - y0) > 14)) axis = Math.abs(dx) > Math.abs(t.clientY - y0) * 1.5 ? 'x' : 'y';
    if (axis === 'x') return;
    const y = t.clientY; acc += ty - y; ty = y;
    const n = Math.trunc(acc / lineH()); if (!n) return; acc -= n * lineH();
    if (term.buffer.active.type === 'alternate') input((n > 0 ? KEYS.down : KEYS.up).repeat(Math.min(Math.abs(n), 5)));
    else term.scrollLines(n);
  }, { passive: false, capture: true });
  el.addEventListener('touchend', () => {
    if (axis === 'x' && Math.abs(dx) > 70) dispatchEvent(new CustomEvent('pt-swipe', { detail: dx < 0 ? 1 : -1 }));
    ty = null; axis = null;
  }, { passive: true, capture: true });
  // Everywhere else: only real scroll areas may scroll; the page itself never moves.
  document.addEventListener('touchmove', (e) => {
    if (!e.target.closest('.pane, .gate, .chips, .keys, .panel, textarea, input, .scanner, .card-state')) e.preventDefault();
  }, { passive: false });
}
