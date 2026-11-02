// Phone notifications straight from your computer, with no server of ours in between.
//
// This is the standard Web Push protocol (RFC 8030 / 8291 / 8292), the same one websites use:
//   - your phone's browser gives us a "subscription": an address at Apple's / Google's /
//     Mozilla's push service, plus two keys only your phone can decrypt with
//   - we encrypt the message for your phone (ECDH P-256 + AES-128-GCM) and POST it there
//   - we sign each request with this computer's own VAPID key, so nobody else can use the address
// The push service only carries an encrypted blob; it can't read what the notification says.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

// Only real push services. Stops a subscription from pointing us at some other address.
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
function allowedEndpoint(endpoint) {
  let u; try { u = new URL(endpoint); } catch { return false; }
  if (process.env.POCKET_PUSH_TEST && u.hostname === '127.0.0.1') return true; // tests only
  return u.protocol === 'https:' && PUSH_HOSTS.some((r) => r.test(u.hostname));
}

// This computer's VAPID key pair, made once and kept in ~/.pocket-terminal/push-key.json.
function loadKeys(dir) {
  const f = path.join(dir, 'push-key.json');
  try { const k = JSON.parse(fs.readFileSync(f, 'utf8')); if (k.d && k.x && k.y) return k; } catch {}
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = privateKey.export({ format: 'jwk' });
  const k = { d: j.d, x: j.x, y: j.y };
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(f, JSON.stringify(k), { mode: 0o600 });
  return k;
}
const publicKey = (k) => b64u(Buffer.concat([Buffer.from([4]), fromB64u(k.x), fromB64u(k.y)]));

function vapidHeader(k, endpoint, subject) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: k.d, x: k.x, y: k.y }, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey(k)}`;
}

// RFC 8291 "aes128gcm": one record, no padding.
function encrypt(sub, payload) {
  const uaPublic = fromB64u(sub.keys.p256dh), auth = fromB64u(sub.keys.auth);
  if (uaPublic.length !== 65 || auth.length < 16) throw new Error('bad subscription keys');
  const as = crypto.createECDH('prime256v1'); as.generateKeys();
  const asPublic = as.getPublicKey();
  const shared = as.computeSecret(uaPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct]);
}

// Send one notification. Returns 'ok', 'gone' (the phone unsubscribed: forget it) or 'error'.
async function send(keys, sub, message, { subject = 'mailto:pocket-terminal@users.noreply.github.com', ttl = 3600, urgency = 'high', topic } = {}) {
  if (!sub || !allowedEndpoint(sub.endpoint)) return 'error';
  const body = encrypt(sub, JSON.stringify(message));
  const headers = { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', TTL: String(ttl), Urgency: urgency,
    Authorization: vapidHeader(keys, sub.endpoint, subject) };
  if (topic) headers.Topic = String(topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32); // a newer alert replaces an older one
  try {
    const r = await fetch(sub.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(15e3) });
    if (r.status === 404 || r.status === 410) return 'gone';
    return r.ok ? 'ok' : 'error';
  } catch { return 'error'; }
}

module.exports = { loadKeys, publicKey, send, encrypt, vapidHeader, allowedEndpoint };
