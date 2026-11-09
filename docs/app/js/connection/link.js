// The direct link to the computer (a WebRTC data channel): open it, keep it alive, notice when
// it dies or the network changes, rebuild it, and keep knocking while the computer is asleep.

import { randomId } from '../crypto.js';
import { toast } from '../core/dom.js';
import { DEMO, ICE } from '../core/env.js';
import { state, mac } from '../core/state.js';
import { noteSeen } from '../core/computers.js';
import { nextWake } from '../core/schedule.js';
import { post } from './notes.js';
import { handleMsg } from './messages.js';
import { paint, paintPing } from '../ui/status.js';
import { openSheet } from '../ui/sheet.js';
import { flushPending } from '../terminal/input.js';
import { showTour } from '../features/tour.js';

let lastRx = 0, rxZ = 0;
Object.defineProperty(window, 'ptPacked', { get: () => rxZ }); // for tests: how many messages came packed
// Big messages from the computer come deflated (much less data on a weak signal).
const CAN_INFLATE = (() => { try { new DecompressionStream('deflate-raw'); return true; } catch { return false; } })();
const inflate = (buf) => new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
setInterval(() => { if (state.dc && state.dc.readyState === 'open' && document.visibilityState === 'visible') { state.pingSent = performance.now(); sendTerm({ t: 'ping' }); } else { state.rtt = null; paintPing(); } }, 5000);

// Called once the app opens: react to the app coming back on screen and to network changes.
export function watchLink() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { clearTimeout(state.retryTimer); return; }
    state.retryN = 0; state.knockAt = null; // a fresh knock now; earlier ones don't count as missed
    state.board.restart(); // phones kill background connections
    checkLink(2500);
  });
  // Weak or changing networks: Wi-Fi to mobile data, a lift, a train. React at once instead of
  // waiting for the old link to time out.
  addEventListener('online', () => { state.retryN = 0; state.board.restart(); checkLink(3000); });
  addEventListener('offline', () => paint());
  try { navigator.connection && navigator.connection.addEventListener('change', () => checkLink(3000)); } catch {}
  // A link can die without closing (signal gone). Heard nothing for 25 s while on screen: rebuild it.
  setInterval(() => {
    if (document.visibilityState === 'visible' && state.dc && state.dc.readyState === 'open' && Date.now() - lastRx > 25e3) rebuild();
  }, 3000);
}
// Is the link still alive? Ask, and rebuild it if nothing comes back in time.
export function checkLink(ms) {
  if (DEMO || state.ended) return;
  if (!state.dc || state.dc.readyState !== 'open') { state.lastAttempt = 0; return connect(); }
  const asked = Date.now(); sendTerm({ t: 'ping' });
  setTimeout(() => { if (lastRx < asked && state.dc) rebuild(); }, ms);
}
function rebuild() {
  const old = state.dc; state.dc = null; state.linkState = 'connecting'; paint();
  try { old && old.close(); state.pc && state.pc.close(); } catch {}
  state.attachFresh = false; state.lastAttempt = 0; connect();
}

