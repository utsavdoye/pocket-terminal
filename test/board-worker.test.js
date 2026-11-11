// Pocket Terminal's own message board (board/src/index.js), tested for real:
//   cd board && npx wrangler dev --port 8787        (in one terminal)
//   BOARD_URL=http://127.0.0.1:8787 node test/board-worker.test.js
// Without BOARD_URL it does nothing (the board needs Cloudflare's local runtime).
// The relay part: start the board with a stand-in for Cloudflare's TURN API on port 8799,
//   npx wrangler dev --port 8787 --var TURN_KEY_ID:kid --var TURN_KEY_TOKEN:tok --var TURN_API:http://127.0.0.1:8799
// and run this with TURN_MOCK=1 (it serves the stand-in itself).
const U = (process.env.BOARD_URL || '').replace(/\/+$/, '');
if (!U) { console.log('- own board: skipped (set BOARD_URL to test it)'); process.exit(0); }
const ok = (name, v) => { console.log((v ? '✓ ' : '✗ ') + name); if (!v) process.exitCode = 1; };
const rnd = () => 'pt-' + require('crypto').randomBytes(18).toString('base64url');
const wait = (fn, ms = 5000) => new Promise((res) => { const t0 = Date.now(); const i = setInterval(() => { const v = fn(); if (v || Date.now() - t0 > ms) { clearInterval(i); res(v); } }, 50); });
const lines = (t) => t.split('\n').filter(Boolean).map((l) => JSON.parse(l));

// A stand-in for Cloudflare's TURN API (what the board calls to get a relay login).
let turnHits = 0;
if (process.env.TURN_MOCK) {
  require('http').createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      turnHits++;
      if (req.method === 'GET' && req.url === '/api/v1/turn/credentials?apiKey=mk') { // Metered: a plain list, urls as strings
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([{ urls: 'stun:stun.relay.metered.ca:80' }, { urls: 'turn:global.relay.metered.ca:80', username: 'u1', credential: 'c1/+=' },
          { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'u1', credential: 'c1/+=' }, { urls: 'turn:global.relay.metered.ca:443', username: 'u1', credential: 'c1/+=' },
          { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'u1', credential: 'c1/+=' }]));
      }
      const ok = req.method === 'POST' && req.url === '/v1/turn/keys/kid/credentials/generate-ice-servers' && req.headers.authorization === 'Bearer tok' && JSON.parse(b || '{}').ttl > 0;
      res.writeHead(ok ? 201 : 401, { 'Content-Type': 'application/json' });
      res.end(ok ? JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
        { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turn:turn.cloudflare.com:3478?transport=tcp', 'turns:turn.cloudflare.com:5349?transport=tcp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u1', credential: 'c1/+=' }] }) : '{}');
    });
  }).listen(8799, '127.0.0.1');
}

