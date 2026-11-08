// Local websites: open the computer's localhost:3000 (or any port) here. The service worker
// hands each request of the preview page to this window, which sends it over the encrypted link.
// It also passes on notification taps that should open a terminal.

import { b64ToBytes, bytesToB64 } from '../core/bytes.js';

export function setupWebsites(ctx) {
  const { $, esc, toast } = ctx;

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
}
