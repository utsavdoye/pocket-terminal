// The live terminal through our own message board, for networks that block a direct link
// (mobile data in India, many office and college Wi-Fi networks). Free: it runs on the board.
//
// The phone asks with a sealed "pipe" note (only a paired phone can make one). The computer opens
// its side of the pipe, a WebSocket to the board; the board passes every message between the two.
// Each message is sealed with the pairing key (the board sees only scrambled text) and numbered,
// so a message can't be replayed, reordered or bounced back by anyone in the middle.
//
// To the rest of the agent it looks just like the direct link (channel.js attach()), so terminals,
// files, local websites and everything else work the same way, a little slower.

const zlib = require('zlib');
const { seal, open } = require('../lib/crypto');
const { openSocket, boardsFor } = require('../lib/board');

const PIPE_ID = /^[-_A-Za-z0-9]{12,40}$/;
const MAX_MESSAGE = 48000;

// Sets ctx.joinPipe. Needs ctx.attachLink (channel.js).
function startPipe(ctx) {
  const { cfg, keys, log } = ctx;
  const live = new Map(); // pipe id -> end(); a repeated note doesn't open it twice

  function joinPipe(id) {
    const own = boardsFor(cfg.boards).find((b) => b !== 'https://ntfy.sh');
    if (!own || !PIPE_ID.test(String(id)) || live.has(id)) return;
    const t0 = Date.now();
    let isOpen = false, closed = false, nOut = 0, nIn = 0, lowAt = 0, lowTimer = null;
    const h = { open: [], msg: [], closed: [], low: [] };
    const end = () => {
      if (closed) return; closed = true; live.delete(id); clearInterval(lowTimer);
      const was = isOpen; isOpen = false;
      try { sock.close(); } catch {}
      if (was) h.closed.forEach((f) => f());
    };
    live.set(id, end);
    const sock = openSocket(`${own.replace(/^http/, 'ws')}/${keys.topic}/pipe?id=${id}&side=mac`, {
      open: () => {},
      message: (t) => {
        if (t === 'pong') return;
        if (t[0] === '{') { // from the board itself
          let c; try { c = JSON.parse(t); } catch { return; }
          if (c.pipe === 'ready' && !isOpen && !closed) {
            isOpen = true; log(`phone connected through the board (${Date.now() - t0} ms)`);
            lowTimer = setInterval(() => { if (h.low.length && sock.buffered() <= lowAt) h.low.forEach((f) => f()); }, 200);
            h.open.forEach((f) => f());
          }
          if (c.pipe === 'closed') end();
          return;
        }
        const m = open(keys, t);
        if (!m || m.p !== id || m.s !== 'phone' || m.n !== nIn) return; // not ours, replayed or out of order
        nIn++; h.msg.forEach((f) => f(m.d));
      },
      close: end,
    });
    setTimeout(() => { if (!isOpen) end(); }, 20e3); // the phone never came

    // What channel.js expects from a direct link's data channel.
    const dc = {
      isOpen: () => isOpen,
      maxMessageSize: () => MAX_MESSAGE,
      sendMessage: (s) => { if (isOpen) sock.send(seal(keys, { p: id, s: 'mac', n: nOut++, d: String(s) })); return true; },
      sendMessageBinary: (b) => dc.sendMessage(zlib.inflateRawSync(b).toString()), // the phone asks for plain text on a pipe; just in case
      bufferedAmount: () => sock.buffered(),
      setBufferedAmountLowThreshold: (n) => { lowAt = n; },
      onBufferedAmountLow: (f) => h.low.push(f),
      onOpen: (f) => h.open.push(f),
      onMessage: (f) => h.msg.push(f),
      onClosed: (f) => h.closed.push(f),
    };
    ctx.attachLink({ close: end }, dc, 'through the board');
  }

  ctx.joinPipe = joinPipe;
}

module.exports = { startPipe };
