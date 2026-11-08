// The direct link to one phone: answering its WebRTC offer, then the data channel.
// Sending (with compression and splitting big messages), gathering terminal output and
// dropping the backlog on a slow link, and which terminal session this phone is showing.
// The phone's messages are handled in messages.js.

const os = require('os');
const zlib = require('zlib');
const ndc = require('node-datachannel');
const { onMessage } = require('./messages');
const VERSION = require('../package.json').version;
const PROTO = 1; // bump when a message changes in a way older phones or computers can't follow (see PROTOCOL.md)

const DEFAULT_ICE = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];

// Sets ctx.answerOffer. Needs ctx.post (mailbox.js).
function startChannel(ctx) {
  const { cfg, core, power, log, x, viewer, keys, peers } = ctx;
  const act = (ev) => { try { x.activity && x.activity(ev); } catch {} };

  // --- the direct link ---
  function answerOffer(m) {
    const pc = new ndc.PeerConnection('mac', { iceServers: cfg.iceServers || DEFAULT_ICE });
    let answered = false, linked = false;
    const sendAnswer = () => {
      if (answered) return; answered = true;
      const d = pc.localDescription();
      if (d) { ctx.post('answer', { oid: m.oid, sdp: d.sdp }); log(`answered offer ${m.oid}`); }
    };
    pc.onGatheringStateChange((s) => { if (s === 'complete') sendAnswer(); });
    pc.onLocalDescription(() => setTimeout(sendAnswer, 4000)); // don't wait forever for slow STUN
    pc.onDataChannel((dc) => { linked = true; attach(pc, dc); });
    pc.onStateChange((s) => { if (s === 'failed' || s === 'closed') { try { pc.close(); } catch {} } });
    setTimeout(() => { if (!linked) { log('direct link did not open (phone may use the backup route)'); try { pc.close(); } catch {} } }, 45e3);
    try { pc.setRemoteDescription(m.sdp, 'offer'); } catch (e) { log('bad offer: ' + e.message); }
  }

  function attach(pc, dc) {
    // L: this link's state, shared with messages.js.
    const L = { dc, act, typed: 0, zOK: false, size: {}, phoneSize: null, gets: new Map(), puts: new Map() };
    const max = Math.max(16e3, Math.min(dc.maxMessageSize?.() || 65536, 200e3)) - 1024;
    // Phones that can unpack it get big messages deflated: terminal text shrinks 3-10x,
    // which is what makes a weak signal usable.
    const wire = (s) => {
      if (L.zOK && s.length > 1024) {
        const z = zlib.deflateRawSync(s);
        if (z.length < s.length * 0.8) { dc.sendMessageBinary(z); return; }
      }
      dc.sendMessage(s);
    };
    const send = (msg) => {
      if (!dc.isOpen()) return;
      let s = JSON.stringify(msg);
      if (s.length <= max) { wire(s); return; }
      // Big screen replays are split into pieces that fit.
      if (msg.t === 'reset' || msg.t === 'o') {
        const d = msg.d; const step = Math.floor(max / 2);
        for (let i = 0; i < d.length; i += step) wire(JSON.stringify({ t: i === 0 && msg.t === 'reset' ? 'reset' : 'o', d: d.slice(i, i + step) }));
      } else if (msg.t === 'result') {
        wire(JSON.stringify({ ...msg, out: msg.out.slice(-Math.floor(max / 2)) }));
      } else {
        // Anything else that's too big (a long diff, a folder with many files): packed, it
        // usually fits; if not, it goes in numbered parts the phone puts back together.
        if (L.zOK) { const z = zlib.deflateRawSync(s); if (z.length <= max) { dc.sendMessageBinary(z); return; } }
        const id = Math.random().toString(36).slice(2, 10), step = Math.floor(max / 2), n = Math.ceil(s.length / step);
        for (let i = 0; i < n; i++) wire(JSON.stringify({ t: 'part', id, i, n, d: s.slice(i * step, (i + 1) * step) }));
      }
    };
    // Terminal output is gathered for a moment and sent in one piece. If the link is slower than
    // the output (a weak signal and a noisy build), the backlog is dropped and the phone gets the
    // current screen once the link catches up, so what you see is never minutes behind.
    const OUT_HIGH = 48 * 1024, OUT_LOW = 8 * 1024;
    const queued = () => { try { return dc.bufferedAmount(); } catch { return 0; } };
    let pend = '', flushT = null, behind = false, lastFlush = 0;
    const flushOut = () => {
      clearTimeout(flushT); flushT = null;
      if (!dc.isOpen()) { pend = ''; return; }
      if (behind) { pend = ''; return; }
      if (queued() > OUT_HIGH) {
        pend = ''; behind = true;
        const wait = () => {
          if (!dc.isOpen()) return;
          if (queued() > OUT_LOW) return setTimeout(wait, 200);
          behind = false; if (sess) send({ t: 'reset', d: sess.screen() });
        };
        setTimeout(wait, 200); return;
      }
      if (pend) { const d = pend; pend = ''; lastFlush = Date.now(); send({ t: 'o', d }); }
    };
    const client = (msg) => {
      if (msg.t === 'o') {
        if (behind) return;
        pend += msg.d;
        // A keystroke's echo goes out at once (no added delay). Only a burst of output is gathered.
        if (pend.length > 32e3 || (!flushT && Date.now() - lastFlush > 40)) flushOut();
        else if (!flushT) flushT = setTimeout(flushOut, 12);
        return;
      }
      flushOut(); send(msg); // anything else keeps its place after the output before it
    };
    // Wait while more than 1 MB is queued on the link (big files and pages).
    const waiters = [];
    try { dc.setBufferedAmountLowThreshold(256 * 1024); dc.onBufferedAmountLow(() => waiters.splice(0).forEach((r) => r())); } catch {}
    const drain = () => (dc.isOpen() && dc.bufferedAmount() > 1024 * 1024
      ? new Promise((r) => { waiters.push(r); setTimeout(r, 5000); }) : Promise.resolve());
    const info = { key: null, seen: Date.now() }; // seen: the app pings every 5 s while it's on screen

    // The phone says which terminal session it is continuing ("attach"). Older phones don't:
    // after a moment they get the shared session. A viewer always gets the shared session.
    let sess = null, attachTimer = null;
    const deviceKey = cfg.deviceId || keys.topic.slice(3, 11);
    // Sessions started on the computer (L-…), agents outside Pocket Terminal (C-…) and their
    // permission questions (Q-…) belong to the computer, so every paired phone sees them.
    const keyFor = (sid) => { const v = String(sid || 'shared').replace(/[^\w-]/g, '').slice(0, 40) || 'shared'; return /^[LQC]-/.test(v) ? `local:${v}` : `${deviceKey}:${v}`; };
    const sidOf = (key) => (key.startsWith('local:') ? key.slice(6) : key.slice(deviceKey.length + 1));
    const listAll = () => ({ t: 'sessions', list: [...core.list(deviceKey + ':'), ...core.list('local:')], current: sess ? sidOf(sess.key) : null });
    // Show a session on this phone, at this phone's size (sz). While a session shared with the
    // computer's window redraws for the phone, its output waits, then comes as one clean screen.
    const show = (s, sz) => {
      if (sess) sess.clients.delete(client);
      pend = ''; clearTimeout(flushT); flushT = null;
      sess = s; info.key = s.key;
      const go = (screen) => {
        if (sess !== s || !dc.isOpen()) return;
        sess.clients.add(client);
        send({ t: 'reset', d: screen });
        const z = sess.size(); if (z) send({ t: 'size', ...z });
      };
      if (sz && sz.cols) s.fit(sz.cols | 0, sz.rows | 0, go); else go(s.screen());
    };
    const bind = (sid, { fresh = true, sz = null } = {}) => {
      if (sess) return sess;
      clearTimeout(attachTimer);
      if (viewer) { show(core.session(cfg.watchKey)); send({ t: 'hi', proto: PROTO, v: VERSION, os: process.platform, viewer: true, canAnswer: !!cfg.canAnswer, name: cfg.name || os.hostname() }); const q = core.question(cfg.watchKey); if (q) send({ t: 'alert', kind: 'input', ...q }); return sess; }
      let key = keyFor(sid);
      if (/^local:[QC]-/.test(key) || (key.startsWith('local:') && !core.isSession(key))) key = keyFor(null); // not a terminal (any more)
      if (fresh) core.dropOthers(deviceKey + ':', key); // this phone started fresh: close its old terminals that sit idle
      const s = core.session(key);
      log(`terminal: ${s.hasShell() ? 'continuing' : 'new'} session ${key.split(':')[1].slice(0, 6)}`);
      act({ ev: 'terminal', sid: sidOf(key).slice(0, 12) });
      send({ t: 'hi', proto: PROTO, v: VERSION, os: process.platform, push: x.pushKey || null, sid: sidOf(key) });
      show(s, sz);
      if (power) send({ t: 'power', ...power.status() });
      return sess;
    };
    const onOpen = () => {
      peers.set(send, info);
      if (!viewer) power && power.setPhoneWanting(true);
      log(`${viewer ? 'viewer' : 'phone'} connected directly (${peers.size} open)`);
      act({ ev: 'connected' });
      attachTimer = setTimeout(() => { bind(null); if (L.size.cols && !viewer) sess.resize(L.size.cols | 0, L.size.rows | 0); }, 1500);
    };
    if (dc.isOpen()) onOpen(); else dc.onOpen(onOpen);

    const fail = (t, id, e) => send({ t, id, error: String((e && e.message) || e).replace(/^E[A-Z]+: /, '').slice(0, 200) });
    Object.assign(L, { send, drain, info, fail, show, bind, keyFor, sidOf, listAll, sess: () => sess });
    dc.onMessage((raw) => onMessage(ctx, L, raw));
    dc.onClosed(() => {
      clearTimeout(attachTimer);
      for (const st of L.gets.values()) st.cancelled = true;
      for (const r of L.puts.values()) r.abort();
      peers.delete(send); sess && sess.clients.delete(client); clearTimeout(flushT);
      if (!viewer) power && power.setPhoneWanting(peers.size > 0);
      log(`${viewer ? 'viewer' : 'phone'} disconnected (${peers.size} open)`);
      act({ ev: 'disconnected', keys: L.typed });
      try { pc.close(); } catch {}
    });
  }

  ctx.answerOffer = answerOffer;
}

module.exports = { startChannel, DEFAULT_ICE };
