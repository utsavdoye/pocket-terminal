// The key row above the phone keyboard: Esc, Tab, arrows, Ctrl and Alt, paste, and the quick
// bar of saved commands. Keys fire on touch end so the phone keyboard keeps its focus.

import { $, toast } from '../core/dom.js';
import { state } from '../core/state.js';
import { input } from './input.js';

export const KEYS = { cx: '\x18', co: '\x0f', esc: '\x1b', tab: '\t', up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', home: '\x1b[H', end: '\x1b[F', pgup: '\x1b[5~', pgdn: '\x1b[6~', cc: '\x03', cd: '\x04', cz: '\x1a', cl: '\x0c', cr: '\x12', stab: '\x1b[Z', ca: '\x01', ce: '\x05', cw: '\x17', cu: '\x15', del: '\x1b[3~' };
const mods = { ctrl: false, alt: false }, modBtn = {};
export function applyMods(d) {
  if (!mods.ctrl && !mods.alt) return d;
  let o = d;
  if (mods.ctrl && d.length === 1) { const c = d.toLowerCase().charCodeAt(0); o = c >= 97 && c <= 122 ? String.fromCharCode(c - 96) : ({ ' ': '\x00', '[': '\x1b', '\\': '\x1c', ']': '\x1d' })[d] ?? d; }
  if (mods.alt) o = '\x1b' + o;
  clearMods();
  return o;
}
function clearMods() { for (const k in mods) { mods[k] = false; modBtn[k] && modBtn[k].classList.remove('on'); } }

// A key on the bar: fire on touch end and cancel the tap's click, so the phone keyboard keeps its
// focus (a normal tap first blurs the terminal on iPhone, and the key can get lost). Mouse: click.
function tapKey(b, act) {
  let x = 0, y = 0, moved = false;
  // The key lights up while held, and flashes amber when it fires, so you see every press.
  const fire = () => { b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); act(); };
  b.addEventListener('animationend', () => b.classList.remove('hit'));
  b.addEventListener('touchstart', (e) => { const t = e.touches[0]; x = t.clientX; y = t.clientY; moved = false; b.classList.add('down'); }, { passive: true });
  b.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (Math.abs(t.clientX - x) > 8 || Math.abs(t.clientY - y) > 8) { moved = true; b.classList.remove('down'); } }, { passive: true });
  b.addEventListener('touchend', (e) => { e.preventDefault(); b.classList.remove('down'); if (!moved) fire(); }, { passive: false });
  b.addEventListener('touchcancel', () => b.classList.remove('down'));
  b.addEventListener('mousedown', (e) => { e.preventDefault(); b.classList.add('down'); });
  b.addEventListener('mouseup', () => b.classList.remove('down'));
  b.addEventListener('mouseleave', () => b.classList.remove('down'));
  b.onclick = fire;
}
// Paste: the clipboard if the phone allows it, else a box you can long-press and paste into.
async function pasteFlow() {
  try { const t = await navigator.clipboard.readText(); if (t) { state.term.paste(t); state.term.focus(); return; } } catch {}
  $('pasteText').value = ''; $('pasteBox').hidden = false; setTimeout(() => $('pasteText').focus(), 50);
}
function closePaste() { $('pasteBox').hidden = true; $('pasteText').blur(); state.term.focus(); }

function toggleQuick() { const q = $('quick'); q.hidden = !q.hidden; document.querySelector('#keys .kq').classList.toggle('on', !q.hidden); requestAnimationFrame(() => state.fit.fit()); }
export function closeQuick() { if (!$('quick').hidden) toggleQuick(); }

export function setupKeyRow() {
  document.querySelectorAll('[data-mod]').forEach((b) => { modBtn[b.dataset.mod] = b;
    tapKey(b, () => { mods[b.dataset.mod] = !mods[b.dataset.mod]; b.classList.toggle('on'); state.term.focus(); }); });
  document.querySelectorAll('#keys [data-k], #keys [data-t]').forEach((b) => {
    tapKey(b, async () => {
      const k = b.dataset.k;
      if (k === 'paste') return pasteFlow();
      if (k === 'quick') return toggleQuick();
      if (k) { const pre = mods.alt ? '\x1b' : ''; clearMods(); input(pre + KEYS[k]); }
      else input(applyMods(b.dataset.t));
      state.term.focus();
    });
  });
  // The key row scrolls sideways: fade the edge that has more keys behind it.
  const kr = $('keys'), kfade = () => { kr.classList.toggle('more-l', kr.scrollLeft > 4); kr.classList.toggle('more-r', kr.scrollLeft + kr.clientWidth < kr.scrollWidth - 4); };
  kr.addEventListener('scroll', kfade, { passive: true }); addEventListener('resize', kfade); kfade();
  $('pasteSend').onclick = () => { const t = $('pasteText').value; closePaste(); if (t) { state.term.paste(t); toast('Pasted'); } };
  $('pasteCancel').onclick = closePaste;
}
