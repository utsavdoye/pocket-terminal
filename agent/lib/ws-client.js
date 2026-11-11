// A small WebSocket client for Node versions without a built-in one (Node 22 has it; 18 and 20
// don't). It uses Node's own http/https, so wss:// checks certificates the way the rest of Node
// does. Text messages only, which is all the message board and the pipe use.
//
//   const ws = connect('wss://host/path', { open(), message(text), close() })
//   ws.send(text); ws.close(); ws.buffered()

const http = require('http');
const https = require('https');
const crypto = require('crypto');

function connect(url, on) {
  const u = new URL(url);
  const secure = u.protocol === 'wss:';
  const key = crypto.randomBytes(16).toString('base64');
  let sock = null, done = false, buf = Buffer.alloc(0), parts = [], partOp = 0;
  const end = () => { if (done) return; done = true; try { sock && sock.destroy(); } catch {} on.close(); };

  const req = (secure ? https : http).request({
    host: u.hostname, port: u.port || (secure ? 443 : 80), path: u.pathname + u.search, method: 'GET',
    headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' },
  });
  req.setTimeout(15e3, () => req.destroy());
  req.on('error', end);
  req.on('response', (res) => { res.resume(); end(); }); // a normal answer: no WebSocket here
  req.on('upgrade', (res, s, head) => {
    const want = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    if (res.headers['sec-websocket-accept'] !== want) { s.destroy(); return end(); }
    sock = s; sock.setNoDelay(true);
    sock.on('data', (d) => { buf = Buffer.concat([buf, d]); read(); });
    sock.on('close', end); sock.on('error', end);
    on.open();
    if (head && head.length) { buf = Buffer.concat([buf, head]); read(); }
  });
  req.end();

  function read() {
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const mask = masked ? buf.subarray(off, off + 4) : null; if (masked) off += 4;
      if (buf.length < off + len) return;
      let data = buf.subarray(off, off + len); buf = buf.subarray(off + len);
      if (mask) { data = Buffer.from(data); for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3]; }
      if (op === 0x8) { frame(0x8, Buffer.alloc(0)); return end(); }
      if (op === 0x9) { frame(0xa, data); continue; }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x2) { partOp = op; parts = [data]; } else if (op === 0x0) parts.push(data); else continue;
      if (fin) { const msg = Buffer.concat(parts); parts = []; if (partOp === 0x1 || partOp === 0x2) on.message(msg.toString('utf8')); }
    }
  }
  function frame(op, payload) {
    if (!sock || sock.destroyed) return;
    const n = payload.length, mask = crypto.randomBytes(4);
    const head = n < 126 ? Buffer.from([0x80 | op, 0x80 | n]) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    if (n >= 126 && n < 65536) { head[0] = 0x80 | op; head[1] = 0x80 | 126; head.writeUInt16BE(n, 2); }
    else if (n >= 65536) { head[0] = 0x80 | op; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(n), 2); }
    const body = Buffer.from(payload); for (let i = 0; i < n; i++) body[i] ^= mask[i & 3];
    sock.write(Buffer.concat([head, mask, body]));
  }
  return {
    send: (text) => frame(0x1, Buffer.from(String(text), 'utf8')),
    close: () => { if (sock && !done) { frame(0x8, Buffer.from([0x03, 0xe8])); setTimeout(end, 500); } else { req.destroy(); end(); } },
    buffered: () => (sock ? sock.writableLength : 0),
  };
}

module.exports = { connect };
