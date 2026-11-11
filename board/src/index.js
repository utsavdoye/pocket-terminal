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
//   GET  /{topic}/ice                  a login for a relay (TURN), for networks that block a direct
//                                      link (mobile data, strict Wi-Fi). From one of:
//                                        Metered Open Relay (free, no card): secret METERED_URL
//                                        Cloudflare Realtime TURN (needs a card): TURN_KEY_ID + TURN_KEY_TOKEN
//                                      With neither: {"iceServers":[]} and everything works without a relay.
//   GET  /{topic}/pipe?id=…&side=phone|mac
//                                      the live terminal through the board, for networks that block a
//                                      direct link (mobile data, strict Wi-Fi). Phone and computer each
//                                      open one WebSocket; the board passes each message to the other
//                                      side. Everything in it is encrypted with their pairing key.
//                                      The board says {"pipe":"ready"} when both are there, and
//                                      {"pipe":"closed"} (then closes) when one leaves.
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
const PIPE_ID = /^[-_A-Za-z0-9]{12,40}$/;
const MAX_PIPES = 4; // per mailbox (a phone or two, a shared live view)
const PIPE_RATE = { n: 6000, ms: 60e3 }; // messages per side per minute; far above any real terminal
const ICE_TTL = 12 * 3600; // seconds a relay login stays good
const ICE_PER_MAILBOX = { n: 30, ms: 10 * 60e3 }; // relay logins per mailbox per 10 minutes
const ICE_PER_HOUR = 3000; // for the whole board: a cap so the free relay allowance can't be drained
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
    const ok = (req.method === 'POST' && !what) || (req.method === 'GET' && (what === 'ws' || what === 'json' || what === 'ice' || what === 'pipe'));
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
    if (url.pathname === '/budget') { // the board-wide relay budget (only reachable from inside the board)
      const hour = Math.floor(Date.now() / 3600e3);
      if (this.hour !== hour) { this.hour = hour; this.used = 0; }
      return new Response(null, { status: ++this.used > ICE_PER_HOUR ? 429 : 204 });
    }
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
      for (const ws of this.ctx.getWebSockets('notes')) { try { ws.send(line); } catch {} }
      return new Response(line, { headers: { 'Content-Type': 'application/json', ...CORS } });
    }

    if (what === 'ice') return this.ice();
    if (what === 'pipe') return req.headers.get('Upgrade') === 'websocket' ? this.pipe(url) : json({ error: 'expected a WebSocket' }, 426);

    const list = after(await this.load(), url.searchParams.get('since')).map((m) => this.wire(topic, m));
    if (what === 'json') {
      // Only "the notes so far". A stream that stays open would keep this object awake (and billed);
      // live notes come over /ws instead.
      if (!url.searchParams.get('poll')) return json({ error: 'use /ws for live notes, or ?poll=1' }, 426);
      return new Response(list.map((l) => l + '\n').join(''), { headers: { 'Content-Type': 'application/x-ndjson', ...CORS } });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected a WebSocket' }, 426);
    const open = this.ctx.getWebSockets('notes');
    for (const old of open.slice(0, Math.max(0, open.length - MAX_SOCKETS + 1))) { try { old.close(1008, 'too many listeners'); } catch {} }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ['notes']); // hibernates: no cost while it only waits
    pair[1].send(JSON.stringify({ id: 'open', time: Math.floor(Date.now() / 1000), event: 'open', topic }));
    for (const l of list) pair[1].send(l);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // A relay login for this mailbox (the phone and the computer share it), fetched from Cloudflare
  // and kept until it has less than 6 hours left. Port 53 addresses are dropped: browsers block
  // that port and would wait for it to time out.
  async ice() {
    const env = this.env;
    const cf = env.TURN_KEY_ID && env.TURN_KEY_TOKEN, metered = /^https:\/\/[\w-]+\.metered\.live\/api\/v1\/turn\/credentials\?apiKey=/.test(env.METERED_URL || '') || (env.TURN_API && env.METERED_URL);
    if (!cf && !metered) return json({ iceServers: [], ttl: 6 * 3600 }); // no relay here: callers can stop asking for a while
    const now = Date.now();
    if (this.iceCache && this.iceCache.until - now > 6 * 3600e3) return json({ iceServers: this.iceCache.servers, ttl: Math.round((this.iceCache.until - now) / 1000) });
    this.iceAsks = (this.iceAsks || []).filter((t) => now - t < ICE_PER_MAILBOX.ms);
    if (this.iceAsks.length >= ICE_PER_MAILBOX.n) return json({ error: 'too many relay requests for this mailbox' }, 429);
    this.iceAsks.push(now);
    const gate = env.BOARD.get(env.BOARD.idFromName('relay-budget')); // one counter for the whole board
    const g = await gate.fetch('https://board/budget', { method: 'POST' });
    if (!g.ok) return json({ iceServers: [], note: 'relay busy' });
    try {
      let r;
      if (cf) {
        const api = (env.TURN_API || 'https://rtc.live.cloudflare.com') + `/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`;
        r = await fetch(api, { method: 'POST', headers: { Authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: ICE_TTL }) });
      } else r = await fetch(env.METERED_URL); // Metered answers with a plain list
      if (!r.ok) return json({ iceServers: [], note: 'relay unavailable' });
      const d = await r.json();
      const servers = (Array.isArray(d) ? d : d.iceServers || []).filter((x) => x && x.username && x.credential)
        .map((x) => ({ urls: [].concat(x.urls || []).filter((u) => !/:53(\?|$)/.test(u)), username: x.username, credential: x.credential }))
        .filter((x) => x.urls.length);
      this.iceCache = { servers, until: now + ICE_TTL * 1000 };
      return json({ iceServers: servers, ttl: ICE_TTL });
    } catch { return json({ iceServers: [], note: 'relay unavailable' }); }
  }

  // One side of a pipe joins. A side that joins again (it reconnected) replaces its old socket.
  pipe(url) {
    const id = url.searchParams.get('id') || '', side = url.searchParams.get('side');
    if (!PIPE_ID.test(id) || (side !== 'phone' && side !== 'mac')) return json({ error: 'bad pipe' }, 400);
    const tag = 'pipe:' + id;
    for (const ws of this.ctx.getWebSockets(tag)) if (this.ctx.getTags(ws).includes('side:' + side)) { try { ws.close(1000, 'replaced'); } catch {} }
    const ids = [...new Set(this.ctx.getWebSockets('pipe').flatMap((w) => this.ctx.getTags(w).filter((t) => t.startsWith('pipe:'))))].filter((t) => t !== tag);
    for (const old of ids.slice(0, Math.max(0, ids.length - MAX_PIPES + 1))) for (const w of this.ctx.getWebSockets(old)) { try { w.close(1008, 'too many pipes'); } catch {} }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ['pipe', tag, 'side:' + side]);
    const both = this.ctx.getWebSockets(tag).filter((w) => w.readyState === 1 || w === pair[1]);
    if (both.length >= 2 && new Set(both.map((w) => this.ctx.getTags(w).find((t) => t.startsWith('side:')))).size === 2) {
      for (const w of both) { try { w.send('{"pipe":"ready"}'); } catch {} }
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  other(ws) {
    const tags = this.ctx.getTags(ws), tag = tags.find((t) => t.startsWith('pipe:')), side = tags.find((t) => t.startsWith('side:'));
    return tag ? this.ctx.getWebSockets(tag).filter((w) => w !== ws && !this.ctx.getTags(w).includes(side)) : [];
  }

  webSocketMessage(ws, msg) {
    if (!this.ctx.getTags(ws).includes('pipe')) return; // note listeners only listen ("ping" is answered automatically)
    const now = Date.now(); this.rates = this.rates || new Map();
    const r = this.rates.get(ws) || { t: now, n: 0 };
    if (now - r.t > PIPE_RATE.ms) { r.t = now; r.n = 0; }
    if (++r.n > PIPE_RATE.n) { try { ws.close(1008, 'too fast'); } catch {} return; }
    this.rates.set(ws, r);
    for (const w of this.other(ws)) { try { w.send(msg); } catch {} }
  }
  webSocketClose(ws, code) {
    if (this.ctx.getTags(ws).includes('pipe')) for (const w of this.other(ws)) { try { w.send('{"pipe":"closed"}'); w.close(1000, 'other side left'); } catch {} }
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code); } catch {}
  }
  webSocketError(ws) { this.webSocketClose(ws, 1011); }

  async alarm() {
    this.notes = null;
    const notes = await this.load();
    if (notes.length) { await this.ctx.storage.put('notes', notes); await this.ctx.storage.setAlarm(notes[0].ms + KEEP_MS + 60e3); }
    else await this.ctx.storage.deleteAll();
  }
}
