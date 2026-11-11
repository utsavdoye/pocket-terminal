// Message-board client (ntfy protocol). The board is only a mailbox for encrypted
// notes: the "hello" that sets up the direct link, and the backup route for commands.
// You can list several boards; we post to all and read from all (no single point of failure).
//
// ntfy API used:
//   POST {board}/{topic}                       post a note (kept 12 h on ntfy.sh)
//   GET  {board}/{topic}/json?since=ID|10m     stream of notes, one JSON per line
//   GET  {board}/{topic}/json?poll=1&since=…   same, but returns right away
//   GET  {board}/{topic}/ws?since=…            the same notes over a WebSocket
//
// Pocket Terminal's own board (board/ in this repo) speaks the same language, but live notes
// come only over the WebSocket there. So: ntfy.sh is read as a stream (as always); any other
// board is tried over a WebSocket first, and read as a stream if it has none.

const MAX_NOTE = 3800; // ntfy turns bigger notes into attachments; stay under 4096

// The boards to use. Ours first (no daily limit per internet connection), the free ntfy.sh as
// the backup. A pairing made before we had our own board lists only ntfy.sh: it gets ours too.
// OWN_BOARD is '' until the board is deployed (scripts/set-board.js writes it here and in the app).
const OWN_BOARD = 'https://pocket-terminal-board.utsavdoye.workers.dev';
const NTFY = 'https://ntfy.sh';
const DEFAULT_BOARDS = OWN_BOARD ? [OWN_BOARD, NTFY] : [NTFY];
const boardsFor = (list) => (!Array.isArray(list) || !list.length || (list.length === 1 && list[0] === NTFY) ? DEFAULT_BOARDS : list);
const sameAsDefault = (list) => boardsFor(list).join(',') === DEFAULT_BOARDS.join(',');

// A WebSocket that works on every Node we support: the built-in one (Node 22+), else our own
// small client (ws-client.js), which uses Node's https and so checks certificates as usual.
function openSocket(url, on) {
  if (typeof WebSocket === 'function' && process.env.POCKET_WS !== 'mini') {
    const ws = new WebSocket(url);
    let ended = false; const close = () => { if (!ended) { ended = true; on.close(); } };
    ws.onopen = () => on.open(); ws.onmessage = (e) => on.message(String(e.data)); ws.onclose = close;
    ws.onerror = () => { close(); try { ws.close(); } catch {} }; // a refused connection reports an error and may never report "closed"
    return { send: (t) => { try { ws.readyState === 1 && ws.send(t); } catch {} }, close: () => { try { ws.close(); } catch {} }, buffered: () => ws.bufferedAmount || 0 };
  }
  return require('./ws-client').connect(url, on);
}

class Board {
  constructor(urls, topic, { log = () => {}, since = {} } = {}) {
    this.urls = urls.map((u) => u.replace(/\/+$/, ''));
    this.topic = topic;
    this.log = log;
    this.since = { ...since };   // last note id seen, per board
    this.streams = new Map();
    this.stopped = false;
    this.noWs = new Set(urls.filter((u) => u.replace(/\/+$/, '') === NTFY).map((u) => u.replace(/\/+$/, ''))); // boards read as a stream
    this.fails = new Map(); // board -> failed tries in a row (the wait before the next try grows)
  }

  async publish(text, topic = this.topic, headers = {}) {
    if (text.length > MAX_NOTE && topic === this.topic) throw new Error('note too big');
    const results = await Promise.allSettled(this.urls.map((u) =>
      fetch(`${u}/${topic}`, { method: 'POST', body: text, headers, signal: AbortSignal.timeout(15e3) })
        .then((r) => { if (!r.ok) throw new Error(`${u} answered ${r.status}`); return r; })));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    for (const r of results) if (r.status === 'rejected') this.log('board post failed: ' + r.reason.message);
    if (!ok) throw new Error('no board accepted the note');
    return ok;
  }

  // Read everything new on every board once, then return.
  async poll(onNote) {
    await Promise.allSettled(this.urls.map(async (u) => {
      const since = this.since[u] || '10m';
      const r = await fetch(`${u}/${this.topic}/json?poll=1&since=${encodeURIComponent(since)}`, { signal: AbortSignal.timeout(15e3) });
      for (const line of (await r.text()).split('\n')) this._line(u, line, onNote);
    }));
  }

  // Keep a live stream open to every board. Reconnects by itself.
  stream(onNote, onOpen = () => {}) {
    this.stopped = false;
    for (const u of this.urls) this._streamOne(u, onNote, onOpen);
  }

