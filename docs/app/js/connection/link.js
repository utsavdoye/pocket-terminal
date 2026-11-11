// The direct link to the computer (a WebRTC data channel): open it, keep it alive, notice when
// it dies or the network changes, rebuild it, and keep knocking while the computer is asleep.

import { randomId } from '../crypto.js';
import { toast } from '../core/dom.js';
import { DEMO, ICE, ownBoard } from '../core/env.js';
import { state, mac } from '../core/state.js';
import { noteSeen } from '../core/computers.js';
import { nextWake } from '../core/schedule.js';
import { post } from './notes.js';
import { PipeChannel, pipeUrl } from './pipe.js';
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
// A relay (TURN) for networks that block a direct link: mobile data and strict Wi-Fi
// put many people behind one shared address, and a direct link can't get through. The login comes
// from our own board, lasts 12 hours, and is fetched once while the app opens (in parallel with
// everything else). The relay only passes on traffic that is already end-to-end encrypted.
let relay = null; // { servers, until }
let relayAsk = null;
export function prefetchRelay() {
  if (relayAsk) return relayAsk;
  const own = state.S && ownBoard(state.S.boards);
  if (!own || (relay && relay.until > Date.now() + (relay.servers.length ? 3600e3 : 0))) return Promise.resolve();
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
  relayAsk = fetch(`${own}/${state.S.topic}/ice`, { signal: ctl.signal }).then((r) => r.json())
    .then((d) => { if (Array.isArray(d.iceServers)) relay = { servers: d.iceServers, until: Date.now() + (Number(d.ttl) || 0) * 1000 }; })
    .catch(() => {}).finally(() => { clearTimeout(t); relayAsk = null; });
  return relayAsk;
}
async function iceConfig() {
  await Promise.race([prefetchRelay(), new Promise((r) => setTimeout(r, 2500))]);
  return relay && relay.servers.length ? [...ICE, ...relay.servers] : ICE;
}
Object.defineProperty(window, 'ptRelay', { get: () => !!(relay && relay.servers.length) }); // for tests and Copy info

// Post the offer as soon as the addresses that matter are known: the relay's when there is one,
// otherwise this phone's internet address. Waiting for every last address took 4 s.
function gatherDone(p, ms, withRelay) {
  return new Promise((res) => {
    if (p.iceGatheringState === 'complete') return res();
    let quick = null;
    const done = () => { clearTimeout(t); clearTimeout(quick); res(); };
    const t = setTimeout(done, ms);
    p.addEventListener('icecandidate', (e) => {
      const c = e.candidate && e.candidate.candidate;
      if (c && (/ typ relay /.test(c) || (!withRelay && / typ srflx /.test(c)))) { clearTimeout(quick); quick = setTimeout(done, 150); }
    });
    p.addEventListener('icegatheringstatechange', () => { if (p.iceGatheringState === 'complete') done(); });
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
  const ice = await iceConfig();
  if (state.dc && state.dc.readyState === 'open') return; // connected while we waited
  const withRelay = ice.length > ICE.length;
  // pt_relayOnly: always go through the relay (tests, and to check the relay works on a network).
  // pt_noDirect: act as if this network blocks every direct link (tests, and to try the board's pipe).
  let relayOnly = false, noDirect = false;
  try { relayOnly = withRelay && localStorage.getItem('pt_relayOnly') === 'true'; noDirect = localStorage.getItem('pt_noDirect') === 'true'; } catch {}
  // A browser without direct links (WebRTC turned off, some locked-down phones): straight to the pipe.
  try { state.pc = new RTCPeerConnection({ iceServers: noDirect ? [] : ice, iceTransportPolicy: relayOnly || noDirect ? 'relay' : 'all' }); }
  catch { state.pc = null; if (hi) await hi; if (!tryPipe()) { state.linkState = 'backup'; paint(); } return; }
  state.pc.oid = randomId(); // each attempt has its own id; only its own answer is accepted
  const ch = state.pc.createDataChannel('pt', { ordered: true });
  wire(ch);
  state.pc.onconnectionstatechange = () => {
    if (state.pc && state.pc.connectionState === 'failed' && (!state.dc || state.dc.readyState !== 'open') && !tryPipe()) { state.linkState = 'backup'; paint(); }
    if (state.pc && state.pc.connectionState === 'disconnected' && state.dc && state.dc.readyState === 'open') checkLink(4000); // signal dropped or network changed
  };
  await state.pc.setLocalDescription(await state.pc.createOffer());
  await gatherDone(state.pc, withRelay ? 3000 : 2500, withRelay);
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

// The direct link didn't open (this network blocks it): carry on through the board's pipe. The
// phone opens its side and leaves a sealed "pipe" note; the computer opens the other side.
// Returns false when there's no pipe to try (a board without one: the slower backup route).
export function tryPipe() {
  if (DEMO || state.ended || (state.dc && state.dc.readyState === 'open')) return true;
  if (state.pipe && state.pipe.readyState !== 'closed') return true; // already trying
  const id = randomId() + randomId(), url = pipeUrl(id);
  if (!url) return false;
  const ch = (state.pipe = new PipeChannel(id, url));
  wire(ch);
  post('pipe', { pipe: id }).catch(() => ch.close());
  return true;
}

function wire(ch) {
  ch.onopen = () => {
    if (ch.pipe) { const pc = state.pc; state.pc = null; try { pc && pc.close(); } catch {} } // the direct try is over
    else if (state.pipe) { try { state.pipe.close(); } catch {} state.pipe = null; } // direct opened after all
    setTimeout(() => showTour(), 1500);
    state.dc = ch; state.linkState = 'direct'; state.route = null; state.knockAt = null; clearTimeout(state.answerTimer); clearTimeout(state.openTimer); clearTimeout(state.retryTimer); state.retryN = 0;
    mac.state = 'online'; mac.ts = Date.now(); state.lastPong = Date.now(); if (state.S && !state.S.viewer) noteSeen(state.S.topic, mac.ts);
    lastRx = Date.now();
    sendTerm({ t: 'attach', sid: state.SID, fresh: state.attachFresh, cols: state.term.cols, rows: state.term.rows, z: CAN_INFLATE && !ch.pipe ? 1 : 0 }); // first, before any resize (a pipe seals and packs every message itself)
    state.attachFresh = true;
    state.fit.fit(); sendTerm({ t: 'r', cols: state.term.cols, rows: state.term.rows });
    flushPending();
    if (state.openAgentsSoon) { state.openAgentsSoon = false; openSheet('sessions'); }
    paint();
    // Which way it went: straight to the computer, through the relay, or through the board's pipe (Settings).
    if (ch.pipe) { state.route = 'board'; paint(); return; }
    const pc = state.pc;
    setTimeout(() => pc && pc.getStats().then((st) => {
      let pair = null; st.forEach((r) => { if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) pair = r; });
      const local = pair && st.get(pair.localCandidateId), remote = pair && st.get(pair.remoteCandidateId);
      state.route = local && remote ? (local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'relay' : 'direct') : null;
      paint();
    }).catch(() => {}), 800);
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
