// Auto-yes rules (Settings → AI agents): steps an AI agent asks about that show one of your
// "always yes" words, and none of your "always ask" words, are allowed by the computer without
// asking you. Passwords, sudo and rm -rf always ask, whatever the lists say.

export function setupAutoApprove(ctx) {
  const { $, toast } = ctx;

  let autoCfg = null;
  const DEFAULT_ALLOW = ['npm test', 'npm run test', 'pytest', 'go test', 'cargo test', 'git status', 'git diff', 'ls', 'cat ', 'Read(', 'Read file', 'Search(', 'Grep'];
  const DEFAULT_ASK = ['rm', 'rmdir', 'del', 'delete', 'remove', 'drop', 'truncate', 'force', 'push', 'deploy', 'publish', 'release', 'chmod', 'chown', 'kill', 'reset', 'revert', 'overwrite', 'format', 'mkfs', 'dd', 'curl', 'wget', 'install', 'uninstall', 'payment', 'secret', 'token', 'prod', 'production', 'migrat'];
  const lines = (id) => $(id).value.split('\n').map((x) => x.trim()).filter(Boolean);
  function paintAuto() {
    if (!autoCfg) { $('autoInfo').textContent = 'Connect to see it.'; return; }
    $('autoInfo').textContent = autoCfg.enabled ? `On · ${autoCfg.allow.length} always yes, ${autoCfg.ask.length} always ask.` : 'Off. Every question asks you.';
    $('autoOn').checked = autoCfg.enabled; $('autoAllow').value = (autoCfg.allow || []).join('\n'); $('autoAsk').value = (autoCfg.ask || []).join('\n');
  }
  ctx.on('auto', (m) => { autoCfg = { enabled: !!m.enabled, allow: m.allow || [], ask: Array.isArray(m.ask) ? m.ask : DEFAULT_ASK }; paintAuto(); });
  ctx.onPage('settings', () => { if (ctx.live() && !ctx.viewer) ctx.send({ t: 'auto-get' }); paintAuto(); });
  $('autoSetup').onclick = () => { $('autoForm').hidden = !$('autoForm').hidden; if (ctx.live()) ctx.send({ t: 'auto-get' }); };
  $('autoReset').onclick = () => { $('autoAllow').value = DEFAULT_ALLOW.join('\n'); $('autoAsk').value = DEFAULT_ASK.join('\n'); };
  $('autoForm').onsubmit = (e) => {
    e.preventDefault(); if (!ctx.live()) return toast('Connect first');
    const ask = lines('autoAsk');
    if ($('autoOn').checked && ask.length < 5 && !confirm('Your "always ask" list is almost empty, so most steps would be allowed without asking you. Save anyway?')) return;
    ctx.send({ t: 'auto-set', cfg: { enabled: $('autoOn').checked, allow: lines('autoAllow'), ask } });
    $('autoNote').textContent = 'Saved on your computer.'; toast($('autoOn').checked ? 'Auto-yes is on for safe steps' : 'Auto-yes is off');
  };
}
