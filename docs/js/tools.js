// Pocket Terminal phone app: the tools around the terminal.
//   Terminals   what's running on the computer; switch, close, share a view-only link
//   Needs you   a program asks something (an AI agent's "Do you want to proceed?", [y/N]): answer in one tap
//   Notify      phone notifications straight from the computer (Web Push), tap to jump to that terminal
//   Files       browse, download to this phone, upload from it
//   Websites    open the computer's localhost:3000 here, through the encrypted link
//   Voice       say what you want in Ask
// app.js hands in `ctx` (the link, the menu, toasts…); nothing here talks to the network by itself.

const CHUNK = 32 * 1024;
const fmtSize = (n) => n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`;
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function bytesToB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
const ICON = {
  dir: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
};

export function setupTools(ctx) {
  const { $, esc, ago, toast } = ctx;

  // ================= Needs you: one-tap answers =================
  let needsFor = null;
  function showNeeds(m) {
    if (m.kind !== 'input' || (m.sid && m.sid !== ctx.sid())) return;
    const text = String(m.text || '');
    $('needsTitle').textContent = `${m.program ? m.program[0].toUpperCase() + m.program.slice(1) : 'Your terminal'} needs you`;
    $('needsLine').textContent = text;
    // Pick buttons that fit the question.
    let btns;
    if (m.menu || /(?:❯|›)\s*1\./.test(text) || /do you want/i.test(text)) btns = [['1 · Yes', '1', 'yes'], ['2', '2'], ['3 · No', '3'], ['Enter', '\r'], ['Esc', '\x1b']];
    else if (/y\/n|yes\/no/i.test(text)) btns = [['Yes', 'y\r', 'yes'], ['No', 'n\r'], ['Enter', '\r'], ['^C', '\x03']];
    else if (/password|passphrase/i.test(text)) btns = [['Type it', null, 'yes'], ['^C', '\x03']];
    else btns = [['Enter', '\r', 'yes'], ['y', 'y\r'], ['n', 'n\r'], ['Esc', '\x1b'], ['^C', '\x03']];
    $('needsBtns').innerHTML = btns.map(([l, d, c], i) => `<button type="button" data-i="${i}"${c ? ` class="${c}"` : ''}>${esc(l)}</button>`).join('');
    $('needsBtns').onclick = (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const d = btns[+b.dataset.i][1]; hideNeeds();
      if (d) ctx.input(d); ctx.focus();
    };
    needsFor = m.sid || ctx.sid(); $('needs').hidden = false; ctx.relayout();
    navigator.vibrate && navigator.vibrate([30, 60, 30]);
  }
  function hideNeeds() { if (!$('needs').hidden) { $('needs').hidden = true; needsFor = null; ctx.relayout(); } }
  ctx.on('alert', (m) => { if (m.kind === 'input') showNeeds(m); refreshSessionsSoon(); });
  ctx.onInput(hideNeeds);

  // ================= Terminals =================
  let sessions = [], current = null, shareId = null;
  const label = (s) => s.program ? s.program : s.running ? 'Shell' : 'Not started';
  function paintSessions() {
    const waiting = sessions.filter((s) => s.waiting && s.sid !== current).length;
    $('sessCount').textContent = waiting || '';
    $('sessList').innerHTML = sessions.length ? sessions.map((s) => {
      const st = s.waiting ? 'wait' : s.busy && s.lastOut && Date.now() - s.lastOut < 60e3 ? 'work' : '';
      const what = s.waiting ? 'Waiting for your answer' : st === 'work' ? 'Working…' : s.program ? 'Running' : 'At the prompt';
      return `<div class="item sess${s.sid === current ? ' cur' : ''}"><button class="sess" data-sw="${esc(s.sid)}" type="button">
        <i class="st ${st}"></i><span class="body"><b>${esc(label(s))}${s.sid === current ? ' · this one' : ''}</b><small>${what}${s.lastOut ? ' · ' + ago(s.lastOut) : ''}${s.viewers > (s.sid === current ? 1 : 0) ? ' · 👁 ' + (s.viewers - (s.sid === current ? 1 : 0)) : ''}</small>${s.line ? `<code>${esc(s.line)}</code>` : ''}</span></button>
        ${s.sid !== current ? `<button class="x" data-close="${esc(s.sid)}" type="button" aria-label="Close terminal">✕</button>` : ''}</div>`;
    }).join('') : '<div class="empty">Connect to see your terminals.</div>';
  }
  function refreshSessions() { if (ctx.live()) ctx.send({ t: 'sessions' }); }
  let rsT; function refreshSessionsSoon() { clearTimeout(rsT); rsT = setTimeout(refreshSessions, 400); }
  ctx.on('sessions', (m) => { sessions = m.list || []; current = m.current; paintSessions(); });
  ctx.on('hi', () => { refreshSessions(); ctx.send({ t: 'shares' }); });
  ctx.on('switched', (m) => { current = m.sid; ctx.setSid(m.sid); hideNeeds(); refreshSessions(); });
  setInterval(() => { if (ctx.pageOpen('sessions')) refreshSessions(); }, 4000);
  $('sessList').onclick = (e) => {
    const c = e.target.closest('[data-close]');
    if (c) { const s = sessions.find((x) => x.sid === c.dataset.close); if (s && s.program && !confirm(`Close this terminal? ${s.program} is still running in it.`)) return; ctx.send({ t: 'close-session', sid: c.dataset.close }); return; }
    const b = e.target.closest('[data-sw]'); if (!b) return;
    if (b.dataset.sw !== current) switchTo(b.dataset.sw);
    ctx.closeSheet();
  };
  function switchTo(sid) { const sz = ctx.size(); ctx.send({ t: 'switch', sid, cols: sz.cols, rows: sz.rows }); }
  $('sessNew').onclick = () => { if (!ctx.live()) return toast('Connect first'); switchTo(ctx.newId()); ctx.closeSheet(); toast('New terminal'); };
  ctx.onPage('sessions', () => { refreshSessions(); ctx.send({ t: 'shares' }); });
  ctx.onSwitchRequest(switchTo); // from a notification tap

  // ---- share a view-only link ----
  let shareMins = 60, shareExp = 0;
  $('shareMins').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; shareMins = +b.dataset.v; $('shareMins').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
  $('shareBtn').onclick = () => {
    if (!ctx.live()) return toast('Connect first');
    ctx.send({ t: 'share', minutes: shareMins });
  };
  ctx.on('share', (m) => {
    if (!m.link) return;
    shareId = m.id; shareExp = m.expires; $('shareLink').value = m.link; $('shareBox').hidden = false; paintShareLeft();
    $('shareSend').hidden = !navigator.share;
  });
  ctx.on('shares', (m) => {
    const mine = (m.list || []).filter((s) => s.sid === current);
    if (!mine.length) { if (shareId && !(m.list || []).some((s) => s.id === shareId)) { shareId = null; $('shareBox').hidden = true; } return; }
    if (!shareId) { shareId = mine[0].id; shareExp = mine[0].expires; $('shareBox').hidden = false; $('shareLink').value = '(made earlier: stop it and share again to see the link)'; paintShareLeft(); }
  });
  function paintShareLeft() { const m = Math.max(0, Math.round((shareExp - Date.now()) / 60e3)); $('shareLeft').textContent = m >= 60 ? `${Math.round(m / 60)} h left` : `${m} min left`; }
  setInterval(() => { if (shareId) paintShareLeft(); }, 30e3);
  $('shareCopy').onclick = async () => { try { await navigator.clipboard.writeText($('shareLink').value); toast('Link copied'); } catch { $('shareLink').select(); toast('Select and copy the link'); } };
  $('shareSend').onclick = () => navigator.share({ title: 'Watch my terminal', text: 'Live, view only:', url: $('shareLink').value }).catch(() => {});
  $('shareStop').onclick = () => { if (shareId) ctx.send({ t: 'unshare', id: shareId }); shareId = null; $('shareBox').hidden = true; toast('Stopped sharing. The link no longer works.'); };

  // ================= Phone notifications =================
  const pushOk = () => 'PushManager' in window && 'serviceWorker' in navigator && 'Notification' in window;
  function paintPush() {
    const on = ctx.store.get('push') && pushOk() && Notification.permission === 'granted';
    $('pushBtn').textContent = on ? 'Test' : 'Turn on';
    $('pushInfo').textContent = on ? 'On. You get a note when a program finishes or needs your answer.'
      : ctx.isIOS && !ctx.standalone ? 'Open Pocket Terminal from your Home Screen to turn these on (iPhone needs that).'
        : !pushOk() ? "This browser can't show notifications. Use the ntfy app below instead."
          : 'When a program finishes or needs your answer.';
  }
  async function turnOnPush() {
    if (ctx.demo) return toast('The demo has no computer to send notifications. Pair yours to turn them on.');
    if (!pushOk()) return toast(ctx.isIOS ? 'Open the app from your Home Screen first (iPhone 16.4 or newer).' : "This browser can't do notifications.");
    if (!ctx.live()) return toast('Connect first, so your computer can save this phone’s address.');
    const key = ctx.pushKey(); if (!key) return toast('Update the program on your computer first (run the install line again).');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { paintPush(); return toast('Notifications are blocked. Allow them in the phone’s Settings for this app.'); }
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      const want = b64uToBytes(key);
      if (sub && sub.options && sub.options.applicationServerKey && !sameBytes(new Uint8Array(sub.options.applicationServerKey), want)) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
      const j = sub.toJSON();
      ctx.send({ t: 'push-sub', sub: { endpoint: j.endpoint, keys: j.keys } });
      ctx.store.set('push', j.endpoint);
    } catch (e) { toast('Could not turn on notifications: ' + (e.message || e)); }
    paintPush();
  }
  ctx.on('push-ok', (m) => { if (m.quiet) return; if (m.error) { ctx.store.del('push'); toast(m.error); } else if (!m.off) { toast('Notifications on ✅ Sending a test…'); ctx.send({ t: 'push-test' }); } paintPush(); });
  ctx.on('push-tested', (m) => toast(m.how === 'push' ? 'Test sent. It should pop up in a moment.' : m.how === 'ntfy' ? 'Sent to the ntfy app (phone notifications didn’t go through).' : 'Nothing went out. Check that notifications are allowed.'));
  ctx.on('hi', (m) => { // the computer may have forgotten this phone's address (re-installed): send it again quietly
    if (m.push && ctx.store.get('push') && pushOk() && Notification.permission === 'granted') {
      navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((sub) => { if (sub) { const j = sub.toJSON(); ctx.send({ t: 'push-sub', sub: { endpoint: j.endpoint, keys: j.keys }, quiet: true }); } }).catch(() => {});
    }
  });
  $('pushBtn').onclick = () => (ctx.store.get('push') && pushOk() && Notification.permission === 'granted' ? (ctx.live() ? ctx.send({ t: 'push-test' }) : toast('Connect first')) : turnOnPush());
  paintPush();

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
    if (xfer) return toast('Wait for the current transfer');
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

  // ================= Local websites =================
  function loadPorts() {
    if (!ctx.live()) { $('portList').innerHTML = '<div class="empty">Needs the live connection. Connect first.</div>'; return; }
    const id = ctx.newId();
    ctx.listen(id, (m) => {
      ctx.unlisten(id);
      if (m.error) { $('portList').innerHTML = `<div class="empty">${esc(m.error)}</div>`; return; }
      $('portList').innerHTML = m.list.length ? m.list.map((p) => `<button class="item portrow" type="button" data-port="${p.port}"><span class="pn">${p.port}</span><span class="body"><b>localhost:${p.port}</b><small>${esc(p.name || 'program')}</small></span></button>`).join('')
        : '<div class="empty">Nothing is listening right now. Start your dev server (npm run dev…) and come back.</div>';
    });
    ctx.send({ t: 'ports', id });
  }
  ctx.onPage('web', () => { $('webPort').value = ctx.store.get('lastPort', '') || ''; loadPorts(); });
  $('portList').onclick = (e) => { const b = e.target.closest('[data-port]'); if (b) openPreview(+b.dataset.port); };
  $('webForm').onsubmit = (e) => { e.preventDefault(); const p = parseInt($('webPort').value, 10); if (p > 0 && p < 65536) openPreview(p); else toast('Type a port number, like 3000'); };
  let pvPort = null;
  function openPreview(port, path = '/') {
    if (!ctx.live()) return toast('Connect first');
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return toast('Reload the app once (⋯ → Settings → Reload app), then try again.');
    ctx.store.set('lastPort', port); pvPort = port; ctx.closeSheet();
    $('pvUrl').textContent = `localhost:${port}${path === '/' ? '' : path}`;
    $('preview').hidden = false; $('preview').classList.add('loading');
    $('pvFrame').src = `preview/${port}${path}`;
  }
  $('pvFrame').onload = () => {
    $('preview').classList.remove('loading');
    try { const l = $('pvFrame').contentWindow.location; const p = l.pathname.replace(/^.*?\/preview\/\d+/, '') || '/'; $('pvUrl').textContent = `localhost:${pvPort}${p === '/' ? '' : p}${l.search}`; } catch {}
  };
  $('pvClose').onclick = () => { $('preview').hidden = true; $('pvFrame').src = 'about:blank'; pvPort = null; ctx.focus(); };
  $('pvReload').onclick = () => { $('preview').classList.add('loading'); try { $('pvFrame').contentWindow.location.reload(); } catch { $('pvFrame').src = $('pvFrame').src; } };
  $('pvBack').onclick = () => { try { $('pvFrame').contentWindow.history.back(); } catch {} };
  // The service worker forwards each request of the preview page here; we send it over the link.
  if (navigator.serviceWorker) navigator.serviceWorker.startMessages && navigator.serviceWorker.startMessages();
  navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', async (e) => {
    const d = e.data || {}, port = e.ports && e.ports[0];
    if (d.type === 'pt-open') return ctx.openSession(d.sid);
    if (d.type !== 'pt-http' || !port) return;
    if (!ctx.live()) return port.postMessage({ error: 'Not connected to your computer right now.' });
    const id = ctx.newId();
    const timer = setTimeout(() => { ctx.unlisten(id); port.postMessage({ error: 'Your computer took too long to answer.' }); }, 60e3);
    ctx.listen(id, (m) => {
      if (m.t === 'http-h') { clearTimeout(timer); if (m.error) { ctx.unlisten(id); return port.postMessage({ error: m.error }); } port.postMessage({ status: m.status, headers: m.headers }); return; }
      if (m.t === 'http-c') {
        if (m.error) { ctx.unlisten(id); return port.postMessage({ error: m.error, partial: true }); }
        const b = m.d ? b64ToBytes(m.d) : new Uint8Array(0);
        port.postMessage({ chunk: b, end: !!m.end }, [b.buffer]);
        if (m.end) ctx.unlisten(id);
      }
    });
    ctx.send({ t: 'http', id, port: d.port, method: d.method, path: d.path, headers: d.headers, body: d.body ? bytesToB64(new Uint8Array(d.body)) : undefined });
  });

  // ================= Voice =================
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  $('micBtn').onclick = () => {
    if (rec) { rec.stop(); return; }
    if (!SR) { $('askIn').focus(); return toast('Tap the 🎤 on your keyboard and say it.'); }
    try {
      rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1;
      $('micBtn').classList.add('on');
      rec.onresult = (ev) => { const r = ev.results[ev.results.length - 1]; $('askIn').value = r[0].transcript; $('askIn').dispatchEvent(new Event('input')); if (r.isFinal) rec.stop(); };
      rec.onerror = (ev) => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { $('askIn').focus(); toast('Voice is blocked here. Tap the 🎤 on your keyboard instead.'); } };
      rec.onend = () => { $('micBtn').classList.remove('on'); rec = null; if ($('askIn').value.trim()) ctx.ask(); };
      rec.start();
    } catch { $('micBtn').classList.remove('on'); rec = null; $('askIn').focus(); toast('Tap the 🎤 on your keyboard and say it.'); }
  };

  return { hideNeeds, refreshSessions };
}

function guessType(n) {
  const e = n.split('.').pop().toLowerCase();
  return ({ txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', zip: 'application/zip', sql: 'text/plain', log: 'text/plain', html: 'text/html', js: 'text/plain', py: 'text/plain' })[e] || 'application/octet-stream';
}
const b64uToBytes = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(s + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)); };
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
