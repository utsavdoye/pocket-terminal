// Settings: try the direct link again, the ntfy topic, lock now, reload the app, unpair, and
// light/dark/auto. In the demo, Lock and Unpair just leave the demo.

import { $, toast } from '../core/dom.js';
import { store } from '../core/store.js';
import { removeComputer, forgetSession } from '../core/computers.js';
import { APP_VERSION, DEMO } from '../core/env.js';
import { state } from '../core/state.js';
import { connect } from '../connection/link.js';
import { closeSheet } from '../ui/sheet.js';

export function setupSettings() {
  $('retryDirect').onclick = () => { state.lastAttempt = 0; connect(); closeSheet(); };
  $('copyTopic').onclick = async () => { try { await navigator.clipboard.writeText(state.S.notifyTopic); toast('Copied. Paste it in the ntfy app → Subscribe.'); } catch { toast(state.S.notifyTopic); } };
  $('lockNow').onclick = async () => { await forgetSession(state.S.topic); location.reload(); };
  if ($('unpairName')) $('unpairName').textContent = state.S.name || 'this computer';
  $('appVer').textContent = 'v' + APP_VERSION + ' · checks for updates when you reload';
  $('reloadApp').onclick = async () => {
    $('reloadApp').textContent = 'Updating…';
    try { const r = await navigator.serviceWorker?.getRegistration(); await r?.update(); } catch {}
    try { for (const k of await caches.keys()) await caches.delete(k); } catch {}
    location.reload();
  };
  $('unpair').onclick = async () => { if (!confirm(`Remove the pairing key for ${state.S.name} from this phone?`)) return; await removeComputer(state.S.topic); location.reload(); };
  const paintTheme = () => document.querySelectorAll('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === window.ptTheme.pick()));
  document.querySelectorAll('#themeSeg button').forEach((b) => (b.onclick = () => { store.set('theme', b.dataset.v); window.ptTheme.apply(); paintTheme(); }));
  paintTheme();
  if (DEMO) {
    const leave = () => { location.replace(location.pathname); };
    $('lockNow').onclick = $('unpair').onclick = leave;
    $('unpair').textContent = 'Leave demo'; $('lockNow').textContent = 'Leave';
  }
}
