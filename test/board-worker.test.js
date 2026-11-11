// Pocket Terminal's own message board (board/src/index.js), tested for real:
//   cd board && npx wrangler dev --port 8787        (in one terminal)
//   BOARD_URL=http://127.0.0.1:8787 node test/board-worker.test.js
// Without BOARD_URL it does nothing (the board needs Cloudflare's local runtime).
const U = (process.env.BOARD_URL || '').replace(/\/+$/, '');
if (!U) { console.log('- own board: skipped (set BOARD_URL to test it)'); process.exit(0); }
const ok = (name, v) => { console.log((v ? '✓ ' : '✗ ') + name); if (!v) process.exitCode = 1; };
const rnd = () => 'pt-' + require('crypto').randomBytes(18).toString('base64url');
const wait = (fn, ms = 5000) => new Promise((res) => { const t0 = Date.now(); const i = setInterval(() => { const v = fn(); if (v || Date.now() - t0 > ms) { clearInterval(i); res(v); } }, 50); });
const lines = (t) => t.split('\n').filter(Boolean).map((l) => JSON.parse(l));

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
  for (const impl of ['built-in', 'ndc']) {
    if (impl === 'built-in' && typeof WebSocket !== 'function') continue;
    process.env.POCKET_WS = impl === 'ndc' ? 'ndc' : '';
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
  try { require('node-datachannel').cleanup(); } catch {}

  // Per mailbox, not per internet connection: one mailbox can't flood, others are unaffected.
  const t3 = rnd(); let s = 200, n = 0;
  for (; n < 320 && s === 200; n++) s = (await fetch(`${U}/${t3}`, { method: 'POST', body: 'x' })).status;
  ok('one mailbox is slowed down after 300 notes in 10 minutes', s === 429 && n === 301);
  ok('other mailboxes still work', (await fetch(`${U}/${rnd()}`, { method: 'POST', body: 'x' })).ok);
  got = lines(await (await fetch(`${U}/${t3}/json?poll=1&since=all`)).text());
  ok('a mailbox keeps at most 200 notes', got.length === 200);
  setTimeout(() => process.exit(process.exitCode || 0), 300);
})();
