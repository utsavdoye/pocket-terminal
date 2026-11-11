// The header and banner: the computer's name, the status lamp and line, the ping and battery
// ticks, and the banner that says what's going on when the live link isn't up.

import { $, ago, toast } from '../core/dom.js';
import { DEMO } from '../core/env.js';
import { pushReady } from '../core/store.js';
import { state, mac } from '../core/state.js';
import { connect } from '../connection/link.js';
import { jobs } from '../features/commands.js';
import { paintPower } from '../features/power.js';
import { nextWake } from '../core/schedule.js';

export function paintPing() {
  const el = $('ping'); const on = state.dc && state.dc.readyState === 'open' && state.rtt !== null;
  el.hidden = !on; if (on) { el.textContent = `${state.rtt} ms`; el.className = 'tick ' + (state.rtt < 120 ? 'good' : state.rtt < 400 ? 'ok' : 'slow'); }
}

// ---------- status bar + banner ----------
// When the sleeping computer next checks in. With its plan we know to the second; it then needs a
// few seconds (Wi-Fi, mailbox, link) to connect. 'late': a check-in we knocked before went by with
// no answer (it may be off, out of battery, or offline).
const CONNECT = 12e3;
export function nextCheckIn() {
  if (mac.state !== 'sleeping') return null;
  const now = Date.now();
  if (mac.plan) {
    // A check-in in the last few seconds counts ("waking up") only if it came after our knock:
    // earlier ones couldn't have seen it.
    const at = nextWake(mac.plan, Math.max(now - CONNECT, (state.knockAt || now) + 2e3)); if (!at) return null;
    const first = state.knockAt && nextWake(mac.plan, state.knockAt + 3e3);
    const late = first && now > first + CONNECT + 20e3;
    const piece = mac.plan.find(([s, e]) => s <= at && (e === null || at < e)) || mac.plan[0];
    return { at: at > now ? at : nextWake(mac.plan, now) || at, waking: at <= now, late, every: piece[2] * 1000 };
  }
  if (!mac.nextWake) return null; // a computer from before plans: step by its check-in time
  let t = mac.nextWake; const step = (mac.checkIn || 5) * 60e3;
  while (t < now - 30e3 && step > 0) t += step;
  return { at: t, waking: t <= now, late: false, every: step };
}
export function until(t) {
  const s = Math.round((t - Date.now()) / 1000); if (s <= 0) return 'any moment';
  const m = Math.floor(s / 60); return m ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

let wasLive = false, everLive = false, connectingSince = 0;
export function paint() {
  if (!state.term) return;
  const { linkState, S } = state;
  const live = linkState === 'direct';
  if (live && !wasLive) { const a = $('app'); a.classList.remove('ignite'); void a.offsetWidth; a.classList.add('ignite'); setTimeout(() => a.classList.remove('ignite'), 1300); }
  wasLive = live; if (live) everLive = true;
  connectingSince = linkState === 'connecting' ? connectingSince || Date.now() : 0;
  const name = mac.name || 'your computer';
  const p = state.livePower || mac.power;
  const nci = nextCheckIn();
  let look = 'off', ring = 0, status = '', banner = null;
  const queued = jobs.filter((j) => j.status === 'waiting').length;
  const queuedText = queued ? ` ${queued} command${queued > 1 ? 's' : ''} will run then.` : '';
  if (linkState === 'ended') { status = 'Live view ended'; }
  else if (linkState === 'direct') { look = 'awake'; ring = 1; status = S.viewer ? 'Live · view only' : DEMO ? 'Live · demo' : 'Live · encrypted'; }
  else if (linkState === 'connecting' && !(mac.state === 'sleeping' && nci)) {
    look = 'connecting'; ring = 0.25; status = everLive ? 'Reconnecting…' : 'Connecting…';
    // Slower than usual (a weak signal): say what is happening and how long it can take.
    if (Date.now() - connectingSince > 7e3) banner = [everLive ? `Reconnecting to ${name}` : `Still connecting to ${name}`, 'This usually takes 3 to 5 seconds. On a weak signal it can take up to 20. It keeps trying by itself' + (S.viewer ? '.' : ', and anything you type is sent as soon as it’s back.'), false, []];
  }
  else if (linkState === 'boardfull') {
    look = 'off'; status = 'Message board full today';
    banner = ['The free message board is full for today', `Your phone finds ${name} through a free public board, and this internet connection used up today's messages (it resets at ${new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}). To connect now, put this phone on mobile data, or ${name} on a different network (like your phone's hotspot).`, false, [['Try again', () => { state.boardFullUntil = 0; state.lastAttempt = 0; connect(); }]]];
  }
  else if (linkState === 'noboard' || state.board.up.size === 0) {
    status = 'Offline';
    banner = navigator.onLine !== false && linkState === 'noboard'
      ? ["Can't reach the message board", 'This phone is online, but the free board that finds your computer is not answering. It tries again by itself.', false, [['Try again', () => { state.lastAttempt = 0; connect(); }]]]
      : ["This phone is offline", "Check its internet connection. It reconnects by itself.", false, [['Try again', () => { state.lastAttempt = 0; connect(); }]]];
  } else if (linkState === 'backup') {
    look = 'backup'; ring = 1; status = 'Backup route (slower)';
    banner = ['This network blocks the direct link', "Commands still work, a few seconds slower. The live terminal needs the direct link.", true, [['Try again', () => { state.lastAttempt = 0; connect(); }]]];
  } else if (mac.state === 'sleeping' && nci) {
    look = 'asleep'; ring = nci.waking ? 1 : 1 - Math.max(0, Math.min(1, (nci.at - Date.now()) / nci.every)); // the lamp line fills up towards the check-in
    const leave = pushReady() ? ' You can leave the app: your phone buzzes when it\'s ready.' : ' Turn on notifications in Settings to get a buzz when it\'s ready.';
    if (nci.waking) {
      status = 'Waking up · connecting…';
      banner = [`${name} is waking up`, `Connecting now, a few seconds.${S.viewer ? '' : leave}${queuedText}`, !S.viewer, []];
    } else if (nci.late) {
      status = `Asleep · next try in ${until(nci.at)}`;
      banner = [`${name} is taking longer than usual`, `It missed its check-in. It may be off, out of battery, or offline. It tries again in ${until(nci.at)}.${queuedText}`, !S.viewer, [['Try now', () => { state.lastAttempt = 0; connect(); }]]];
    } else {
      status = `Asleep · wakes in ${until(nci.at)}`;
      banner = [`${name} is asleep`, S.viewer ? `It wakes up in ${until(nci.at)}, then the live view continues.` : `It wakes up in ${until(nci.at)} and connects by itself.${leave} Anything you send now runs then.${queuedText}`, !S.viewer, []];
    }
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
  paintPower(p, nci && nci.at);
}