(async () => {
  let r = await fetch(U + '/v1/health');
  ok('health answers, and browsers may call it (CORS)', r.ok && (await r.json()).healthy === true && r.headers.get('access-control-allow-origin') === '*');

  const t = rnd();
  const a = await (await fetch(`${U}/${t}`, { method: 'POST', body: 'pt1.first' })).json();
  const b = await (await fetch(`${U}/${t}`, { method: 'POST', body: 'pt1.second' })).json();
  ok('a posted note comes back with an id', a.event === 'message' && a.message === 'pt1.first' && /^[0-9a-f]{12}$/.test(a.id));
  let got = lines(await (await fetch(`${U}/${t}/json?poll=1&since=all`)).text());
  ok('reading the mailbox returns the notes in order', got.length === 2 && got[0].message === 'pt1.first' && got[1].message === 'pt1.second');
  got = lines(await (await fetch(`${U}/${t}/json?poll=1&since=${a.id}`)).text());
  ok('since=<id> returns only what came after', got.length === 1 && got[0].id === b.id);
  got = lines(await (await fetch(`${U}/${t}/json?poll=1&since=10m`)).text());
  ok('since=10m returns recent notes', got.length === 2);
  ok('another mailbox sees nothing', (await (await fetch(`${U}/${rnd()}/json?poll=1&since=all`)).text()) === '');

  ok('a name that is not a mailbox is refused', (await fetch(`${U}/hello`, { method: 'POST', body: 'x' })).status === 404 && (await fetch(`${U}/${t}/json/extra`)).status === 404);
  ok('a note that is too big is refused', (await fetch(`${U}/${t}`, { method: 'POST', body: 'x'.repeat(5000) })).status === 413);
  ok('an endless stream is refused (it would keep the mailbox awake)', (await fetch(`${U}/${t}/json?since=all`)).status === 426);
  r = await fetch(`${U}/ptn-${t.slice(3)}`, { method: 'POST', body: 'for the ntfy app' });
  ok('notes for the ntfy app are accepted and not kept', r.ok);

  // The agent's own board client, over a WebSocket: backlog first, then live notes.
  for (const impl of ['built-in', 'mini']) {
    if (impl === 'built-in' && typeof WebSocket !== 'function') continue;
    process.env.POCKET_WS = impl === 'mini' ? 'mini' : '';
    const { Board } = require('../agent/lib/board');
    const t2 = rnd(); await fetch(`${U}/${t2}`, { method: 'POST', body: 'before' });
    const seen = []; let opened = 0;
    const bd = new Board([U], t2, { since: { [U]: 'all' } });
    bd.stream((m) => seen.push(m), () => opened++);
    await wait(() => opened && seen.length === 1);
    ok(`agent (${impl} WebSocket): connects and gets the notes left earlier`, opened === 1 && seen[0] === 'before' && !bd.noWs.has(U));
    await bd.publish('live-1');
    ok(`agent (${impl} WebSocket): a new note arrives live`, await wait(() => seen.includes('live-1'), 3000));
    bd.restart((m) => seen.push(m), () => opened++); // like after the computer wakes
    await fetch(`${U}/${t2}`, { method: 'POST', body: 'live-2' });
    await wait(() => seen.includes('live-2'), 4000);
    ok(`agent (${impl} WebSocket): after a restart it carries on from the last note, no repeats`, seen.join() === 'before,live-1,live-2');
    const polled = []; const b2 = new Board([U], t2, { since: { [U]: 'all' } }); await b2.poll((m) => polled.push(m));
    ok(`agent (${impl}): poll reads the whole mailbox`, polled.join() === 'before,live-1,live-2');
    bd.stop();
  }

  // The relay login.
  const ti = rnd(); r = await fetch(`${U}/${ti}/ice`); let ice = await r.json();
  if (process.env.TURN_MOCK === 'metered') {
    const urls = (ice.iceServers || []).flatMap((x) => x.urls);
    ok('relay (Metered, free): the board hands out its login', r.ok && urls.length === 4 && ice.iceServers.every((x) => x.username === 'u1' && x.credential === 'c1/+=') && !urls.some((u) => /^stun:/.test(u)));
    await fetch(`${U}/${ti}/ice`);
    ok('relay (Metered): asked once, then kept', turnHits === 1);
    const n = require('../agent/lib/ice').toNdc(ice.iceServers);
    ok('relay (Metered): the computer gets the UDP relays', n.length === 2 && n.every((x) => x.relayType === 'TurnUdp' && x.hostname === 'global.relay.metered.ca') && n.map((x) => x.port).join() === '80,443');
  } else if (process.env.TURN_MOCK) {
    const urls = (ice.iceServers || []).flatMap((x) => x.urls);
    ok('relay: the board hands out a relay login (no port 53, STUN left out)', r.ok && ice.iceServers.length === 1 && ice.iceServers[0].username === 'u1' && ice.iceServers[0].credential === 'c1/+=' && urls.length === 4 && !urls.some((u) => /:53(\?|$)/.test(u)) && ice.ttl > 3600);
    const again = await (await fetch(`${U}/${ti}/ice`)).json();
    ok('relay: the same mailbox gets the kept login, Cloudflare is asked once', turnHits === 1 && again.iceServers[0].username === 'u1');
    process.env.POCKET_WS = '';
    const { toNdc } = require('../agent/lib/ice');
    const n = toNdc(ice.iceServers);
    ok('relay: the computer gets it in its link library\'s form (UDP only)', n.length === 1 && n[0].hostname === 'turn.cloudflare.com' && n[0].port === 3478 && n[0].username === 'u1' && n[0].password === 'c1/+=' && n[0].relayType === 'TurnUdp');
  } else ok('relay: without a TURN key the board says so (no relay, nothing breaks)', r.ok && Array.isArray(ice.iceServers) && ice.iceServers.length === 0);
  ok('relay: not for a name that is not a mailbox', (await fetch(`${U}/budget/ice`)).status === 404 && (await fetch(`${U}/budget`, { method: 'POST' })).status === 404);

  // The pipe: the live terminal through the board when a direct link is blocked.
  {
    const { openSocket } = require('../agent/lib/board');
    const tp = rnd(), id = 'pipetest' + Date.now();
    const side = (name) => { const s = { got: [], ready: 0, closed: 0 }; s.ws = openSocket(`${U.replace(/^http/, 'ws')}/${tp}/pipe?id=${id}&side=${name}`, { open() {}, message(t) { if (t === '{"pipe":"ready"}') s.ready++; else if (t === '{"pipe":"closed"}') s.closed++; else s.got.push(t); }, close() { s.ended = true; } }); return s; };
    const ph = side('phone');
    await new Promise((r) => setTimeout(r, 400));
    ok('pipe: alone, nobody says ready', ph.ready === 0);
    const mc = side('mac');
    ok('pipe: both sides there: both hear "ready"', await wait(() => ph.ready === 1 && mc.ready === 1, 4000));
    ph.ws.send('pt1.from-phone'); mc.ws.send('pt1.from-mac');
    ok('pipe: each side gets what the other sent (not its own)', await wait(() => mc.got.join() === 'pt1.from-phone' && ph.got.join() === 'pt1.from-mac', 4000));
    // one side leaves: the other is told and closed
    mc.ws.close();
    ok('pipe: when one side leaves, the other is told and closed', await wait(() => ph.closed === 1 && ph.ended, 4000));
    // notes still reach note listeners, and never a pipe
    const tp2 = rnd(), id2 = 'pipetwo' + Date.now(), seen = [];
    const listener = openSocket(`${U.replace(/^http/, 'ws')}/${tp2}/ws?since=all`, { open() {}, message(t) { seen.push(t); }, close() {} });
    const p2 = { got: [] }; openSocket(`${U.replace(/^http/, 'ws')}/${tp2}/pipe?id=${id2}&side=phone`, { open() {}, message(t) { p2.got.push(t); }, close() {} });
    await new Promise((r) => setTimeout(r, 500));
    await fetch(`${U}/${tp2}`, { method: 'POST', body: 'pt1.a-note' });
    ok('pipe: notes go to note listeners only, never into a pipe', await wait(() => seen.some((t) => t.includes('pt1.a-note')), 3000) && !p2.got.some((t) => t.includes('a-note')));
    listener.close();
    const bad = { opened: false, ended: false };
    openSocket(`${U.replace(/^http/, 'ws')}/${tp2}/pipe?id=x&side=phone`, { open() { bad.opened = true; }, message() {}, close() { bad.ended = true; } });
    ok('pipe: a bad pipe id is refused', await wait(() => bad.ended, 4000) && !bad.opened);
  }

  // Per mailbox, not per internet connection: one mailbox can't flood, others are unaffected.
  const t3 = rnd(); let s = 200, n = 0;
  for (; n < 320 && s === 200; n++) s = (await fetch(`${U}/${t3}`, { method: 'POST', body: 'x' })).status;
  ok('one mailbox is slowed down after 300 notes in 10 minutes', s === 429 && n === 301);
  ok('other mailboxes still work', (await fetch(`${U}/${rnd()}`, { method: 'POST', body: 'x' })).ok);
  got = lines(await (await fetch(`${U}/${t3}/json?poll=1&since=all`)).text());
  ok('a mailbox keeps at most 200 notes', got.length === 200);
  setTimeout(() => process.exit(process.exitCode || 0), 300);
})();
