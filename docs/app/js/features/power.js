// Power and battery: the computer's battery, whether it's awake and why, its next check-in, and
// the power settings you can change from here.

import { $ } from '../core/dom.js';
import { store } from '../core/store.js';
import { state, mac } from '../core/state.js';
import { sendTerm } from '../connection/link.js';
import { post } from '../connection/notes.js';
import { paint, until } from '../ui/status.js';

// ---------- power ----------
const reasonText = { 'on charger': "it's charging", 'phone connected': 'your phone is connected', 'job running': 'a command is running', 'recent typing': 'you typed recently', 'checking in': "it's checking in", 'instant mode': 'Instant mode is on', 'program running': 'a program is still working' };
const SPEED_HINT = {
  smart: 'Answers in under 20 s for 30 min after you use it, under 1 min in your usual hours, under 3 min at night. Best balance.',
  fast: 'Answers in under 20 s, any time. Uses a bit more battery.',
  balanced: 'Answers in under 1 min. Light on battery.',
  saver: 'Answers in under 3 min. Lightest on battery.',
  instant: 'Never sleeps: answers in about 2 s. Uses the most battery.',
};
export function paintPower(p, nci) {
  const { linkState, livePower } = state;
  const s = (p && p.settings) || {};
  $('pBatt').textContent = p && p.percent != null ? `${p.percent}%${p.onCharger ? ' ⚡' : ''}` : '–';
  $('pState').textContent = linkState === 'direct' ? 'Awake' : mac.state === 'sleeping' ? 'Asleep' : '–';
  $('pNext').textContent = linkState === 'direct' ? '–' : nci ? until(nci) : '–';
  $('pWhy').textContent = livePower && linkState === 'direct' ? (livePower.reasons?.length ? 'Staying awake because ' + livePower.reasons.map((r) => reasonText[r] || r).join(', ') + '.' : 'Free to sleep when idle.') : p ? 'Settings you change here reach the computer at its next check-in.' : 'Power info appears after the computer connects once.';
  const sp = s.batteryMode === 'instant' ? 'instant' : s.speed || 'smart';
  document.querySelectorAll('#speedSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === sp));
  $('pSpeedHint').textContent = store.get('os') === 'win32' && (sp === 'smart' || sp === 'fast') ? SPEED_HINT[sp].replace(/under 20 s/g, 'under 1 min') + ' (Windows wakes at most once a minute.)' : SPEED_HINT[sp];
  document.querySelectorAll('[data-set]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(s[seg.dataset.set]))));
}

async function sendPower(change) {
  const target = state.livePower || mac.power; if (target) target.settings = { ...(target.settings || {}), ...change };
  paint();
  try {
    if (state.dc && state.dc.readyState === 'open') { sendTerm({ t: 'settings', power: change }); $('pNote').textContent = 'Saved.'; }
    else { await post('settings', { power: change }); $('pNote').textContent = 'Saved. The computer picks it up at its next check-in.'; }
  } catch (e) { $('pNote').textContent = e.message; }
}

export function setupPower() {
  // One choice on screen, two settings on the computer: "Always on" is Instant mode; the others
  // are how often it wakes up while asleep.
  document.querySelectorAll('#speedSeg button').forEach((b) => (b.onclick = () => {
    const v = b.dataset.v; sendPower(v === 'instant' ? { batteryMode: 'instant' } : { batteryMode: 'saver', speed: v });
  }));
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
