// The terminal itself (xterm.js): colours for light and dark, font size, fitting it to the
// screen above the phone keyboard, phone-keyboard quirks, and swipe-to-scroll.

import { $ } from '../core/dom.js';
import { store } from '../core/store.js';
import { state } from '../core/state.js';
import { sendTerm } from '../connection/link.js';
import { viewerSize } from '../features/viewer.js';
import { input } from './input.js';
import { KEYS, applyMods } from './keyrow.js';
import { setupPredict } from './predict.js';
import { showLastScreen, keepLastScreen } from './last-screen.js';

// ---------- terminal ----------
const TERM_THEMES = {
  light: { background: '#FFFFFF', foreground: '#1B1F27', cursor: '#C98A00', cursorAccent: '#FFFFFF', selectionBackground: '#F8E2B0',
    black: '#1B1F27', red: '#D1343B', green: '#0B8A5E', yellow: '#A86A00', blue: '#2D62D8', magenta: '#8A4FD8', cyan: '#0E8A9E', white: '#9AA1AC',
    brightBlack: '#5F6672', brightRed: '#E5484D', brightGreen: '#0E9F6E', brightYellow: '#C98A00', brightBlue: '#3B74F0', brightMagenta: '#9E63EC', brightCyan: '#13A3BA', brightWhite: '#C7CCD4' },
  dark: { background: '#0C0D12', foreground: '#ECEAF4', cursor: '#F5B843', cursorAccent: '#0C0D12', selectionBackground: '#3A3424',
    black: '#1E2338', red: '#FF7A7A', green: '#4FD1A1', yellow: '#F4B740', blue: '#7AA2FF', magenta: '#C79BFF', cyan: '#6FD3E6', white: '#E9E7F2',
    brightBlack: '#5D6283', brightRed: '#FF9C9C', brightGreen: '#7BE3BD', brightYellow: '#FFD07A', brightBlue: '#9DBBFF', brightMagenta: '#DAB8FF', brightCyan: '#9BE6F2', brightWhite: '#FFFFFF' },
};
// The Terminal look's palettes (Settings → Appearance → Colors). Catppuccin (Mocha), Nord, Dracula
// and Gruvbox are the well-known open color schemes of those names.
const P = (bg, fg, cursor, sel, n, b) => ({ background: bg, foreground: fg, cursor, cursorAccent: bg, selectionBackground: sel,
  black: n[0], red: n[1], green: n[2], yellow: n[3], blue: n[4], magenta: n[5], cyan: n[6], white: n[7],
  brightBlack: b[0], brightRed: b[1], brightGreen: b[2], brightYellow: b[3], brightBlue: b[4], brightMagenta: b[5], brightCyan: b[6], brightWhite: b[7] });
