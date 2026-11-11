// A tiny stand-in for ntfy.sh, for offline tests. Implements just what Pocket Terminal uses:
//   POST /:topic                     store a note
//   GET  /:topic/json?since=…        stream notes (newline JSON), or ?poll=1 to return at once
// usage: node test/mock-board.js [port]
const http = require('http');
const crypto = require('crypto');

function startBoard(port = 0) {
  const topics = new Map(); // topic -> [{id,time,event,topic,message}]
  const watchers = new Map(); // topic -> Set(res)
  const stats = { posts: 0 };

  function after(list, since) {
    if (!since || since === 'all') return list;
    const dur = /^(\d+)([smh])$/.exec(since);
    if (dur) { const ms = dur[1] * { s: 1e3, m: 60e3, h: 3600e3 }[dur[2]]; return list.filter((m) => m.time * 1000 >= Date.now() - ms); }
    if (/^\d+$/.test(since)) return list.filter((m) => m.time >= Number(since));
    const i = list.findIndex((m) => m.id === since);
    return i >= 0 ? list.slice(i + 1) : list;
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const topic = parts[0];
    if (!topic || !/^[-_A-Za-z0-9]{1,64}$/.test(topic)) { res.writeHead(404); return res.end(); }
    // Tests can make the board refuse posts like ntfy.sh does when the day's limit is used up.
    if (req.method === 'POST' && process.env.MOCK_BOARD_FULL && require('fs').existsSync(process.env.MOCK_BOARD_FULL)) {
      res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end('{"code":42908,"http":429,"error":"limit reached: daily message quota reached"}');
    }
    if (req.method === 'POST' && parts.length === 1) {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (body.length > 4096) { res.writeHead(413); return res.end(); }
        const m = { id: crypto.randomBytes(6).toString('hex'), time: Math.floor(Date.now() / 1000), event: 'message', topic, message: body };
        if (!topics.has(topic)) topics.set(topic, []);
        topics.get(topic).push(m); stats.posts++;
        for (const w of watchers.get(topic) || []) w.write(JSON.stringify(m) + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(m));
      });
      return;
    }
    // The relay login our own board hands out (MOCK_TURN_ICE: the iceServers JSON to give).
    if (req.method === 'GET' && parts[1] === 'ice') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ iceServers: process.env.MOCK_TURN_ICE ? JSON.parse(process.env.MOCK_TURN_ICE) : [], ttl: 43200 }));
    }
    if (req.method === 'GET' && parts[1] === 'json') {
      const list = after(topics.get(topic) || [], url.searchParams.get('since'));
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      if (url.searchParams.get('poll')) { for (const m of list) res.write(JSON.stringify(m) + '\n'); return res.end(); }
      res.write(JSON.stringify({ id: 'open', time: Math.floor(Date.now() / 1000), event: 'open', topic }) + '\n');
      for (const m of list) res.write(JSON.stringify(m) + '\n');
      if (!watchers.has(topic)) watchers.set(topic, new Set());
      watchers.get(topic).add(res);
      const ka = setInterval(() => res.write(JSON.stringify({ event: 'keepalive' }) + '\n'), 25e3);
      req.on('close', () => { clearInterval(ka); watchers.get(topic).delete(res); });
      return;
    }
    res.writeHead(404); res.end();
  });
  // WebSockets: only the pipe (like our own board); notes are read as a stream (like ntfy.sh).
  stats.pipeMessages = []; // everything that went through a pipe, for tests to check it's sealed
  const pipes = new Map(); // pipe id -> { phone, mac }
  server.on('upgrade', (req, sock) => {
    const u = new URL(req.url, 'http://x'), parts = u.pathname.split('/').filter(Boolean);
    const id = u.searchParams.get('id'), side = u.searchParams.get('side');
    if (parts[1] !== 'pipe' || !/^[-_A-Za-z0-9]{12,40}$/.test(id || '') || !['phone', 'mac'].includes(side)) return sock.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = (text) => { if (sock.destroyed) return; const b = Buffer.from(text), n = b.length; const h = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127]), (() => { const x = Buffer.alloc(8); x.writeBigUInt64BE(BigInt(n)); return x; })()]); sock.write(Buffer.concat([h, b])); };
    const p = pipes.get(id) || {}; pipes.set(id, p);
    if (p[side]) p[side].close();
    const me = { send, close: () => { try { sock.end(Buffer.from([0x88, 0])); } catch {} sock.destroy(); } };
    p[side] = me;
    const other = side === 'phone' ? 'mac' : 'phone';
    if (p[other]) { p[other].send('{"pipe":"ready"}'); send('{"pipe":"ready"}'); }
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const op = buf[0] & 15; let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + 4 + len) return;
        const mask = buf.subarray(off, off + 4), data = Buffer.from(buf.subarray(off + 4, off + 4 + len)); buf = buf.subarray(off + 4 + len);
        for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
        if (op === 8) { sock.destroy(); return; }
        if (op === 9) continue;
        const text = data.toString();
        if (text === 'ping') { send('pong'); continue; }
        stats.pipeMessages.push(text);
        const o = pipes.get(id) && pipes.get(id)[other]; if (o) o.send(text);
      }
    });
    sock.on('close', () => { const q = pipes.get(id); if (!q || q[side] !== me) return; delete q[side]; const o = q[other]; if (o) { o.send('{"pipe":"closed"}'); o.close(); delete q[other]; } });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, topics, stats })));
}

if (require.main === module) startBoard(Number(process.argv[2] || 8790)).then(({ port }) => console.log(`mock board on http://127.0.0.1:${port}`));
module.exports = { startBoard };
