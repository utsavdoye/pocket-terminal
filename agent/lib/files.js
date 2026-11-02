// Files: browse folders, send a file to the phone, save a file from the phone.
// Everything travels over the direct link in 32 KB pieces, waiting whenever the link is busy.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_FILE = 250 * 1024 * 1024; // 250 MB each way
const CHUNK = 32 * 1024;

function resolve(p) {
  p = String(p || '~').trim() || '~';
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(os.homedir(), p);
}

async function list(p, { hidden = false } = {}) {
  const dir = resolve(p);
  const items = await fs.promises.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const it of items.slice(0, 3000)) {
    if (!hidden && it.name.startsWith('.')) continue;
    let st = null; try { st = await fs.promises.stat(path.join(dir, it.name)); } catch {}
    out.push({ n: it.name, d: st ? st.isDirectory() : it.isDirectory(), s: st && st.isFile() ? st.size : null, m: st ? st.mtimeMs : null });
  }
  out.sort((a, b) => (b.d - a.d) || a.n.localeCompare(b.n, undefined, { numeric: true, sensitivity: 'base' }));
  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, home: os.homedir(), sep: path.sep, entries: out.slice(0, 2000), more: out.length > 2000 };
}

// A safe file name: no folders, no "..", no control characters.
function cleanName(n) {
  const s = path.basename(String(n || '').replace(/[\\/]/g, '_')).replace(/[\x00-\x1f<>:"|?*]/g, '_').trim().slice(0, 200);
  return !s || s === '.' || s === '..' ? 'upload' : s;
}
function freeName(dir, name) {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  let n = name, i = 1;
  while (fs.existsSync(path.join(dir, n))) n = `${base} (${i++})${ext}`;
  return n;
}

// Send one file: send(msg) for each message, drain() resolves when the link has room again.
async function sendFile(id, p, { send, drain, cancelled }) {
  const f = resolve(p);
  const st = await fs.promises.stat(f);
  if (!st.isFile()) throw new Error('Not a file');
  if (st.size > MAX_FILE) throw new Error('Files over 250 MB are too big to send to a phone');
  send({ t: 'get-h', id, name: path.basename(f), size: st.size });
  const stream = fs.createReadStream(f, { highWaterMark: CHUNK });
  let n = 0;
  for await (const chunk of stream) {
    if (cancelled()) { stream.destroy(); return; }
    send({ t: 'get-c', id, n: n++, d: chunk.toString('base64') });
    await drain();
  }
  send({ t: 'get-c', id, n, end: true });
}

// Receive one file. Writes to "name.part" first and renames it when complete.
function receiver(dir, name, size) {
  const d = resolve(dir);
  if (!(size >= 0) || size > MAX_FILE) throw new Error('Files over 250 MB are too big');
  if (!fs.statSync(d).isDirectory()) throw new Error('That folder does not exist');
  const final = freeName(d, cleanName(name));
  const part = path.join(d, `.${final}.part`);
  const ws = fs.createWriteStream(part, { mode: 0o644 });
  let got = 0, failed = null;
  ws.on('error', (e) => { failed = e; });
  return {
    path: path.join(d, final),
    write(b64) {
      if (failed) throw failed;
      const b = Buffer.from(String(b64), 'base64'); got += b.length;
      if (got > size) throw new Error('More data than announced');
      return ws.write(b);
    },
    end() {
      return new Promise((res, rej) => ws.end(() => {
        if (failed) return rej(failed);
        if (got !== size) { fs.rm(part, () => {}); return rej(new Error('The upload was cut off')); }
        fs.rename(part, path.join(d, final), (e) => (e ? rej(e) : res(path.join(d, final))));
      }));
    },
    abort() { ws.destroy(); fs.rm(part, () => {}); },
  };
}

module.exports = { list, sendFile, receiver, resolve, cleanName, MAX_FILE, CHUNK };
