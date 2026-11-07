// Pocket Terminal service worker.
//   1. Offline cache for the app's own files, so it opens instantly from the home screen.
//   2. Phone notifications: shows what your computer sends (end-to-end encrypted Web Push),
//      and a tap opens the terminal it's about. Questions get Yes/No buttons that answer
//      without opening the app (Android; iPhone shows the note without buttons).
//   3. Local websites: pages under preview/<port>/ come from your computer's localhost,
//      through the app's encrypted link (the app window does the talking).
// Bump VERSION on every release so phones pick up the new code.
const VERSION = 'pt-v7.3.2';
const FILES = ['./', 'index.html', 'js/app.js', 'js/tools.js', 'js/theme.js', 'js/crypto.js', 'js/board.js', 'js/helper.js', 'vendor/xterm.js', 'vendor/xterm.css', 'vendor/addon-fit.js', 'vendor/jsQR.js', 'manifest.json', 'icon.svg', 'icon.png', 'icon-192.png', 'icon-maskable.png', 'apple-touch-icon.png', 'css/app.css', 'fonts/ibm-plex-sans-latin-400-normal.woff2', 'fonts/ibm-plex-sans-latin-500-normal.woff2', 'fonts/ibm-plex-sans-latin-600-normal.woff2', 'fonts/jetbrains-mono-latin-400-normal.woff2', 'fonts/jetbrains-mono-latin-700-normal.woff2'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

const SCOPE = new URL(self.registration.scope);
const PRE = SCOPE.pathname + 'preview/';
const previewPort = (u) => { try { const m = new URL(u).pathname.match(/\/preview\/(\d+)(?:\/|$)/); return m && new URL(u).pathname.startsWith(PRE) ? +m[1] : null; } catch { return null; } };

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // never touch board traffic or other sites
  if (url.pathname === PRE + '__shim.js') return e.respondWith(new Response(SHIM, { headers: { 'Content-Type': 'text/javascript' } }));
  if (url.pathname.startsWith(PRE)) {
    const m = url.pathname.slice(PRE.length).match(/^(\d+)(\/.*)?$/);
    if (m) return e.respondWith(proxy(+m[1], (m[2] || '/') + url.search, e.request));
  }
  // A page inside the preview asked for "/assets/app.js": that's its own server's file, not ours.
  if (e.clientId) {
    return e.respondWith(self.clients.get(e.clientId).then((c) => {
      const port = c && previewPort(c.url);
      return port ? proxy(port, url.pathname + url.search, e.request) : own(e.request);
    }));
  }
  if (e.request.method === 'GET') e.respondWith(own(e.request));
});

// Network first (fresh code when online), cache when offline.
function own(req) {
  if (req.method !== 'GET') return fetch(req);
  return fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || new Response('Offline', { status: 503 })));
}

const page = (title, text) => new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px -apple-system,system-ui,sans-serif;padding:32px 24px;color:#333;background:#fff"><h2 style="margin:0 0 8px">${title}</h2><p style="color:#666">${text}</p>`,
  { status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

async function proxy(port, path, req) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const app = all.find((c) => !previewPort(c.url) && new URL(c.url).pathname.startsWith(SCOPE.pathname));
  if (!app) return page('Open Pocket Terminal first', 'Local websites open through the app’s connection to your computer.');
  const headers = {};
  req.headers.forEach((v, k) => { if (!/^(cookie|sec-|service-worker)/i.test(k)) headers[k] = v; });
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer();
  const ch = new MessageChannel();
  app.postMessage({ type: 'pt-http', port, path, method: req.method, headers, body }, body ? [ch.port2, body] : [ch.port2]);
  return new Promise((resolve) => {
    let ctrl = null, head = null, html = null;
    const timer = setTimeout(() => resolve(page('No answer', `Your computer didn't answer for localhost:${port}.`)), 65e3);
    ch.port1.onmessage = ({ data: d }) => {
      if (!head) {
        clearTimeout(timer);
        if (d.error) return resolve(page(`localhost:${port}`, d.error));
        head = d;
        const h = new Headers(d.headers || {});
        let status = d.status;
        if (h.has('location')) { const l = h.get('location'); if (l.startsWith('/')) h.set('location', `${PRE}${port}${l}`); }
        if (status < 200 || status > 599) status = 502;
        if (status === 204 || status === 304 || req.method === 'HEAD') return resolve(new Response(null, { status, headers: h }));
        // HTML gets a tiny helper so plain links like href="/about" stay inside the preview.
        if (/text\/html/i.test(h.get('content-type') || '')) { html = { h, status, parts: [] }; return; }
        resolve(new Response(new ReadableStream({ start: (c) => { ctrl = c; } }), { status, headers: h }));
        return;
      }
      if (html) {
        if (d.chunk) html.parts.push(d.chunk);
        if (d.end || d.error) {
          let text = new TextDecoder().decode(concat(html.parts));
          const tag = `<script src="${PRE}__shim.js" data-port="${port}"></script>`;
          text = /<head[^>]*>/i.test(text) ? text.replace(/<head[^>]*>/i, (m) => m + tag) : tag + text;
          resolve(new Response(text, { status: html.status, headers: html.h }));
        }
        return;
      }
      if (!ctrl) return;
      if (d.chunk && d.chunk.byteLength) ctrl.enqueue(new Uint8Array(d.chunk));
      if (d.error) ctrl.error(new Error(d.error)); else if (d.end) ctrl.close();
    };
  });
}
const concat = (parts) => { const n = parts.reduce((a, p) => a + p.byteLength, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(new Uint8Array(p), o); o += p.byteLength; } return out; };

