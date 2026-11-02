// A pretend push service + phone for tests: prints a subscription, then decrypts and prints every
// notification the agent POSTs to it (one JSON line each).
const http = require('http');
const crypto = require('crypto');
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const srv = http.createServer((req, res) => {
  const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
    const body = Buffer.concat(parts);
    try {
      const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
      const ikm = Buffer.from(crypto.hkdfSync('sha256', ua.computeSecret(asPub), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
      const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
      const plain = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
      console.log(JSON.stringify({ ok: true, vapid: /^vapid t=/.test(req.headers.authorization || ''), msg: JSON.parse(plain.subarray(0, -1)) }));
    } catch (e) { console.log(JSON.stringify({ ok: false, error: e.message })); }
    res.writeHead(201); res.end();
  });
});
srv.listen(0, '127.0.0.1', () => {
  console.log(JSON.stringify({ endpoint: `http://127.0.0.1:${srv.address().port}/push/abc`, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } }));
});
