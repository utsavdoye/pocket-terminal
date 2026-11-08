// Auto-approve (Settings): steps an AI agent asks about that match your safe words are allowed
// by the computer without asking you. Risky steps still ask.

export function setupAutoApprove(ctx) {
  const { $, toast } = ctx;

  // ================= Auto-approve =================
  let autoCfg = null;
  const DEFAULT_ALLOW = ['npm test', 'npm run test', 'pytest', 'go test', 'cargo test', 'git status', 'git diff', 'ls', 'cat ', 'Read(', 'Read file', 'Search(', 'Grep'];
  function paintAuto() {
    if (!autoCfg) { $('autoInfo').textContent = 'Connect to see it.'; return; }
    $('autoInfo').textContent = autoCfg.enabled ? `On · ${autoCfg.allow.length} safe words. Risky steps still ask you.` : 'Off. Every question asks you.';
    $('autoOn').checked = autoCfg.enabled; $('autoAllow').value = (autoCfg.allow || []).join('\n');
  }
  ctx.on('auto', (m) => { autoCfg = { enabled: !!m.enabled, allow: m.allow || [] }; paintAuto(); });
  ctx.onPage('settings', () => { if (ctx.live() && !ctx.viewer) ctx.send({ t: 'auto-get' }); paintAuto(); });
  $('autoSetup').onclick = () => { $('autoForm').hidden = !$('autoForm').hidden; if (ctx.live()) ctx.send({ t: 'auto-get' }); };
  $('autoReset').onclick = () => { $('autoAllow').value = DEFAULT_ALLOW.join('\n'); };
  $('autoForm').onsubmit = (e) => {
    e.preventDefault(); if (!ctx.live()) return toast('Connect first');
    const allow = $('autoAllow').value.split('\n').map((x) => x.trim()).filter(Boolean);
    ctx.send({ t: 'auto-set', cfg: { enabled: $('autoOn').checked, allow } });
    $('autoNote').textContent = 'Saved on your computer.'; toast($('autoOn').checked ? 'Auto-approve is on for safe steps' : 'Auto-approve is off');
  };
}
