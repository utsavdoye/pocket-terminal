// The header and banner: the computer's name, the status lamp and line, the ping and battery
// ticks, and the banner that says what's going on when the live link isn't up.

import { $, ago, toast } from '../core/dom.js';
import { pushReady } from '../core/store.js';
import { state, mac } from '../core/state.js';
import { connect } from '../connection/link.js';
import { jobs } from '../features/commands.js';
import { paintPower } from '../features/power.js';

export function paintPing() {
  const el = $('ping'); const on = state.dc && state.dc.readyState === 'open' && state.rtt !== null;
  el.hidden = !on; if (on) { el.textContent = `${state.rtt} ms`; el.className = 'tick ' + (state.rtt < 120 ? 'good' : state.rtt < 400 ? 'ok' : 'slow'); }
}

// ---------- status bar + banner ----------
function nextCheckIn() {
  if (mac.state !== 'sleeping' || !mac.nextWake) return null;
  let t = mac.nextWake; const step = (mac.checkIn || 5) * 60e3;
  while (t < Date.now() - 30e3 && step > 0) t += step;
  return t;
}
export function until(t) {
  const s = Math.round((t - Date.now()) / 1000); if (s <= 0) return 'any moment';
  const m = Math.floor(s / 60); return m ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

let wasLive = false;
export function paint() {
  if (!state.term) return;
  const { linkState, S } = state;
  const live = linkState === 'direct';
  if (live && !wasLive) { const a = $('app'); a.classList.remove('ignite'); void a.offsetWidth; a.classList.add('ignite'); setTimeout(() => a.classList.remove('ignite'), 1300); }
  wasLive = live;
  const name = mac.name || 'your computer';
  const p = state.livePower || mac.power;
  const nci = nextCheckIn();
  let look = 'off', ring = 0, status = '', banner = null;
  const queued = jobs.filter((j) => j.status === 'waiting').length;
  const queuedText = queued ? ` ${queued} command${queued > 1 ? 's' : ''} will run then.` : '';
  if (linkState === 'ended') { status = 'Live view ended'; }
  else if (linkState === 'direct') { look = 'awake'; ring = 1; status = S.viewer ? 'Live · view only' : 'Live · encrypted'; }
  else if (linkState === 'connecting' && !(mac.state === 'sleeping' && nci)) { look = 'connecting'; ring = 0.25; status = 'Connecting…'; }
  else if (linkState === 'noboard' || state.board.up.size === 0) {
    status = 'Offline';
    banner = ["This phone is offline", "Check its internet connection. It reconnects by itself.", false, [['Try again', () => { state.lastAttempt = 0; connect(); }]]];
  } else if (linkState === 'backup') {
    look = 'backup'; ring = 1; status = 'Backup route (slower)';
    banner = ['This network blocks the direct link', "Commands still work, a few seconds slower. The live terminal needs the direct link.", true, [['Try again', () => { state.lastAttempt = 0; connect(); }]]];
  } else if (mac.state === 'sleeping' && nci) {
    look = 'asleep'; ring = 1 - Math.max(0, Math.min(1, (nci - Date.now()) / ((mac.checkIn || 2) * 60e3))); // the lamp line fills up towards the check-in
    status = `Asleep · wakes in ${until(nci)}`;
    banner = [`${name} is asleep`, S.viewer ? `It checks in by itself in ${until(nci)}, then the live view continues.` : `It checks in by itself in ${until(nci)} and connects on its own. Anything you send now runs then.${pushReady() ? ' You can leave the app: your phone buzzes when it\'s ready.' : ''}${queuedText}`, !S.viewer, []];
  } else {
    status = mac.ts ? `Last seen ${ago(mac.ts)}` : 'Waiting…';
    const stuck = state.retryN >= 4;
    const longWait = stuck ? " Still nothing? Check that it's on and online, and that Pocket Terminal runs there (start it again with the command below). If you removed this phone there, pair it again." : '';
    const fixes = stuck ? [['Reconnect', () => { state.lastAttempt = 0; connect(); }], ['Copy start command', async () => { try { await navigator.clipboard.writeText('npx pocket-terminal'); toast('Copied. Run it on your computer.'); } catch { toast('Run on your computer: npx pocket-terminal'); } }]] : [];
    banner = S.viewer ? [`Waiting for ${name}`, 'The live view comes back by itself when it wakes up.', false, []]
      : [`Waiting for ${name}`, `It connects as soon as it wakes up. Commands you send now run then.${queuedText}${longWait}`, true, fixes];
  }
  $('macName').textContent = name;
  $('presence').className = 'presence ' + look;
  for (const c of ['awake', 'asleep', 'connecting', 'backup', 'off']) $('app').classList.toggle(c, c === look);
  $('arc').style.transform = `scaleX(${look === 'connecting' ? 0.3 : ring})`;
  $('status').textContent = status;
  if (banner) {
    if ($('banner').hidden) { const b = $('banner'); b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; }
    $('banner').hidden = false; $('bannerTitle').textContent = banner[0]; $('bannerText').textContent = banner[1];
    $('bannerForm').hidden = !banner[2];
    const row = $('bannerRow');
    const rk = banner[0] + '|' + banner[3].map((x) => x[0]).join();
    if (row.dataset.key !== rk) {
      row.dataset.key = rk; row.innerHTML = '';
      banner[3].forEach(([label, fn]) => { const b = document.createElement('button'); b.className = 'btn small ghost'; b.textContent = label; b.onclick = fn; row.appendChild(b); });
    }
  } else $('banner').hidden = true;
  if (p && p.percent != null) {
    $('batt').hidden = false; $('batt').textContent = `${p.onCharger ? '⚡' : ''}${p.percent}%`; $('batt').style.setProperty('--lvl', `${Math.max(8, Math.min(100, p.percent))}%`);
    $('batt').className = 'batt tick' + (p.onCharger ? ' charging' : p.percent < 20 ? ' low' : '');
  }
  $('connInfo').textContent = linkState === 'direct' ? 'Direct and end-to-end encrypted' : linkState === 'backup' ? 'Backup route: encrypted notes through the message board' : 'Not connected right now';
  paintPower(p, nci);
}
