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
//
// This file wires the parts together. The parts live in link/:
//   mailbox.js   the encrypted mailbox on the board: state, posting, reading notes
//   results.js   status, command results and power settings
//   notify.js    phone notifications and their answer buttons
//   channel.js   the direct link to one phone (sending, output, which session it shows)
//   messages.js  what a phone can ask for over that link

const { derive } = require('./lib/crypto');
const { startMailbox } = require('./link/mailbox');
const { startResults } = require('./link/results');
const { startNotify } = require('./link/notify');
const { startChannel, DEFAULT_ICE } = require('./link/channel');

// cfg.role: 'owner' (a paired phone: full access) or 'viewer' (a share link: watch one session, nothing else).
// x: shared helpers from devices.js (push keys and subscriptions, share links).
function startDirect({ cfg, core, power, log, dir, x = {} }) {
  // ctx: what every part shares. Each start…() below adds its own functions to it.
  const ctx = {
    cfg, core, power, log, dir, x,
    viewer: cfg.role === 'viewer',
    keys: derive(cfg.secret),
    peers: new Map(), // send -> { key: the session it shows }
  };
  startMailbox(ctx); // board, post, saveState, readySoon, onNote
  startResults(ctx); // postStatus, deliver, applySettings
  startNotify(ctx); // notify, onAnswer
  startChannel(ctx); // answerOffer
  const { viewer, peers, board, onNote, post, postStatus, saveState, notify } = ctx;

  // How long each step takes after a wake-up (to keep "wakes in 20 s" honest): logged, nothing private.
  const since = () => ctx.wokeAt && Date.now() - ctx.wokeAt < 120e3 ? ` ${((Date.now() - ctx.wokeAt) / 1000).toFixed(1)} s after waking` : '';
  ctx.since = since;
  const onOpenStream = () => { power && power.setConnected(true); const s = since(); if (s) log('mailbox reachable' + s); };
  board.stream(onNote, onOpenStream);
  postStatus('online', { force: true });
  log(`direct mode: mailbox ready on ${board.urls.join(', ')}`);

  return {
    onWake: (kind) => {
      ctx.wokeAt = Date.now();
      board.restart(onNote, onOpenStream); // pick up notes that arrived while asleep (a phone's knock)
      // A quiet check-in with the lid closed: say nothing; if the phone knocked, its hello wakes the
      // link up. Otherwise (lid opened): tell the phone at once that it's up (it may be showing
      // "asleep"). Wi-Fi can take a few seconds to come back after a wake, so try again shortly.
      // One note, tried again only if Wi-Fi wasn't back yet (the free board has a daily limit).
      if (!viewer && kind !== 'checkin') {
        const tries = [1500, 5000, 12000];
        const go = () => { const ms = tries.shift(); if (ms !== undefined) setTimeout(async () => { if (!(await postStatus('online', { force: true }))) go(); }, ms); };
        go();
      }
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
