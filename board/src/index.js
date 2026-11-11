// Pocket Terminal's own message board, on Cloudflare Workers (free plan).
//
// It does the same job as ntfy.sh: a mailbox for encrypted notes, so a phone and a computer
// can find each other. It never sees anything readable: only a random mailbox name and
// encrypted text. Unlike the free ntfy.sh it has no daily limit per internet connection, so
// people on shared Wi-Fi (a college, an office, a mobile network) don't use up each other's
// messages. The limit here is per mailbox.
//
//   POST /{topic}                      leave a note (kept 12 hours)
//   GET  /{topic}/ws?since=ID|10m      live notes over a WebSocket: {"event":"open"}, then one
//                                      JSON per note. Send "ping", get "pong".
//   GET  /{topic}/json?poll=1&since=…  the notes so far, one JSON per line, and done
//   GET  /v1/health                    {"healthy":true}
//
// One Durable Object per mailbox holds its notes. WebSockets hibernate, so a phone or computer
// that just listens costs nothing while it waits.

import { DurableObject } from 'cloudflare:workers';

const TOPIC = /^pt-[-_A-Za-z0-9]{16,48}$/;
const KEEP_MS = 12 * 3600e3; // how long a note is kept
const MAX_NOTES = 200; // per mailbox
const MAX_BODY = 4096; // bytes
const MAX_SOCKETS = 12; // per mailbox
const RATE = { n: 300, ms: 10 * 60e3 }; // posts per mailbox per 10 minutes
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/v1/health') return json({ healthy: true });
    if (url.pathname === '/') return new Response('Pocket Terminal message board. It only carries encrypted notes. https://github.com/utsavdoye/pocket-terminal\n', { headers: CORS });
    const [topic, what, extra] = url.pathname.split('/').filter(Boolean);
    // "ptn-…" is for the ntfy phone app, which only reads ntfy.sh: nothing to keep here.
    if (req.method === 'POST' && /^ptn-[-_A-Za-z0-9]{16,48}$/.test(topic || '') && !what) return json({ event: 'message', topic });
    if (!topic || !TOPIC.test(topic) || extra) return json({ error: 'not found' }, 404);
    const ok = (req.method === 'POST' && !what) || (req.method === 'GET' && (what === 'ws' || what === 'json'));
    if (!ok) return json({ error: 'not found' }, 404);
    return env.BOARD.get(env.BOARD.idFromName(topic)).fetch(req);
  },
};

// Notes after "since": an id (everything after that note), a duration ("10m", "12h"), or a time in seconds.
function after(list, since) {
  if (!since || since === 'all') return list;
  const dur = /^(\d+)([smh])$/.exec(since);
  if (dur) { const ms = dur[1] * { s: 1e3, m: 60e3, h: 3600e3 }[dur[2]]; return list.filter((m) => m.ms >= Date.now() - ms); }
  if (/^\d{9,}$/.test(since)) return list.filter((m) => m.ms >= Number(since) * 1000);
  const i = list.findIndex((m) => m.id === since);
  return i >= 0 ? list.slice(i + 1) : list;
}

export class Mailbox extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.notes = null; // loaded when first needed
    this.posts = []; // times of recent posts, for the rate limit
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); // answered without waking this object
  }

  async load() {
    if (!this.notes) this.notes = (await this.ctx.storage.get('notes')) || [];
    const cut = Date.now() - KEEP_MS;
    if (this.notes.length && this.notes[0].ms < cut) this.notes = this.notes.filter((m) => m.ms >= cut);
    return this.notes;
  }
  wire(topic, m) { return JSON.stringify({ id: m.id, time: Math.floor(m.ms / 1000), event: 'message', topic, message: m.message }); }

  async fetch(req) {
    const url = new URL(req.url);
    const [topic, what] = url.pathname.split('/').filter(Boolean);

    if (req.method === 'POST') {
      const body = await req.text();
      if (!body || new TextEncoder().encode(body).length > MAX_BODY) return json({ error: 'note too big' }, 413);
      const now = Date.now();
      this.posts = this.posts.filter((t) => now - t < RATE.ms);
      if (this.posts.length >= RATE.n) return json({ error: 'too many notes for this mailbox, slow down' }, 429);
      this.posts.push(now);
      const notes = await this.load();
      const m = { id: [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join(''), ms: now, message: body };
      notes.push(m); if (notes.length > MAX_NOTES) notes.splice(0, notes.length - MAX_NOTES);
      await this.ctx.storage.put('notes', notes); // one write per note; old notes drop out in the same write
      await this.ctx.storage.setAlarm(now + KEEP_MS + 60e3); // empty the mailbox once it has gone quiet
      const line = this.wire(topic, m);
      for (const ws of this.ctx.getWebSockets()) { try { ws.send(line); } catch {} }
      return new Response(line, { headers: { 'Content-Type': 'application/json', ...CORS } });
    }

    const list = after(await this.load(), url.searchParams.get('since')).map((m) => this.wire(topic, m));
    if (what === 'json') {
      // Only "the notes so far". A stream that stays open would keep this object awake (and billed);
      // live notes come over /ws instead.
      if (!url.searchParams.get('poll')) return json({ error: 'use /ws for live notes, or ?poll=1' }, 426);
      return new Response(list.map((l) => l + '\n').join(''), { headers: { 'Content-Type': 'application/x-ndjson', ...CORS } });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected a WebSocket' }, 426);
    const open = this.ctx.getWebSockets();
    for (const old of open.slice(0, Math.max(0, open.length - MAX_SOCKETS + 1))) { try { old.close(1008, 'too many listeners'); } catch {} }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]); // hibernates: no cost while it only waits
    pair[1].send(JSON.stringify({ id: 'open', time: Math.floor(Date.now() / 1000), event: 'open', topic }));
    for (const l of list) pair[1].send(l);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage() {} // listeners only listen ("ping" is answered automatically)
  webSocketClose(ws, code) { try { ws.close(code === 1005 || code === 1006 ? 1000 : code); } catch {} }
  webSocketError(ws) { try { ws.close(1011); } catch {} }

  async alarm() {
    this.notes = null;
    const notes = await this.load();
    if (notes.length) { await this.ctx.storage.put('notes', notes); await this.ctx.storage.setAlarm(notes[0].ms + KEEP_MS + 60e3); }
    else await this.ctx.storage.deleteAll();
  }
}
