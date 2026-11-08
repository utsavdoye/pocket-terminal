// The Computers page: every computer this phone is paired with, which one is on screen, switch
// with one tap, pair another (scan its QR code here), or remove one from this phone.
// Opened from the computer's name at the top, or Menu → Computers.

import { $, esc, ago, toast } from '../core/dom.js';
import { DEMO } from '../core/env.js';
import { state, mac } from '../core/state.js';
import { computers, switchTo, removeComputer } from '../core/computers.js';
import { openSheet, onPage } from '../ui/sheet.js';
import { openScanner, handleLink } from './unpaired.js';

function paint() {
  const cur = state.S && state.S.topic;
  const list = DEMO ? [{ name: mac.name || 'Demo computer', topic: cur }] : computers();
  $('compList').innerHTML = list.map((c) => {
    const on = c.topic === cur;
    const sub = on ? (state.linkState === 'direct' ? 'On screen · live' : 'On screen') : c.seen ? `Last seen ${ago(c.seen)}` : 'Tap to switch';
    return `<div class="item comp${on ? ' cur' : ''}" data-topic="${esc(c.topic)}">
      <div class="ag-top"><i class="st ${on && state.linkState === 'direct' ? 's-work' : 's-idle'}"></i><span class="ag-name"><b>${esc(c.name)}</b><small>${esc(sub)}</small></span>${on ? '<span class="tag done">in use</span>' : ''}</div>
      ${on ? '' : `<div class="ag-acts"><button class="btn small" data-go="${esc(c.topic)}" type="button">Switch</button><button class="x" data-rm="${esc(c.topic)}" type="button" aria-label="Remove ${esc(c.name)} from this phone">✕</button></div>`}</div>`;
  }).join('');
  $('compCount').textContent = list.length > 1 ? list.length : '';
}

export function setupComputers() {
  $('macName').closest('.who').onclick = () => { navigator.vibrate && navigator.vibrate(6); openSheet('computers'); };
  onPage('computers', paint);
  $('compList').onclick = async (e) => {
    if (DEMO) return toast('The demo has one pretend computer. Pair yours to add more.');
    const go = e.target.closest('[data-go]'), rm = e.target.closest('[data-rm]');
    if (go) { if (switchTo(go.dataset.go)) location.replace(location.pathname); return; }
    if (rm) {
      const c = computers().find((x) => x.topic === rm.dataset.rm); if (!c) return;
      if (!confirm(`Remove ${c.name} from this phone? To use it again you pair it again. (To lock this phone out from the computer instead, run npx pocket-terminal remove there.)`)) return;
      const cur = c.topic === state.S.topic; const left = await removeComputer(c.topic);
      if (cur) location.replace(location.pathname); else { paint(); toast(`${c.name} removed from this phone`); }
      if (!left) location.replace(location.pathname);
    }
  };
  $('compScan').onclick = () => (DEMO ? toast('Pair your own computer to add it.') : openScanner(toast));
  $('compPaste').onclick = () => { $('compPasteForm').hidden = false; $('compPasteIn').focus(); };
  $('compPasteForm').onsubmit = (e) => { e.preventDefault(); if (!handleLink($('compPasteIn').value)) toast("That isn't a pairing link. Run  npx pocket-terminal pair  on the other computer."); };
  $('compCopy').onclick = async () => { try { await navigator.clipboard.writeText('npx pocket-terminal pair'); toast('Copied. Run it on the other computer.'); } catch { toast('Run on the other computer: npx pocket-terminal pair'); } };
  paint();
}
