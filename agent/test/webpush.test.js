// Web Push: our encryption must be readable by a real browser's decryption (checked with the
// reference http_ece library if it's installed), and the VAPID signature must verify.
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const wp = require('../lib/webpush');
const ok = (name, v) => { console.log((v ? '✓ ' : '✗ ') + name); if (!v) process.exitCode = 1; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-push-'));
const keys = wp.loadKeys(dir);
ok('VAPID key is made once and reused', JSON.stringify(wp.loadKeys(dir)) === JSON.stringify(keys));
ok('key file is private', (fs.statSync(path.join(dir, 'push-key.json')).mode & 0o077) === 0 || process.platform === 'win32');

// a pretend phone
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const sub = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
const body = wp.encrypt(sub, JSON.stringify({ title: 'hi', body: 'claude needs you' }));

// Decrypt the way a phone does (RFC 8291), independently of our encrypt().
const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
const shared = ua.computeSecret(asPub);
const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
const plain = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
ok('phone can decrypt the notification', plain.at(-1) === 2 && JSON.parse(plain.subarray(0, -1)).body === 'claude needs you');

let ece = null; try { ece = require(process.env.HTTP_ECE || 'http_ece'); } catch {}
if (ece) {
  const out = ece.decrypt(body, { version: 'aes128gcm', privateKey: ua, authSecret: auth.toString('base64url') });
  ok('reference http_ece library decrypts it too', JSON.parse(out).title === 'hi');
} else console.log('- (http_ece not installed: skipped the reference check)');

// VAPID
const h = wp.vapidHeader(keys, sub.endpoint, 'mailto:a@b.c');
const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h);
const [hd, bd, sg] = jwt.split('.');
const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: keys.x, y: keys.y }, format: 'jwk' });
ok('VAPID signature verifies', crypto.verify('sha256', Buffer.from(`${hd}.${bd}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url')));
ok('VAPID audience is the push service', JSON.parse(Buffer.from(bd, 'base64url')).aud === 'https://web.push.apple.com');
ok('k= is our public key', k === wp.publicKey(keys) && Buffer.from(k, 'base64url').length === 65);

ok('Apple / Google / Mozilla endpoints allowed', ['https://web.push.apple.com/x', 'https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x'].every(wp.allowedEndpoint));
ok('anything else refused', !['https://evil.com/x', 'http://web.push.apple.com/x', 'https://web.push.apple.com.evil.com/x', 'file:///etc/passwd', 'https://127.0.0.1/x'].some(wp.allowedEndpoint));
fs.rmSync(dir, { recursive: true, force: true });