// Runs inside the preview page. Full-page links and forms to "/somewhere" would leave the preview,
// so send them to /…/preview/<port>/somewhere instead. Single-page apps (which handle links
// themselves) are left alone.
// jsStr: a JS string literal that is also safe inside an HTML <script> (no '<', '>', '/' or line breaks).
const jsStr = (v) => JSON.stringify(String(v)).replace(/[<>\/\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const SHIM = `(function(){var s=document.currentScript,p=s&&s.dataset.port,pre=${jsStr(PRE)}+p;
function fix(u){try{var x=new URL(u,location.href);if(x.origin===location.origin&&x.pathname.indexOf(${jsStr(PRE)})!==0)return pre+x.pathname+x.search+x.hash;}catch(e){}return null}
addEventListener('click',function(e){if(e.defaultPrevented||e.button||e.metaKey||e.ctrlKey)return;var a=e.target.closest&&e.target.closest('a[href]');if(!a||a.target==='_blank'||a.hasAttribute('download'))return;var f=fix(a.getAttribute('href'));if(f){e.preventDefault();location.href=f}});
addEventListener('submit',function(e){if(e.defaultPrevented)return;var f=e.target,u=fix(f.getAttribute('action')||location.href);if(u&&f.getAttribute('action'))f.setAttribute('action',u)},true);})();`;

// ---------- phone notifications ----------
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Pocket Terminal', body: e.data && e.data.text() }; }
  const max = (self.Notification && Notification.maxActions) || 0;
  const acts = d.ans && Array.isArray(d.ans.acts) && max ? d.ans.acts.slice(0, max).map((a) => ({ action: String(a.action), title: String(a.title) })) : [];
  e.waitUntil(self.registration.showNotification(d.title || 'Pocket Terminal', {
    body: d.body || '', tag: d.tag || 'pt', renotify: true, icon: 'icon.png', badge: 'icon.png',
    data: { sid: d.sid || null, ans: acts.length ? d.ans : null, title: d.title || '' }, requireInteraction: d.kind === 'input', actions: acts,
  }));
});
// A Yes/No button was pressed: answer straight from here, the app doesn't need to open.
// The note is encrypted with the key that came inside the (end-to-end encrypted) notification
// and only works once; the board just sees an id and random bytes.
const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function sendAnswer(ans, choice) {
  const key = await crypto.subtle.importKey('raw', fromB64u(ans.k), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ a: choice, ts: Date.now() }))));
  const blob = new Uint8Array(iv.length + ct.length); blob.set(iv); blob.set(ct, iv.length);
  const r = await fetch(`${String(ans.b).replace(/\/+$/, '')}/${encodeURIComponent(ans.tp)}`, { method: 'POST', body: `pta1.${ans.id}.${b64u(blob)}` });
  if (!r.ok) throw new Error('board ' + r.status);
}
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  if (e.action && data.ans) {
    const label = ((data.ans.acts || []).find((a) => a.action === e.action) || {}).title || e.action;
    return e.waitUntil(sendAnswer(data.ans, e.action)
      .then(() => self.registration.showNotification(`Sent “${label}” ✓`, { body: data.title ? `Answered: ${data.title}` : 'Your computer gets it in a moment.', tag: 'pt-sent', silent: true, icon: 'icon.png', badge: 'icon.png' }))
      .catch(() => self.registration.showNotification('Could not send the answer', { body: 'Open the app and answer there.', tag: 'pt-sent', icon: 'icon.png', data: { sid: data.sid } })));
  }
  const sid = data.sid;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = all.find((c) => !previewPort(c.url));
    if (app) { if (sid) app.postMessage({ type: 'pt-open', sid }); return app.focus(); }
    return self.clients.openWindow(SCOPE.pathname + (sid ? '#s=' + encodeURIComponent(sid) : ''));
  })());
});
