// Not paired (yet, or any more): scan the QR code inside the app, or paste the pairing link.
// Also what happens when the computer removes this phone.

import { $, show } from '../core/dom.js';
import { store } from '../core/store.js';
import { removeComputer } from '../core/computers.js';
import { state } from '../core/state.js';
import { joinFlow, joinFrom } from './pairing.js';

// ---------- not paired: scan the QR inside the app, or paste the link ----------
let noneReady = false;
export function showNone() {
  show('gate-none');
  if (noneReady) return; noneReady = true;
  $('scanBtn').onclick = () => openScanner();
  $('pasteBtn').onclick = () => { $('pasteForm').hidden = false; $('pasteIn').focus(); };
  $('pasteForm').onsubmit = (e) => { e.preventDefault(); if (!handleLink($('pasteIn').value)) $('noneErr').textContent = "That isn't a Pocket Terminal pairing link. Run  npx pocket-terminal pair  on your computer and copy the link it shows."; };
  $('scanClose').onclick = closeScanner;
  $('copyCmd').onclick = async () => { const b = $('copyCmd'); try { await navigator.clipboard.writeText('npx pocket-terminal'); } catch {} b.classList.add('ok'); b.querySelector('.cp').textContent = 'copied'; setTimeout(() => { b.classList.remove('ok'); b.querySelector('.cp').textContent = 'copy'; }, 1800); };
}
export function handleLink(text) {
  let u; try { u = new URL(String(text).trim()); } catch { return false; }
  const h = new URLSearchParams(u.hash.slice(1));
  if (!h.get('join')) return false;
  $('pasteIn').value = ''; $('noneErr').textContent = '';
  show('gate-pair'); joinFlow(joinFrom(h), true);
  return true;
}
let scanStream = null, scanRAF = 0;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/jsQR.js'; s.onload = res; s.onerror = () => rej(new Error('scanner')); document.head.appendChild(s); });
}
export async function openScanner(onErr = (m) => { $('noneErr').textContent = m; }) {
  $('noneErr').textContent = '';
  try {
    await loadJsQR();
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (e) {
    onErr(e && e.name === 'NotAllowedError'
      ? 'Camera access is blocked. Allow it (iPhone: Settings → Safari → Camera), or use Paste pairing link.'
      : 'Could not open the camera here. Use Paste pairing link instead.');
    return;
  }
  const v = $('scanVideo'); v.srcObject = scanStream; await v.play().catch(() => {});
  $('scanHint').textContent = 'Point at the QR code on your computer'; $('scanner').hidden = false;
  const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
  let last = 0;
  const tick = (t) => {
    scanRAF = requestAnimationFrame(tick);
    if (t - last < 180 || v.readyState < 2 || !v.videoWidth) return; last = t;
    const w = Math.min(720, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
    c.width = w; c.height = h; ctx.drawImage(v, 0, 0, w, h);
    const r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
    if (!r || !r.data) return;
    if (handleLink(r.data)) { navigator.vibrate && navigator.vibrate(40); closeScanner(); }
    else $('scanHint').textContent = "That QR code isn't a Pocket Terminal pairing code.";
  };
  scanRAF = requestAnimationFrame(tick);
}
function closeScanner() {
  cancelAnimationFrame(scanRAF); scanStream?.getTracks().forEach((t) => t.stop()); scanStream = null;
  $('scanVideo').srcObject = null; $('scanner').hidden = true;
}

// The computer removed this phone (npx pocket-terminal remove). Forget the key and say so.
export async function revoked() {
  const name = state.S && state.S.name || 'Your computer';
  const left = state.S ? await removeComputer(state.S.topic) : null;
  try { state.dc && state.dc.close(); state.pc && state.pc.close(); } catch {}
  state.board && state.board.stop(); location.hash = '';
  if (left) { store.set('flash', `${name} removed this phone. Switched to ${left.name}.`); location.reload(); return; }
  showNone();
  $('noneErr').textContent = 'This phone was removed on your computer. To use it again, run  npx pocket-terminal pair  there and tap Scan QR code.';
}
