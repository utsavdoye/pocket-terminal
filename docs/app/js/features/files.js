// Files: browse the computer's folders, type a file's path into the terminal, download a file
// to this phone, or upload from it. Everything goes over the live link in small pieces.

import { fmtSize, b64ToBytes, bytesToB64 } from '../core/bytes.js';

const CHUNK = 32 * 1024;
const ICON = {
  dir: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
};

export function setupFiles(ctx) {
  const { $, esc, toast } = ctx;

  // ================= Files =================
  let cwd = ctx.store.get('cwd', '~'), listing = null, xfer = null, lastFile = null;
  function crumbs(p, sep, home) {
    const parts = []; let acc = '';
    const segs = p.split(sep).filter(Boolean);
    if (p.startsWith(home)) { parts.push(['~', home]); acc = home; for (const s of home === p ? [] : p.slice(home.length).split(sep).filter(Boolean)) { acc += sep + s; parts.push([s, acc]); } }
    else { acc = sep === '/' ? '' : ''; parts.push([sep === '/' ? '/' : segs[0], sep === '/' ? '/' : segs[0] + sep]); acc = sep === '/' ? '' : segs[0]; for (const s of segs.slice(sep === '/' ? 0 : 1)) { acc += sep + s; parts.push([s, acc]); } }
    return parts.map(([n, v], i) => `${i ? '<span>›</span>' : ''}<button type="button" data-cd="${esc(v)}">${esc(n)}</button>`).join('');
  }
  function ls(p) {
    if (!ctx.live()) { $('fileList').innerHTML = '<div class="empty">Files need the live connection. Connect first.</div>'; return; }
    const id = ctx.newId();
    ctx.listen(id, (m) => {
      ctx.unlisten(id);
      if (m.error) return toast(m.error);
      listing = m; cwd = m.path; ctx.store.set('cwd', cwd);
      $('crumbs').innerHTML = crumbs(m.path, m.sep, m.home);
      $('crumbs').scrollLeft = 1e6;
      $('fileList').innerHTML = (m.entries.length ? m.entries.map((f, i) => `<button class="fi${f.d ? ' dir' : ''}" type="button" data-i="${i}">${f.d ? ICON.dir : ICON.file}<span>${esc(f.n)}</span><small>${f.d ? '' : fmtSize(f.s)}</small></button>`).join('') : '<div class="empty">Empty folder</div>')
        + (m.more ? '<div class="empty">Showing the first 2,000.</div>' : '');
    });
    ctx.send({ t: 'ls', id, path: p, hidden: $('fileHidden').checked });
  }
  ctx.onPage('files', () => ls(cwd));
  $('fileHidden').onchange = () => ls(cwd);
  $('crumbs').onclick = (e) => { const b = e.target.closest('[data-cd]'); if (b) ls(b.dataset.cd); };
  $('fileList').onclick = (e) => {
    const b = e.target.closest('[data-i]'); if (!b || !listing) return;
    const f = listing.entries[+b.dataset.i]; const full = listing.path + (listing.path.endsWith(listing.sep) ? '' : listing.sep) + f.n;
    if (f.d) return ls(full);
    openFileAct(f, full);
  };
  // Tapping a file asks what to do: type its path into the terminal (for a command or an AI agent), or download it.
  let faFile = null;
  // How the path is typed: ~/… when it's inside home and needs no quotes, else quoted so spaces and symbols are safe.
  function shellPath(p) {
    const win = listing.sep === '\\', home = listing.home;
    if (win) return /[\s&()^%!'";,]/.test(p) ? `"${p}"` : p;
    const safe = (x) => /^[\w@%+=:,.\/~-]+$/.test(x);
    if (home && (p === home || p.startsWith(home + '/'))) { const rel = '~' + p.slice(home.length); if (safe(rel)) return rel; }
    return safe(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
  }
  function openFileAct(f, full) {
    faFile = { f, full, typed: shellPath(full) };
    $('faName').textContent = f.n; $('faPath').textContent = faFile.typed;
    $('faGet').textContent = `Download to this phone · ${fmtSize(f.s)}`;
    $('fileAct').hidden = false;
  }
  const closeFileAct = () => { $('fileAct').hidden = true; faFile = null; };
  $('faCancel').onclick = closeFileAct;
  $('fileAct').onclick = (e) => { if (e.target.id === 'fileAct') closeFileAct(); };
  $('faForm').onsubmit = (e) => e.preventDefault();
  $('faPut').onclick = () => {
    if (!faFile) return;
    const t = faFile.typed; closeFileAct(); ctx.closeSheet();
    ctx.input(t + ' '); ctx.focus(); toast('Path added to the terminal');
  };
  $('faGet').onclick = () => {
    if (!faFile) return;
    const { f, full } = faFile;
    if (xfer) return toast('Wait for the current transfer');
    closeFileAct();
    if (f.s > 50 * 1048576 && !confirm(`${f.n} is ${fmtSize(f.s)}. Download it to this phone?`)) return;
    download(full, f.s);
  };
  function progress(done, total, text) {
    $('xfer').hidden = false; $('xferBar').style.width = `${total ? Math.min(100, (done / total) * 100) : 0}%`;
    $('xferText').textContent = text || `${fmtSize(done)} of ${fmtSize(total)}`;
  }
  function endXfer() { xfer = null; $('xfer').hidden = true; }
  function download(path, size) {
    const id = ctx.newId(), parts = []; let got = 0, name = 'file';
    xfer = { id, kind: 'get' }; $('saved').hidden = true; progress(0, size, 'Starting…');
    ctx.listen(id, (m) => {
      if (m.error) { ctx.unlisten(id); endXfer(); return toast(m.error); }
      if (m.t === 'get-h') { name = m.name; size = m.size; return progress(0, size); }
      if (m.d) { const b = b64ToBytes(m.d); parts.push(b); got += b.length; progress(got, size); }
      if (m.end) {
        ctx.unlisten(id); endXfer();
        lastFile = new File(parts, name, { type: guessType(name) });
        $('savedName').textContent = `${name} · ${fmtSize(got)}`; $('saved').hidden = false;
        $('savedShare').hidden = !(navigator.canShare && navigator.canShare({ files: [lastFile] }));
      }
    });
    ctx.send({ t: 'get', id, path });
  }
  $('savedShare').onclick = () => navigator.share({ files: [lastFile], title: lastFile.name }).catch(() => {});
  $('savedOpen').onclick = () => {
    const u = URL.createObjectURL(lastFile), a = document.createElement('a');
    a.href = u; a.download = lastFile.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60e3);
  };
  $('xferStop').onclick = () => {
    if (!xfer) return;
    ctx.send({ t: xfer.kind === 'get' ? 'get-cancel' : 'put-cancel', id: xfer.id }); ctx.unlisten(xfer.id);
    xfer.cancelled = true; endXfer(); toast('Cancelled');
  };
  $('fileUp').onclick = () => { if (!ctx.live()) return toast('Connect first'); if (xfer) return toast('Wait for the current transfer'); $('filePick').value = ''; $('filePick').click(); };
  $('filePick').onchange = async () => {
    const list = [...$('filePick').files];
    for (const f of list) { if (!(await upload(f))) break; }
    ls(cwd);
  };
  function upload(f) {
    return new Promise((resolve) => {
      if (f.size > 250 * 1048576) { toast(`${f.name} is over 250 MB`); return resolve(false); }
      const id = ctx.newId(); xfer = { id, kind: 'put' }; progress(0, f.size, `Uploading ${f.name}…`);
      ctx.listen(id, async (m) => {
        if (m.error) { ctx.unlisten(id); endXfer(); toast(m.error); return resolve(false); }
        if (m.t === 'put-ok') {
          let off = 0;
          while (off < f.size) {
            if (!xfer || xfer.cancelled || !ctx.live()) { ctx.unlisten(id); endXfer(); return resolve(false); }
            const buf = new Uint8Array(await f.slice(off, off + CHUNK).arrayBuffer());
            ctx.send({ t: 'put-c', id, d: bytesToB64(buf) }); off += buf.length;
            progress(off, f.size, `Uploading ${f.name} · ${fmtSize(off)} of ${fmtSize(f.size)}`);
            await ctx.drain();
          }
          ctx.send({ t: 'put-end', id });
        }
        if (m.t === 'put-done') { ctx.unlisten(id); endXfer(); toast(`Saved ${m.path.split(/[\\/]/).pop()}`); resolve(true); }
      });
      ctx.send({ t: 'put', id, dir: cwd, name: f.name, size: f.size });
    });
  }
}

function guessType(n) {
  const e = n.split('.').pop().toLowerCase();
  return ({ txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', zip: 'application/zip', sql: 'text/plain', log: 'text/plain', html: 'text/html', js: 'text/plain', py: 'text/plain' })[e] || 'application/octet-stream';
}
