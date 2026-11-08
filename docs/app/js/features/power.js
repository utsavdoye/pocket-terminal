// Power and battery: the computer's battery, whether it's awake and why, its next check-in, and
// the power settings you can change from here.

import { $ } from '../core/dom.js';
import { state, mac } from '../core/state.js';
import { sendTerm } from '../connection/link.js';
import { post } from '../connection/notes.js';
import { paint, until } from '../ui/status.js';

// ---------- power ----------
const reasonText = { 'on charger': "it's charging", 'phone connected': 'your phone is connected', 'job running': 'a command is running', 'recent typing': 'you typed recently', 'checking in': "it's checking in", 'instant mode': 'Instant mode is on', 'program running': 'a program is still working' };
export function paintPower(p, nci) {
  const { linkState, livePower } = state;
  const s = (p && p.settings) || {};
  $('pBatt').textContent = p && p.percent != null ? `${p.percent}%${p.onCharger ? ' ⚡' : ''}` : '–';
  $('pState').textContent = linkState === 'direct' ? 'Awake' : mac.state === 'sleeping' ? 'Asleep' : '–';
  $('pNext').textContent = linkState === 'direct' ? '–' : nci ? until(nci) : '–';
  $('pWhy').textContent = livePower && linkState === 'direct' ? (livePower.reasons?.length ? 'Staying awake because ' + livePower.reasons.map((r) => reasonText[r] || r).join(', ') + '.' : 'Free to sleep when idle.') : p ? 'Settings you change here reach the computer at its next check-in.' : 'Power info appears after the computer connects once.';
  document.querySelectorAll('[data-set]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(s[seg.dataset.set]))));
}

export function setupPower() {
  document.querySelectorAll('[data-set] button').forEach((b) => (b.onclick = async () => {
    const key = b.parentElement.dataset.set; let v = b.dataset.v;
    v = v === 'true' ? true : v === 'false' ? false : isNaN(v) ? v : Number(v);
    const target = state.livePower || mac.power; if (target) target.settings = { ...(target.settings || {}), [key]: v };
    paint();
    try {
      if (state.dc && state.dc.readyState === 'open') { sendTerm({ t: 'settings', power: { [key]: v } }); $('pNote').textContent = 'Saved.'; }
      else { await post('settings', { power: { [key]: v } }); $('pNote').textContent = 'Saved. The computer picks it up at its next check-in.'; }
    } catch (e) { $('pNote').textContent = e.message; }
  }));
}
