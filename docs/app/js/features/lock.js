// The PIN: a phone-style number pad (shared with pairing), and the lock screen that unlocks the
// pairing key. Ten wrong PINs in a row unpair this phone.

import { derive, lockSecret, unlockSecret, VAULT_ROUNDS } from '../crypto.js';
import { $, show, toast } from '../core/dom.js';
import { store } from '../core/store.js';
import { removeComputer, keepSession, forgetSession } from '../core/computers.js';
import { DEFAULT_BOARDS } from '../core/env.js';
import { start } from '../connection/session.js';

// ---------- PIN pad (phone-style; the physical keyboard works too) ----------
export function pinPad(id, { goLabel, onDone, min = 6, max = 12 }) {
  const pad = $(id + 'Pad'), dots = $(id + 'Dots');
  let v = '';
  const draw = () => {
    dots.innerHTML = Array.from({ length: Math.max(min, v.length) }, (_, i) => `<i class="${i < v.length ? 'on' : ''}"></i>`).join('');
    go.disabled = v.length < min;
  };
  const press = (k) => {
    if (k === 'del') v = v.slice(0, -1);
    else if (k === 'go') { if (v.length >= min) { const pin = v; v = ''; draw(); onDone(pin); } return; }
    else if (v.length < max) v += k;
    draw();
  };
  pad.innerHTML = '';
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'go']) {
    const b = document.createElement('button'); b.type = 'button';
    if (k === 'del') { b.className = 'fn'; b.textContent = 'Delete'; b.setAttribute('aria-label', 'Delete'); }
    else if (k === 'go') { b.className = 'go'; b.textContent = goLabel; }
    else b.textContent = k;
    b.onclick = () => press(k); pad.appendChild(b);
  }
  var go = pad.lastChild;
  const onKey = (e) => {
    if (pad.closest('.gate').hidden) return;
    if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); else if (e.key === 'Enter') press('go');
  };
  document.addEventListener('keydown', onKey);
  draw();
  return {
    setLabel(t) { go.textContent = t; },
    shake() { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); navigator.vibrate && navigator.vibrate(80); },
    done() { document.removeEventListener('keydown', onKey); },
  };
}

export function lockFlow(vault) {
  const p = pinPad('lock', {
    goLabel: 'Unlock',
    onDone: async (pin) => {
      $('lockErr').textContent = 'Checking…';
      const secret = await unlockSecret(vault, pin);
      if (!secret) {
        const f = store.get('fails', 0) + 1; store.set('fails', f); p.shake();
        if (f >= 10) { store.set('fails', 0); const left = await removeComputer(vault.topic); p.done(); const msg = `Too many wrong PINs. ${vault.name} was unpaired from this phone.`; if (left) { store.set('flash', msg); location.reload(); return; } show('gate-none'); toast(msg); return; }
        $('lockErr').textContent = `Wrong PIN. ${10 - f} tries left before this phone is unpaired.`; return;
      }
      p.done(); store.set('fails', 0);
      if ((vault.it || 310000) < VAULT_ROUNDS) { // older, weaker PIN lock: upgrade it now that we have the PIN
        const up = await lockSecret(secret, pin); store.set('vault', { ...vault, ...up });
      }
      const k = await derive(secret);
      const s = { key: k.key, topic: k.topic, notifyTopic: k.notifyTopic, boards: vault.boards || DEFAULT_BOARDS, name: vault.name, expires: Date.now() + ($('remember').checked ? 12 * 3600e3 : 0) };
      if ($('remember').checked) await keepSession(s); else await forgetSession(s.topic);
      start(s);
    },
  });
}
