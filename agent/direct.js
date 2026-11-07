// Direct mode: your phone connects straight to your Mac (WebRTC, the same tech
// video calls use). No server of yours in between.
//
// How a connection is born:
//   1. Phone posts an encrypted "hello" + "offer" (its addresses) to your private mailbox
//      on a free public message board (ntfy.sh by default).
//   2. Mac reads it, posts an encrypted "answer" (its addresses).
//   3. Both "knock" on each other at the same time (hole punching) → direct, encrypted link.
//   4. From then on: keystrokes and output flow phone ⇄ Mac directly. The board sees nothing.
//
// If a network blocks direct links entirely, commands still work through the board as
// encrypted notes (slower, but works anywhere normal web browsing works).
// While the Mac sleeps, notes wait on the board (12 h) and run at the next check-in.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const ndc = require('node-datachannel');
const { derive, seal, open, msgId } = require('./lib/crypto');
const { Board, MAX_NOTE } = require('./lib/board');
const files = require('./lib/files');
const preview = require('./lib/preview');
const webpush = require('./lib/webpush');
const { choicesFor } = require('./lib/core');

const DEFAULT_ICE = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];
const FRESH = { hello: 3 * 60e3, offer: 90e3, settings: 24 * 3600e3 };

// cfg.role: 'owner' (a paired phone: full access) or 'viewer' (a share link: watch one session, nothing else).
// x: shared helpers from devices.js (push keys and subscriptions, share links).
function startDirect({ cfg, core, power, log, dir, x = {} }) {
  const viewer = cfg.role === 'viewer';
  const keys = derive(cfg.secret);
  const STATE = path.join(dir, cfg.stateFile || 'direct-state.json');
  let state = {}; try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
  const seen = new Set(state.seen || []);
  const board = new Board(cfg.boards || ['https://ntfy.sh'], keys.topic, { log, since: state.since || {} });
  const maxCmdAge = (cfg.maxCommandAgeMinutes || 60) * 60e3;
  const peers = new Map(); // send -> { key: the session it shows }
  let lastStatus = { state: null, at: 0, checkIn: null };
  let phoneWaitingTimer = null, readyTimer = null, lastReady = 0;
  const READY_AFTER = Number(process.env.POCKET_READY_AFTER_MS) || 15e3; // tests make it shorter

  let saveT;
  const saveState = () => { clearTimeout(saveT); saveT = setTimeout(() => {
    fs.writeFile(STATE, JSON.stringify({ since: board.since, seen: [...seen].slice(-500) }), { mode: 0o600 }, () => {});
  }, 500); };

  async function post(type, extra = {}) {
    const note = { id: msgId(), ts: Date.now(), from: 'mac', type, ...extra };
    try { await board.publish(seal(keys, note)); } catch (e) { log(`could not post ${type}: ${e.message}`); }
  }

  // --- status: posted rarely, to stay well inside the board's free daily limit ---
  function statusBody(st) {
    const p = power ? power.status() : null;
    return { state: st, name: cfg.name || os.hostname(), os: process.platform, nextWake: p && st === 'sleeping' ? p.nextWake : null,
      checkIn: p ? p.nextCheckInMinutes : null, power: p ? { percent: p.percent, onCharger: p.onCharger, settings: p.settings } : null };
  }
  async function postStatus(st, { force = false } = {}) {
    const b = statusBody(st);
    const same = lastStatus.state === st && lastStatus.checkIn === b.checkIn && Date.now() - lastStatus.at < 60 * 60e3;
    if (same && !force) return;
    lastStatus = { state: st, at: Date.now(), checkIn: b.checkIn };
    await post('status', b);
  }

  // --- the direct link ---
  function answerOffer(m) {
    const pc = new ndc.PeerConnection('mac', { iceServers: cfg.iceServers || DEFAULT_ICE });
    let answered = false, linked = false;
    const sendAnswer = () => {
      if (answered) return; answered = true;
      const d = pc.localDescription();
      if (d) { post('answer', { oid: m.oid, sdp: d.sdp }); log(`answered offer ${m.oid}`); }
    };
    pc.onGatheringStateChange((s) => { if (s === 'complete') sendAnswer(); });
    pc.onLocalDescription(() => setTimeout(sendAnswer, 4000)); // don't wait forever for slow STUN
    pc.onDataChannel((dc) => { linked = true; attach(pc, dc); });
    pc.onStateChange((s) => { if (s === 'failed' || s === 'closed') { try { pc.close(); } catch {} } });
    setTimeout(() => { if (!linked) { log('direct link did not open (phone may use the backup route)'); try { pc.close(); } catch {} } }, 45e3);
    try { pc.setRemoteDescription(m.sdp, 'offer'); } catch (e) { log('bad offer: ' + e.message); }
  }

  function attach(pc, dc) {
    const max = Math.max(16e3, Math.min(dc.maxMessageSize?.() || 65536, 200e3)) - 1024;
    // Phones that can unpack it get big messages deflated: terminal text shrinks 3-10x,
    // which is what makes a weak signal usable.
    let zOK = false;
    const wire = (s) => {
      if (zOK && s.length > 1024) {
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
    let sess = null, attachTimer = null, size = {};
    const deviceKey = cfg.deviceId || keys.topic.slice(3, 11);
    // Sessions started on the computer (L-…), agents outside Pocket Terminal (C-…) and their
    // permission questions (Q-…) belong to the computer, so every paired phone sees them.
    const keyFor = (sid) => { const v = String(sid || 'shared').replace(/[^\w-]/g, '').slice(0, 40) || 'shared'; return /^[LQC]-/.test(v) ? `local:${v}` : `${deviceKey}:${v}`; };
    const sidOf = (key) => (key.startsWith('local:') ? key.slice(6) : key.slice(deviceKey.length + 1));
    const listAll = () => ({ t: 'sessions', list: [...core.list(deviceKey + ':'), ...core.list('local:')], current: sess ? sidOf(sess.key) : null });
    let phoneSize = null;
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
      if (viewer) { show(core.session(cfg.watchKey)); send({ t: 'hi', os: process.platform, viewer: true, canAnswer: !!cfg.canAnswer, name: cfg.name || os.hostname() }); const q = core.question(cfg.watchKey); if (q) send({ t: 'alert', kind: 'input', ...q }); return sess; }
      let key = keyFor(sid);
      if (/^local:[QC]-/.test(key) || (key.startsWith('local:') && !core.isSession(key))) key = keyFor(null); // not a terminal (any more)
      if (fresh) core.dropOthers(deviceKey + ':', key); // this phone started fresh: close its old terminals that sit idle
      const s = core.session(key);
      log(`terminal: ${s.hasShell() ? 'continuing' : 'new'} session ${key.split(':')[1].slice(0, 6)}`);
      send({ t: 'hi', os: process.platform, push: x.pushKey || null, sid: sidOf(key) });
      show(s, sz);
      if (power) send({ t: 'power', ...power.status() });
      return sess;
    };
    const onOpen = () => {
      peers.set(send, info);
      if (!viewer) power && power.setPhoneWanting(true);
      log(`${viewer ? 'viewer' : 'phone'} connected directly (${peers.size} open)`);
      attachTimer = setTimeout(() => { bind(null); if (size.cols && !viewer) sess.resize(size.cols | 0, size.rows | 0); }, 1500);
    };
    if (dc.isOpen()) onOpen(); else dc.onOpen(onOpen);

    const gets = new Map(), puts = new Map();
    const fail = (t, id, e) => send({ t, id, error: String((e && e.message) || e).replace(/^E[A-Z]+: /, '').slice(0, 200) });
    dc.onMessage((raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      info.seen = Date.now();
      if (m.t === 'ping') return send({ t: 'pong' });
      if (m.t === 'attach' && m.z === 1) zOK = true;
      if (viewer) { // watching only. A link made with "can answer" may also press Yes/No on a question, nothing else.
        if (m.t === 'attach') bind(null);
        else if (m.t === 'answer' && cfg.canAnswer) {
          const q = core.question(cfg.watchKey), c = q && choicesFor(q.text, q.menu).find((x) => x.a === m.a);
          const ok = !!c && core.answer(cfg.watchKey, c.d); send({ t: 'answered', ok }); if (ok) log(`a teammate answered "${c.a}"`);
        }
        return;
      }
      switch (m.t) {
        case 'attach': {
          const c = m.cols || size.cols, r = m.rows || size.rows;
          if (c) phoneSize = { cols: c | 0, rows: r | 0 };
          bind(m.sid, { fresh: m.fresh !== false, sz: phoneSize }); break;
        }
        case 'i': if (typeof m.d === 'string') {
          const io = bind(null), sz = io.size();
          // a session shared with the computer's own window: whoever types sets the size (and gets a clean screen)
          if (phoneSize && sz && (sz.cols !== phoneSize.cols || sz.rows !== phoneSize.rows)) show(io, phoneSize);
          io.input(m.d);
        } break;
        case 'r': phoneSize = { cols: m.cols | 0, rows: m.rows | 0 }; if (sess) sess.resize(m.cols | 0, m.rows | 0); else size = { cols: m.cols, rows: m.rows }; break; // size before attach: keep it
        case 'cmd': core.runJob(String(m.id), m.cmd, (r) => deliver(r)); break;
        case 'settings': applySettings(m.power); break;
        // --- sessions: everything this phone has running on the computer ---
        case 'sessions': send(listAll()); break;
        case 'switch': {
          const k = keyFor(m.sid);
          if (/^local:[QC]-/.test(k) || (k.startsWith('local:') && !core.isSession(k))) { send(listAll()); break; } // not a terminal
          const s = core.session(k);
          if (m.cols) phoneSize = { cols: m.cols | 0, rows: m.rows | 0 };
          show(s, m.cols ? phoneSize : null);
          send({ t: 'switched', sid: sidOf(s.key) }); break;
        }
        case 'reply': { const ok = core.reply(keyFor(m.sid), m.text); send({ t: 'answered', sid: m.sid, ok }); if (ok) log('answered a waiting terminal in words'); break; }
        case 'diff': core.diff(keyFor(m.sid), (r) => send({ t: 'diff', id: m.id, ...r })); break;
        case 'auto-get': send({ t: 'auto', ...core.getAuto() }); break;
        case 'auto-set': if (m.cfg && typeof m.cfg === 'object') send({ t: 'auto', ...core.setAuto(m.cfg) }); break;
        case 'answer': { const ok = core.answer(keyFor(m.sid), m.d); send({ t: 'answered', sid: m.sid, ok }); if (ok) log('answered a waiting terminal from the dashboard'); break; }
        case 'close-session': if (keyFor(m.sid) !== (sess && sess.key) && !/^local:Q-/.test(keyFor(m.sid))) core.close(keyFor(m.sid)); send(listAll()); break;
        // --- notifications ---
        case 'push-sub': if (x.saveSub && m.sub && webpush.allowedEndpoint(m.sub.endpoint) && m.sub.keys) { x.saveSub(m.sub); send({ t: 'push-ok', quiet: !!m.quiet }); } else fail('push-ok', null, 'That notification address is not allowed'); break;
        case 'push-off': x.removeSub && x.removeSub(m.endpoint); send({ t: 'push-ok', off: true }); break;
        case 'push-test': notify({ kind: 'test', key: sess && sess.key }, true).then((how) => send({ t: 'push-tested', how })); break;
        // --- localhost preview ---
        case 'ports': preview.listPorts().then((list) => send({ t: 'ports', id: m.id, list })).catch((e) => fail('ports', m.id, e)); break;
        case 'http': preview.proxy(m, { send, drain }).catch((e) => fail('http-h', m.id, e)); break;
        // --- files ---
        case 'ls': files.list(m.path, { hidden: !!m.hidden }).then((r) => send({ t: 'ls', id: m.id, ...r })).catch((e) => fail('ls', m.id, e)); break;
        case 'get': { const st = { cancelled: false }; gets.set(m.id, st); files.sendFile(m.id, m.path, { send, drain, cancelled: () => st.cancelled || !dc.isOpen() }).catch((e) => fail('get-h', m.id, e)).finally(() => gets.delete(m.id)); break; }
        case 'get-cancel': { const st = gets.get(m.id); if (st) st.cancelled = true; break; }
        case 'put': try { const r = files.receiver(m.dir, m.name, Number(m.size)); puts.set(m.id, r); send({ t: 'put-ok', id: m.id, path: r.path }); } catch (e) { fail('put-ok', m.id, e); } break;
        case 'put-c': { const r = puts.get(m.id); if (!r) break; try { r.write(m.d); } catch (e) { r.abort(); puts.delete(m.id); fail('put-done', m.id, e); } break; }
        case 'put-end': { const r = puts.get(m.id); if (!r) break; puts.delete(m.id); r.end().then((p) => { log('file received'); send({ t: 'put-done', id: m.id, path: p }); }).catch((e) => fail('put-done', m.id, e)); break; }
        case 'put-cancel': { const r = puts.get(m.id); if (r) { r.abort(); puts.delete(m.id); } break; }
        // --- share a live view of one session ---
        case 'share': if (x.share && sess) { const r = x.share(sess.key, Number(m.minutes) || 60, !!m.canAnswer); send({ t: 'share', ...r }); } break;
        case 'shares': send({ t: 'shares', list: x.shares ? x.shares() : [] }); break;
        case 'unshare': x.unshare && x.unshare(String(m.id)); send({ t: 'shares', list: x.shares ? x.shares() : [] }); break;
      }
    });
    dc.onClosed(() => {
      clearTimeout(attachTimer);
      for (const st of gets.values()) st.cancelled = true;
      for (const r of puts.values()) r.abort();
      peers.delete(send); sess && sess.clients.delete(client); clearTimeout(flushT);
      if (!viewer) power && power.setPhoneWanting(peers.size > 0);
      log(`${viewer ? 'viewer' : 'phone'} disconnected (${peers.size} open)`);
      try { pc.close(); } catch {}
    });
  }

  // --- "your terminal needs you": a phone notification, unless you're looking at that session ---
  const lastAlert = new Map();
  // Answer buttons on a notification. Each question gets a one-time id and its own key, sent inside
  // the encrypted notification. The phone's service worker answers by posting an encrypted note to
  // the mailbox, so it works with the app closed and the phone locked (Android).
  const asks = new Map(); // id -> { key, k, choices, exp }
  const ASK_TTL = 30 * 60e3;
  function answerButtons(ev) {
    const choices = Array.isArray(ev.choices) ? ev.choices : choicesFor(ev.text, ev.menu);
    if (!choices.length || !ev.key) return null;
    for (const [id, a] of asks) if (a.exp < Date.now() || a.key === ev.key) asks.delete(id); // one live question per terminal
    const id = crypto.randomBytes(9).toString('base64url'), k = crypto.randomBytes(32);
    asks.set(id, { key: ev.key, k, choices, exp: Date.now() + ASK_TTL });
    return { id, k: k.toString('base64url'), b: (cfg.boards || ['https://ntfy.sh'])[0], tp: keys.topic, acts: choices.map((c) => ({ action: c.a, title: c.title })) };
  }
  function onAnswer(text) {
    const [, id, blob] = text.split('.');
    const a = id && asks.get(id); if (!a || !blob) return;
    let msg; try {
      const raw = Buffer.from(blob, 'base64url'), iv = raw.subarray(0, 12), ct = raw.subarray(12, -16), tag = raw.subarray(-16);
      const d = crypto.createDecipheriv('aes-256-gcm', a.k, iv); d.setAuthTag(tag);
      msg = JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString());
    } catch { return; } // not ours, or tampered with
    asks.delete(id); // works once
    if (a.exp < Date.now() || !(Math.abs(Date.now() - Number(msg.ts)) < ASK_TTL)) return log('ignored an expired answer from a notification');
    const c = a.choices.find((x) => x.a === msg.a); if (!c) return;
    log(core.answer(a.key, c.d) ? `answered "${c.a}" from a notification` : 'answer from a notification came after the question was gone: ignored');
  }
  async function notify(ev, force = false) {
    if (viewer || ev.kind === 'auto' || ev.kind === 'gone') return 'none'; // auto-approved: shown in the app, no buzz
    // Watching = showing that terminal AND heard from in the last 12 s (a closed app's link can linger ~30 s).
    const watching = [...peers.values()].some((p) => p.key === ev.key && Date.now() - p.seen < 12e3);
    if (watching && !force) return 'none';
    if (!force && Date.now() - (lastAlert.get(ev.key + ev.kind) || 0) < 20e3) return 'none';
    lastAlert.set(ev.key + ev.kind, Date.now());
    const prog = ev.program ? ev.program[0].toUpperCase() + ev.program.slice(1) : 'Your terminal';
    const sid = ev.key ? ev.key.split(':').slice(1).join(':') : '';
    const where = ev.cwd ? ` · ${ev.cwd}` : '';
    const msg = ev.kind === 'input' && ev.ask ? { title: `${prog} asks for permission`, body: (ev.text || 'It is waiting for your answer.') + where }
      : ev.kind === 'input' ? { title: `${prog} needs you`, body: ev.text || 'It is waiting for your answer.' }
      : ev.kind === 'done' ? { title: `${prog} finished`, body: `after ${ev.seconds >= 120 ? Math.round(ev.seconds / 60) + ' min' : ev.seconds + ' s'}${ev.changes && ev.changes.files ? ` · ${ev.changes.files} file${ev.changes.files === 1 ? '' : 's'} changed (+${ev.changes.add} −${ev.changes.del})` : ''}. Tap to see the result.` }
      : ev.kind === 'quiet' ? { title: 'Your terminal went quiet', body: ev.text || 'It may be done, or waiting for you.' }
      : ev.kind === 'ready' ? { title: `${cfg.name || os.hostname()} is awake ✓`, body: 'Ready when you are. Tap to connect (it stays awake for 3 minutes).' }
      : { title: 'Notifications work ✅', body: `${cfg.name || os.hostname()} can reach this phone.` };
    const subs = x.subs ? x.subs() : [];
    const ans = ev.kind === 'input' && subs.length ? answerButtons(ev) : null;
    let how = 'none';
    for (const sub of subs) {
      const r = await webpush.send(x.pushKeys, sub, { ...msg, sid: sid || null, kind: ev.kind, tag: ev.kind === 'ready' ? 'pt-ready' : `pt-${sid}`, ...(ans ? { ans } : {}) }, { topic: ev.kind === 'ready' ? 'ptready' : `pt${sid}` });
      if (r === 'gone') x.removeSub(sub.endpoint); if (r === 'ok') how = 'push';
    }
    if (how === 'none' && cfg.notify !== false) { // no phone notifications set up: the ntfy app, without any details
      await board.publish(ev.kind === 'input' ? 'Your terminal needs you 👋' : ev.kind === 'test' ? 'Notifications work ✅' : ev.kind === 'ready' ? 'Your computer is awake ✓ Open Pocket Terminal to connect.' : 'A program finished ✅', keys.notifyTopic, { Title: 'Pocket Terminal' }).then(() => { how = 'ntfy'; }).catch(() => {});
    }
    if (how !== 'none') log(`notified the phone (${ev.kind}, ${how})`);
    return how;
  }

  // --- results: over the direct link if open, otherwise as an encrypted note ---
  async function deliver(r) {
    if (peers.size) { for (const s of peers.keys()) s({ t: 'result', ...r }); return; }
    let out = r.out;
    for (;;) { // shrink the output until the note fits on the board
      const sealed = seal(keys, { id: msgId(), ts: Date.now(), from: 'mac', type: 'result', cid: r.id, code: r.code, out });
      if (sealed.length <= MAX_NOTE || out.length < 50) { await board.publish(sealed).catch((e) => log('result post failed: ' + e.message)); break; }
      out = '…(start cut)…\n' + out.slice(Math.floor(out.length * 0.4));
    }
    if (cfg.notify !== false) {
      board.publish(r.code === 0 ? 'Command finished ✅' : `Command failed ❌ (exit ${r.code})`, keys.notifyTopic, { Title: 'Pocket Terminal' }).catch(() => {});
    }
  }

  function applySettings(p) {
    if (!power || !p || typeof p !== 'object') return;
    const allowed = ['enabled', 'awakeOnCharger', 'batteryMode', 'checkInMinutes', 'smartCheckIn', 'idleMinutes', 'minBattery', 'stopAlarmsBelow'];
    const next = {}; for (const k of allowed) if (k in p) next[k] = p[k];
    if ('checkInMinutes' in next) next.checkInMinutes = Math.min(120, Math.max(1, Number(next.checkInMinutes) || 5));
    if ('minBattery' in next) next.minBattery = Math.min(90, Math.max(5, Number(next.minBattery) || 20));
    if ('batteryMode' in next && !['saver', 'instant'].includes(next.batteryMode)) delete next.batteryMode;
    power.update(next);
    try { fs.writeFileSync(path.join(dir, 'power.json'), JSON.stringify(power.s, null, 2), { mode: 0o600 }); } catch {}
    log('power settings updated ' + JSON.stringify(next));
    for (const s of peers.keys()) s({ t: 'power', ...power.status() });
  }

  // The phone opened the app while this computer slept, and has moved on since (nothing connected
  // a little after it woke): tell it the computer is up now, so one tap connects. Once per 5 min.
  function readySoon() {
    if (viewer) return;
    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      if (peers.size || Date.now() - lastReady < 5 * 60e3) return;
      lastReady = Date.now();
      power && power.setPhoneWanting(true);
      clearTimeout(phoneWaitingTimer); // give the tap time to arrive
      phoneWaitingTimer = setTimeout(() => power && power.setPhoneWanting(peers.size > 0), 3 * 60e3);
      notify({ kind: 'ready' }).catch(() => {});
    }, READY_AFTER);
  }

  // --- reading the mailbox ---
  function onNote(text) {
    if (typeof text === 'string' && text.startsWith('pta1.')) { if (!viewer) onAnswer(text); return; }
    const m = open(keys, text);
    if (!m || m.from !== 'phone' || typeof m.id !== 'string' || seen.has(m.id)) return;
    seen.add(m.id); saveState();
    const age = Date.now() - Number(m.ts);
    if (!(age > -2 * 60e3)) return; // clocks wildly off: ignore
    if (viewer && m.type !== 'hello' && m.type !== 'offer') return; // a viewer can only connect and watch
    if (m.type === 'hello' && age < FRESH.hello) {
      if (viewer) { postStatus('online', { force: true }); return; }
      // Phone opened the app: stay awake ~2 min so it can connect.
      power && power.setPhoneWanting(true);
      clearTimeout(phoneWaitingTimer);
      phoneWaitingTimer = setTimeout(() => power && power.setPhoneWanting(peers.size > 0), 2 * 60e3);
      log('phone said hello: staying awake for it');
      postStatus('online', { force: true });
      if (age > 5e3) readySoon();
    } else if (m.type === 'offer' && age < FRESH.offer && typeof m.sdp === 'string') {
      if (process.env.POCKET_NO_DIRECT) return log('ignoring offer (POCKET_NO_DIRECT test switch)');
      answerOffer(m);
      if (age > 5e3) readySoon(); // it was posted while this computer slept
    } else if (m.type === 'cmd' && age < maxCmdAge) {
      core.runJob(String(m.cid), m.cmd, (r) => deliver(r));
    } else if (m.type === 'settings' && age < FRESH.settings) {
      applySettings(m.power);
    }
  }

  const onOpenStream = () => { power && power.setConnected(true); };
  board.stream(onNote, onOpenStream);
  postStatus('online', { force: true });
  log(`direct mode: mailbox ready on ${board.urls.join(', ')}`);

  return {
    onWake: () => {
      board.restart(onNote, onOpenStream); // pick up notes that arrived while asleep
      // Tell the phone at once that it's up (it may be showing "asleep"). Wi-Fi can take a few
      // seconds to come back after a wake, so try again shortly.
      if (!viewer) for (const ms of [500, 4000, 12000]) setTimeout(() => postStatus('online', { force: true }).catch?.(() => {}), ms);
    },
    onSleep: async () => {
      await postStatus('sleeping');
      board.stop(); power && power.setConnected(false); saveState();
    },
    onPower: (s) => { if (!viewer) for (const p of peers.keys()) p({ t: 'power', ...s }); },
    alert: (ev) => {
      if (!viewer && /^local:[QC]-/.test(String(ev.key))) for (const p of peers.keys()) p({ t: 'alert', ...ev, key: undefined, sid: ev.key.slice(6) });
      return notify(ev);
    },
    closeAll: () => { for (const p of peers.keys()) p({ t: 'share-ended' }); },
    stop: () => { board.stop(); saveState(); },
    revoke: async () => { for (const p of peers.keys()) p({ t: 'revoked' }); await post('revoked'); },
  };
}

module.exports = { startDirect, DEFAULT_ICE };