  // Try again after a failure: 3 s, then 6, 12… up to a minute, so a board that is down (or out
  // of its daily allowance) isn't hammered.
  _again(u, ctl, onNote, onOpen) {
    if (this.stopped || this.streams.get(u) !== ctl) return;
    const n = (this.fails.get(u) || 0) + 1; this.fails.set(u, n);
    setTimeout(() => { if (!this.stopped && this.streams.get(u) === ctl) this._streamOne(u, onNote, onOpen); }, Math.min(60e3, 3000 * 2 ** (n - 1)));
  }

  async _streamOne(u, onNote, onOpen) {
    const old = this.streams.get(u); if (old) old.abort();
    if (!this.noWs.has(u)) return this._socket(u, onNote, onOpen);
    const ctl = new AbortController(); this.streams.set(u, ctl);
    let live = false;
    try {
      const since = this.since[u] || '10m';
      const r = await fetch(`${u}/${this.topic}/json?since=${encodeURIComponent(since)}`, { signal: ctl.signal });
      if (!r.ok) throw new Error(`answered ${r.status}`);
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
      // ntfy sends a keepalive at least every ~45 s. Silence for 75 s: the connection died
      // quietly (weak Wi-Fi). Drop it and open a new one.
      let quiet = setTimeout(() => ctl.abort('stalled'), 75e3);
      for (;;) {
        const { value, done } = await reader.read();
        clearTimeout(quiet); quiet = setTimeout(() => ctl.abort('stalled'), 75e3);
        if (done) { clearTimeout(quiet); break; }
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          const ev = this._line(u, line, onNote);
          if (ev && ev.event === 'open') { live = true; this.fails.set(u, 0); onOpen(u); }
        }
      }
    } catch (e) {
      if (ctl.signal.aborted && ctl.signal.reason !== 'stalled') return;
      this.log(`board stream ${u}: ${ctl.signal.reason === 'stalled' ? 'went quiet, reconnecting' : e.message}`);
    }
    if (!live && u !== NTFY) this.noWs.delete(u); // no stream here either: the next try is the WebSocket again
    this._again(u, ctl, onNote, onOpen);
  }

  // The same, over a WebSocket. We send "ping" every 30 s and expect "pong": 75 s of silence
  // means the connection died quietly. A board that never opens one is read as a stream instead.
  _socket(u, onNote, onOpen) {
    let opened = false, closed = false, quiet = null, ping = null, sock = null;
    const ctl = { abort: () => { closed = true; clearTimeout(quiet); clearInterval(ping); sock && sock.close(); } };
    this.streams.set(u, ctl);
    const arm = () => { clearTimeout(quiet); quiet = setTimeout(() => sock && sock.close(), 75e3); };
    const since = this.since[u] || '10m';
    try {
      sock = openSocket(`${u.replace(/^http/, 'ws')}/${this.topic}/ws?since=${encodeURIComponent(since)}`, {
        open: () => { opened = true; arm(); ping = setInterval(() => sock.send('ping'), 30e3); },
        message: (t) => { arm(); if (t === 'pong') return; const ev = this._line(u, t, onNote); if (ev && ev.event === 'open') { this.fails.set(u, 0); onOpen(u); } },
        close: () => {
          clearTimeout(quiet); clearInterval(ping);
          if (closed) return; closed = true;
          if (!opened) this.noWs.add(u); // no WebSocket here (or the board is down): the next try reads it as a stream
          if (!opened && !(this.fails.get(u) > 0)) { if (!this.stopped && this.streams.get(u) === ctl) this._streamOne(u, onNote, onOpen); return; }
          this._again(u, ctl, onNote, onOpen);
        },
      });
      setTimeout(() => { if (!opened && !closed) sock.close(); }, 8e3);
    } catch (e) { this.log(`board ${u}: ${e.message}`); this.noWs.add(u); this._again(u, ctl, onNote, onOpen); }
  }

  _line(u, line, onNote) {
    if (!line.trim()) return null;
    let ev; try { ev = JSON.parse(line); } catch { return null; }
    if (ev.event === 'message') { this.since[u] = ev.id; onNote(ev.message, u, ev); }
    return ev;
  }

  // After the Mac wakes, old streams are dead. Start fresh from where we left off.
  restart(onNote, onOpen) { this.stop(); this.stream(onNote, onOpen); }
  stop() { this.stopped = true; for (const c of this.streams.values()) c.abort(); this.streams.clear(); }
}

module.exports = { Board, MAX_NOTE, OWN_BOARD, DEFAULT_BOARDS, boardsFor, sameAsDefault, openSocket };