// ---------- direct link ----------
function gatherDone(p, ms) {
  return new Promise((res) => {
    if (p.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, ms);
    p.addEventListener('icegatheringstatechange', () => { if (p.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
}
export async function connect({ hello = true } = {}) {
  if (DEMO || state.ended) return;
  if (state.dc && state.dc.readyState === 'open') return;
  if (Date.now() - state.lastAttempt < 5000) return;
  state.lastAttempt = Date.now();
  try { state.pc && state.pc.close(); } catch {}
  state.linkState = 'connecting'; paint();
  // Knock first, at once: if you switch apps a second later, the computer still hears it, and
  // tells your phone when it's up (it may be asleep).
  if (Date.now() < (state.boardFullUntil || 0)) { state.linkState = 'boardfull'; paint(); scheduleRetry(); return; }
  hello = hello && Date.now() - (state.helloAt || 0) > 4 * 60e3; // the offer itself also knocks
  if (hello) state.helloAt = Date.now();
  const hi = hello ? post('hello').catch((e) => e) : null;
  if (hello && !state.knockAt) state.knockAt = Date.now(); // when we first knocked (to tell a missed check-in)
  state.pc = new RTCPeerConnection({ iceServers: ICE });
  state.pc.oid = randomId(); // each attempt has its own id; only its own answer is accepted
  const ch = state.pc.createDataChannel('pt', { ordered: true });
  wire(ch);
  state.pc.onconnectionstatechange = () => {
    if (state.pc && state.pc.connectionState === 'failed' && (!state.dc || state.dc.readyState !== 'open')) { state.linkState = 'backup'; paint(); }
    if (state.pc && state.pc.connectionState === 'disconnected' && state.dc && state.dc.readyState === 'open') checkLink(4000); // signal dropped or network changed
  };
  await state.pc.setLocalDescription(await state.pc.createOffer());
  await gatherDone(state.pc, 4000);
  const mine = state.pc;
  try {
    if (hi) { const e = await hi; if (e instanceof Error) throw e; }
    if (state.pc !== mine) return; // a newer attempt replaced this one
    await post('offer', { oid: mine.oid, sdp: mine.localDescription.sdp });
    state.offerAt = Date.now();
  } catch (e) {
    if (/too many/i.test(e.message)) { // the board's daily limit for this internet connection
      state.boardFullUntil = Date.now() + 10 * 60e3; state.linkState = 'boardfull'; paint(); scheduleRetry(); return;
    }
    state.linkState = 'noboard'; paint(); scheduleRetry(true); return;
  }
  clearTimeout(state.answerTimer);
  state.answerTimer = setTimeout(() => { if (!state.dc || state.dc.readyState !== 'open') { state.linkState = 'waiting'; paint(); scheduleRetry(); } }, 15e3);
}

// No answer? The computer may be asleep or briefly offline. Keep knocking while the app is open,
// so it connects by itself at the computer's next check-in.
//
// Every knock is a note on a free public board, which allows a few hundred notes a day per
// internet connection (phone and computer on the same Wi-Fi share it). So knocks are budgeted:
// an offer stays good for 90 s and is reused until then, a "hello" goes at most every 4 min, and
// after 10 min of waiting it knocks only every 3 min.
function scheduleRetry(net = false) {
  clearTimeout(state.retryTimer);
  if (document.visibilityState !== 'visible') return;
  // net: this phone's own internet failed, so try again soon. Otherwise the computer is likely asleep.
  let ms = net ? [3e3, 6e3, 12e3, 20e3][Math.min(state.retryN++, 3)] : [45e3, 60e3, 90e3, 120e3][Math.min(state.retryN++, 3)];
  if (state.boardFullUntil > Date.now()) ms = state.boardFullUntil - Date.now();
  // Asleep, and we know when it checks in next: knock again just before that (a fresh offer takes
  // ~4 s to prepare), so it's waiting in the mailbox the moment the computer looks. Then it can
  // connect within a couple of seconds of waking.
  const nw = !net && !(state.boardFullUntil > Date.now()) && mac.state === 'sleeping' && nextWake(mac.plan, Date.now() + 8e3);
  if (nw) {
    // The last offer is still good at that check-in (90 s): keep it, knock again only when it isn't.
    const until = (state.offerAt || 0) + 80e3;
    ms = Math.max(3e3, nw - Date.now() - 6e3);
    if (nw < until) ms = Math.max(ms, nextWake(mac.plan, until) - Date.now() - 6e3);
    if (state.knockAt && Date.now() - state.knockAt > 10 * 60e3) ms = Math.max(ms, 3 * 60e3); // a long wait: knock less often
  }
  state.retryTimer = setTimeout(() => { if (!state.dc || state.dc.readyState !== 'open') { state.lastAttempt = 0; connect(); } }, ms);
}

function wire(ch) {
  ch.onopen = () => {
    setTimeout(() => showTour(), 1500);
    state.dc = ch; state.linkState = 'direct'; state.knockAt = null; clearTimeout(state.answerTimer); clearTimeout(state.openTimer); clearTimeout(state.retryTimer); state.retryN = 0;
    mac.state = 'online'; mac.ts = Date.now(); state.lastPong = Date.now(); if (state.S && !state.S.viewer) noteSeen(state.S.topic, mac.ts);
    lastRx = Date.now();
    sendTerm({ t: 'attach', sid: state.SID, fresh: state.attachFresh, cols: state.term.cols, rows: state.term.rows, z: CAN_INFLATE ? 1 : 0 }); // first, before any resize
    state.attachFresh = true;
    state.fit.fit(); sendTerm({ t: 'r', cols: state.term.cols, rows: state.term.rows });
    flushPending();
    if (state.openAgentsSoon) { state.openAgentsSoon = false; openSheet('sessions'); }
    paint();
  };
  ch.binaryType = 'arraybuffer';
  let inq = Promise.resolve(); // messages are handled strictly in order, even while one is being unpacked
  ch.onmessage = (e) => {
    lastRx = Date.now();
    const d = e.data;
    if (typeof d === 'string') { inq = inq.then(() => { let m; try { m = JSON.parse(d); } catch { return; } handleMsg(m); }); return; }
    rxZ++;
    inq = inq.then(() => inflate(d)).then((t) => { let m; try { m = JSON.parse(t); } catch { return; } handleMsg(m); }).catch(() => {});
  };
  ch.onclose = () => {
    if (state.dc !== ch) return;
    state.dc = null; state.linkState = 'waiting'; paint();
    // The Mac probably went to sleep. It will tell the board; we reconnect when it's back.
    setTimeout(() => { if (document.visibilityState === 'visible') connect(); }, 2000);
  };
}
export const sendTerm = (m) => { if (state.dc && state.dc.readyState === 'open') state.dc.send(JSON.stringify(m)); };

// Wait while the link has more than 1 MB queued (uploads).
export function drain() {
  const dc = state.dc;
  if (!dc || !dc.bufferedAmount || dc.bufferedAmount < 1048576) return Promise.resolve();
  return new Promise((r) => { const t = setTimeout(r, 5000); dc.bufferedAmountLowThreshold = 262144; dc.addEventListener('bufferedamountlow', () => { clearTimeout(t); r(); }, { once: true }); });
}