const PALETTES = {
  charcoal: P('#1e1f22', '#d6d6da', '#e8956b', '#3a3d45', ['#2b2d31', '#f0717c', '#8fcf9a', '#e5c07b', '#6ea8fe', '#b998e6', '#6fc6c8', '#c8c8cc'], ['#5c5f66', '#ff8f98', '#a8e0b2', '#f0d397', '#91bdff', '#cdb2f0', '#8fd9db', '#f2f2f4']),
  catppuccin: P('#1e1e2e', '#cdd6f4', '#f5e0dc', '#45475a', ['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de'], ['#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8']),
  nord: P('#2e3440', '#d8dee9', '#d8dee9', '#434c5e', ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0'], ['#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4']),
  dracula: P('#282a36', '#f8f8f2', '#f8f8f2', '#44475a', ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2'], ['#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']),
  gruvbox: P('#282828', '#ebdbb2', '#ebdbb2', '#504945', ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984'], ['#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2']),
  paper: P('#f7f5ef', '#2b2a27', '#b5651d', '#e8dcc3', ['#2b2a27', '#c4372f', '#3f7d3a', '#9a6a00', '#2f5fa8', '#8a4fa8', '#1f7f86', '#8a877f'], ['#6b6860', '#d9534a', '#4f9a49', '#b8860b', '#3d74c4', '#a066c2', '#2a99a2', '#b3afa5']),
};
const termTheme = () => { const r = document.documentElement.dataset; return r.style === 'tech' ? PALETTES[r.palette] || PALETTES.charcoal : TERM_THEMES[r.theme === 'dark' ? 'dark' : 'light']; };

export function setupTerminal() {
  let size = store.get('font', matchMedia('(max-width:700px)').matches ? 13 : 15);
  const term = (state.term = new Terminal({ fontFamily: '"JB Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace', fontSize: size, cursorBlink: true, scrollback: 5000, allowTransparency: true,
    theme: termTheme() }));
  document.addEventListener('pt-theme', () => { term.options.theme = termTheme(); });
  state.fit = new FitAddon.FitAddon(); term.loadAddon(state.fit); term.open($('term')); setupTouchScroll();
  useGpu(term);
  // For tests and bug reports: the text on screen, whichever way it is drawn.
  window.ptText = () => { const b = term.buffer.active, out = []; for (let y = b.viewportY; y < b.viewportY + term.rows; y++) { const l = b.getLine(y); out.push(l ? l.translateToString(true) : ''); } return out.join('\n'); };
  if (!state.S.viewer) { setupPredict(term); showLastScreen(term); keepLastScreen(term); }
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

// The size of one character cell on screen, in CSS pixels.
export function cellSize(term = state.term) {
  try { const c = term._core._renderService.dimensions.css.cell; if (c.width && c.height) return { w: c.width, h: c.height }; } catch {}
  const sc = $('term').querySelector('.xterm-screen');
  return { w: sc && term.cols ? sc.clientWidth / term.cols : term.options.fontSize * 0.6, h: sc && term.rows ? sc.clientHeight / term.rows : term.options.fontSize * 1.2 };
}

// Draw the terminal with the phone's graphics chip (WebGL) instead of thousands of page
// elements: long agent output and scrolling stay smooth. It loads after the terminal is up, and
// if the phone can't do it (or takes the graphics away while the app is in the background) the
// terminal carries on with the plain drawing. Settings → Smooth drawing turns it off.
function useGpu(term) {
  if (store.get('gpu') === false || !window.WebGL2RenderingContext) return;
  const s = document.createElement('script'); s.src = 'vendor/addon-webgl.js'; s.async = true;
  s.onload = () => {
    try {
      const gl = new WebglAddon.WebglAddon();
      gl.onContextLoss(() => { try { gl.dispose(); } catch {} state.gpu = null; });
      term.loadAddon(gl); state.gpu = gl;
      // Safety net: if its drawing surface didn't come out at the screen's real sharpness (seen
      // in browser tools that only pretend to be a sharp phone screen), the text would be blank
      // or blurry. Go back to the plain drawing instead.
      const sane = () => {
        if (!state.gpu) return;
        try {
          const c = term.element.querySelector('.xterm-screen canvas:not(.xterm-link-layer)'), want = term._core._renderService.dimensions.device.canvas.width;
          if (c && want && c.width < want * 0.9) { state.gpu.dispose(); state.gpu = null; }
        } catch {}
      };
      setTimeout(sane, 400); term.onResize(() => setTimeout(sane, 400));
      if (document.fonts) document.fonts.ready.then(() => { try { state.gpu && state.gpu.clearTextureAtlas(); } catch {} }); // redraw letters in the terminal font once it has loaded
    } catch { state.gpu = null; }
  };
  document.head.appendChild(s);
}

// Swipe up/down on the terminal scrolls only the terminal (never the page). In full-screen
// programs (nano, less, top) a swipe sends arrow keys instead. Swipe left/right: the next or
// previous terminal (agents.js listens for 'pt-swipe').
function setupTouchScroll() {
  const term = state.term;
  const el = $('term'); let ty = null, acc = 0, x0 = 0, y0 = 0, axis = null, dx = 0;
  const lineH = () => cellSize(term).h;
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
