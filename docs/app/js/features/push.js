// Phone notifications straight from the computer (Web Push): turn them on, send a test, and
// quietly give the computer this phone's address again if it forgot it.

import { b64uToBytes, sameBytes } from '../core/bytes.js';

export function setupPush(ctx) {
  const { $, toast } = ctx;

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
      // A phone can take notifications from one computer's key at a time: after switching
      // computers, subscribe again with this one's key (notifications follow the one you use).
      navigator.serviceWorker.ready.then(async (r) => {
        let sub = await r.pushManager.getSubscription();
        const want = b64uToBytes(m.push), have = sub && sub.options && sub.options.applicationServerKey;
        if (sub && have && !sameBytes(new Uint8Array(have), want)) { await sub.unsubscribe(); sub = null; }
        if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
        const j = sub.toJSON(); ctx.store.set('push', j.endpoint);
        ctx.send({ t: 'push-sub', sub: { endpoint: j.endpoint, keys: j.keys }, quiet: true });
      }).catch(() => {});
    }
  });
  $('pushBtn').onclick = () => (ctx.store.get('push') && pushOk() && Notification.permission === 'granted' ? (ctx.live() ? ctx.send({ t: 'push-test' }) : toast('Connect first')) : turnOnPush());
  paintPush();
}
