// Typing ahead on a slow link: letters you type show at once, dimmed, and are swapped for the
// computer's own echo when it arrives. The rules live in predict-core.js; this file feeds it
// what's typed and what the terminal shows, and draws the dim letters over the terminal.
//
// It only switches on when the link is slow enough to feel (a round trip of 80 ms or more), so
// on Wi-Fi nothing changes. Settings → Typing ahead turns it off.

import { store } from '../core/store.js';
import { state } from '../core/state.js';
import { on } from '../connection/messages.js';
import { onInput } from './input.js';
import { cellSize } from './term.js';
import { Predictor } from './predict-core.js';

const SLOW = 80; // ms
export function setupPredict(term) {
  const p = new Predictor();
  let box = null;
  const mode = () => store.get('echo', true); // true: when the link is slow | false: never | 'always': tests
  const wanted = () => mode() === 'always' || (mode() !== false && state.rtt !== null && state.rtt >= SLOW);
  const snap = () => {
    const b = term.buffer.active;
    return { x: b.cursorX, y: b.cursorY, cols: term.cols, alt: b.type === 'alternate', atBottom: b.viewportY === b.baseY,
      char: (x, y) => { const l = b.getLine(b.baseY + y), c = l && l.getCell(x); return (c && c.getChars()) || ' '; } };
  };
  const draw = () => {
    const v = p.view;
    if (!v) { if (box) box.hidden = true; return; }
    if (!box) { box = document.createElement('div'); box.className = 'ahead'; box.setAttribute('aria-hidden', 'true'); term.element.querySelector('.xterm-screen').appendChild(box); }
    const { w, h } = cellSize(term), th = term.options.theme || {};
    box.style.cssText = `left:${v.x * w}px;top:${v.y * h}px;height:${h}px;line-height:${h}px;font:${term.options.fontSize}px ${term.options.fontFamily};background:${th.background || '#fff'};color:${th.foreground || '#000'}`;
    box.innerHTML = '';
    for (const ch of v.text) { const s = document.createElement('span'); s.textContent = ch; s.style.width = w + 'px'; box.appendChild(s); }
    const cur = document.createElement('i'); cur.style.cssText = `width:${w}px;height:${h}px;background:${th.cursor || th.foreground || '#000'}`; box.appendChild(cur);
    box.hidden = false;
  };
  onInput((d) => {
    if (!state.dc || state.dc.readyState !== 'open' || !wanted()) { p.clear(); return draw(); }
    p.typed(d, snap(), performance.now(), state.rtt); draw();
  });
  term.onWriteParsed(() => { p.output(snap(), performance.now(), state.rtt); draw(); });
  term.onScroll(() => { if (p.view && term.buffer.active.viewportY !== term.buffer.active.baseY) { p.clear(); draw(); } });
  term.onResize(() => { p.clear(); draw(); });
  on('reset', () => { p.clear(); draw(); });
  setInterval(() => { if (p.pend) { p.tick(performance.now(), state.rtt); draw(); } }, 200);
  window.ptAhead = () => p.view; // for tests
}
