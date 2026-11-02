// Localhost preview: your phone opens a website running on this computer (localhost:3000 …)
// through the same encrypted link. Only this computer's own loopback address is reachable.

const http = require('http');
const zlib = require('zlib');
const run = require('../platform/run');

const MAX_BODY = 60 * 1024 * 1024;
const CHUNK = 32 * 1024;
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'host', 'content-length']);
// Response headers that would break the page inside the app's preview frame.
const DROP_RES = new Set([...HOP, 'content-encoding', 'content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'set-cookie', 'strict-transport-security', 'alt-svc']);

function request(host, port, opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, ...opts, timeout: 60e3 }, resolve);
    req.on('timeout', () => req.destroy(new Error('The site took too long to answer')));
    req.on('error', reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

// m: { id, port, method, path, headers, body(base64) }
async function proxy(m, { send, drain }) {
  const port = Number(m.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Bad port');
  const p = String(m.path || '/'); if (!p.startsWith('/')) throw new Error('Bad path');
  const method = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(m.method) ? m.method : 'GET';
  const headers = {};
  for (const [k, v] of Object.entries(m.headers || {})) {
    const lk = k.toLowerCase();
    if (HOP.has(lk) || lk === 'cookie' || lk.startsWith('sec-') || lk === 'service-worker') continue;
    headers[lk] = String(v).slice(0, 8000);
  }
  headers.host = `localhost:${port}`;
  if (headers.origin) headers.origin = `http://localhost:${port}`;
  if (headers.referer) { try { const r = new URL(headers.referer); headers.referer = `http://localhost:${port}${r.pathname.replace(/^.*?\/preview\/\d+/, '') || '/'}${r.search}`; } catch { delete headers.referer; } }
  headers['accept-encoding'] = 'gzip, deflate, br';
  const body = m.body ? Buffer.from(String(m.body), 'base64') : null;
  if (body && body.length > 10 * 1024 * 1024) throw new Error('Request too big');

  let res;
  try { res = await request('127.0.0.1', port, { method, path: p, headers }, body); }
  catch (e) {
    if (e.code !== 'ECONNREFUSED') throw e;
    try { res = await request('::1', port, { method, path: p, headers }, body); } // Vite & co. often listen on ::1 only
    catch { throw new Error(`Nothing is running on localhost:${port}`); }
  }
  const out = {};
  for (const [k, v] of Object.entries(res.headers)) if (!DROP_RES.has(k)) out[k] = Array.isArray(v) ? v.join(', ') : String(v);
  if (out.location) out.location = out.location.replace(/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i, '');
  send({ t: 'http-h', id: m.id, status: res.statusCode, headers: out });

  const enc = String(res.headers['content-encoding'] || '').toLowerCase();
  const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress())
    : enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
  let total = 0, n = 0, buf = Buffer.alloc(0);
  for await (const c of stream) {
    total += c.length;
    if (total > MAX_BODY) { res.destroy(); send({ t: 'http-c', id: m.id, n: n++, error: 'Response too big (over 60 MB)' }); return; }
    buf = Buffer.concat([buf, c]);
    while (buf.length >= CHUNK) { send({ t: 'http-c', id: m.id, n: n++, d: buf.subarray(0, CHUNK).toString('base64') }); buf = buf.subarray(CHUNK); await drain(); }
  }
  send({ t: 'http-c', id: m.id, n: n++, d: buf.toString('base64'), end: true });
}

// Which local ports have something listening (dev servers etc.), with the program's name.
function parseLsof(text) {
  const out = []; let pid = null, cmd = '';
  for (const line of String(text).split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'c') cmd = line.slice(1);
    else if (line[0] === 'n') { const m = /[:.](\d+)$/.exec(line); if (m) out.push({ port: Number(m[1]), name: cmd, pid, addr: line.slice(1, line.lastIndexOf(':')) }); }
  }
  return out;
}
function parseSs(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = /^\S+\s+\d+\s+\d+\s+(\S+):(\d+)\s+\S+(?:\s+users:\(\("([^"]+)",pid=(\d+))?/.exec(line.trim());
    if (m) out.push({ port: Number(m[2]), name: m[3] || '', pid: m[4] ? Number(m[4]) : null, addr: m[1] });
  }
  return out;
}
function parseWinPorts(text) {
  let j = []; try { j = JSON.parse(String(text).trim() || '[]'); } catch {}
  if (!Array.isArray(j)) j = [j];
  return j.map((x) => ({ port: Number(x.LocalPort), name: String(x.Name || ''), pid: Number(x.OwningProcess) || null, addr: String(x.LocalAddress || '') }));
}
function parseProcNet(texts) {
  const out = [];
  for (const t of texts || ['/proc/net/tcp', '/proc/net/tcp6'].map((f) => { try { return require('fs').readFileSync(f, 'utf8'); } catch { return ''; } })) {
    for (const line of t.split('\n').slice(1)) {
      const c = line.trim().split(/\s+/); if (c[3] !== '0A') continue; // 0A = listening
      const [ip, port] = c[1].split(':');
      const addr = /^0+$/.test(ip) ? '0.0.0.0' : ip === '0100007F' ? '127.0.0.1' : ip === '00000000000000000000000001000000' ? '::1' : ip;
      out.push({ port: parseInt(port, 16), name: '', pid: null, addr });
    }
  }
  return out;
}
const reachable = (a) => !a || /^(\*|0\.0\.0\.0|127\.\d+\.\d+\.\d+|::|::1|\[::\]|\[::1\]|localhost)$/i.test(a.replace(/%.*$/, ''));

async function listPorts() {
  let raw = [];
  if (process.platform === 'darwin') raw = parseLsof((await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'], 8e3)).out);
  else if (process.platform === 'win32') {
    raw = parseWinPorts((await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-NetTCPConnection -State Listen | ForEach-Object { [pscustomobject]@{ LocalAddress=$_.LocalAddress; LocalPort=$_.LocalPort; OwningProcess=$_.OwningProcess; Name=(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName } } | ConvertTo-Json -Compress'], 15e3)).out);
  } else { // Linux: ss, else lsof, else the kernel's own table (ports only, no names)
    const r = await run('ss', ['-ltnpH'], 8e3);
    if (r.ok) raw = parseSs(r.out);
    else { const l = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'], 8e3); raw = l.ok ? parseLsof(l.out) : parseProcNet(); }
  }
  const seen = new Map();
  for (const r of raw) {
    if (!(r.port >= 1024) || r.pid === process.pid || !reachable(r.addr)) continue;
    if (/^(rapportd|ControlCe|ControlCenter|AirPlayXPCHelper|identityservicesd|sharingd|svchost|lsass|wininit|services|spoolsv|System|systemd-resolve|cupsd)$/i.test(r.name)) continue;
    if (!seen.has(r.port)) seen.set(r.port, { port: r.port, name: r.name });
  }
  return [...seen.values()].sort((a, b) => a.port - b.port).slice(0, 40);
}

module.exports = { proxy, listPorts, parseLsof, parseSs, parseWinPorts, parseProcNet };
