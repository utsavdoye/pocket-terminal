// Tasks for your agents (dock → Tasks), run on the computer (agent/lib/tasks.js):
//   queue     "when this finishes, run the next one", an agent with a task or a plain command,
//             optionally in its own copy of the project (git worktree)
//   race      one task, 2 to 4 agents at once, each in its own copy; compare files changed, tests,
//             time; keep the winner (merged into your project), the rest are thrown away
//   hand-off  a chain: one agent writes, the next reviews, then tests; one notification at the end

import { setHTML } from '../core/dom.js';
export function setupWork(ctx, t) {
  const { $, esc, ago, toast, store } = ctx;
  let mode = 'queue', view = null, steps = ['claude', 'codex'], picked = new Set(store.get('racePick', ['claude', 'codex']));
  const NAMES = () => (view && view.names) || {};
  const nice = (a) => NAMES()[a] || a;
  const agents = () => Object.keys((view && view.agents) || { claude: 1, codex: 1, gemini: 1, opencode: 1, aider: 1 });
  const dur = (s) => (!s ? '' : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`);
  const DOT = { waiting: 's-idle', running: 's-work', blocked: 's-wait', done: 's-done', failed: 's-fail', cancelled: 's-idle' };
  const WORD = { waiting: 'waiting', running: 'working', blocked: 'blocked', done: 'done', failed: 'failed', cancelled: 'stopped' };

  // ---------- the form ----------
  const HINT = {
    queue: 'Runs one at a time, in order. Add three before bed and find them done in the morning.',
    race: 'The same task to several agents at once, each in its own copy of the project. Compare, then keep the best one.',
    chain: 'One agent works, the next one reviews its changes, then the tests run. One notification at the end.',
  };
  function paintForm() {
    const have = agents(); // only agents this computer knows (Agent commands)
    for (const a of [...picked]) if (!have.includes(a)) picked.delete(a);
    steps = steps.map((a, i) => (have.includes(a) ? a : have[i % have.length]));
    $('workSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === mode));
    $('workHint').textContent = HINT[mode];
    document.querySelectorAll('#workForm .wf-queue').forEach((e) => (e.hidden = mode !== 'queue'));
    document.querySelectorAll('#workForm .wf-race').forEach((e) => (e.hidden = mode !== 'race'));
    document.querySelectorAll('#workForm .wf-chain').forEach((e) => (e.hidden = mode !== 'chain'));
    document.querySelectorAll('#workForm .wf-test').forEach((e) => (e.hidden = mode === 'queue'));
    const cmd = mode === 'queue' && $('wAgent').value === '__cmd';
    $('wTextLbl').textContent = cmd ? 'Command' : 'Task';
    $('wText').placeholder = cmd ? 'npm run build && npm test' : 'add a dark mode toggle to the settings page';
    $('wText').style.fontFamily = cmd ? 'var(--mono)' : '';
    $('wGo').textContent = mode === 'queue' ? 'Add to queue' : mode === 'race' ? 'Start the race' : 'Start the hand-off';
    $('wCopy').closest('label').hidden = mode !== 'queue' || cmd;
    const opts = agents().map((a) => `<option value="${esc(a)}">${esc(nice(a))}</option>`).join('');
    const keep = $('wAgent').value;
    $('wAgent').innerHTML = opts + '<option value="__cmd">a command</option>';
    $('wAgent').value = keep && [...$('wAgent').options].some((o) => o.value === keep) ? keep : agents()[0];
    $('wRace').innerHTML = agents().map((a) => `<button type="button" class="pick${picked.has(a) ? ' on' : ''}" data-a="${esc(a)}">${esc(nice(a))}</button>`).join('');
    $('wSteps').innerHTML = steps.map((a, i) => `<li><select class="field-in plain" data-step="${i}">${agents().map((x) => `<option value="${esc(x)}"${x === a ? ' selected' : ''}>${esc(nice(x))}${i ? ' reviews' : ' writes'}</option>`).join('')}</select>${steps.length > 1 ? `<button type="button" class="x" data-rmstep="${i}" aria-label="Remove step ${i + 1}">✕</button>` : ''}</li>`).join('');
    $('wAddStep').hidden = steps.length >= 4;
  }
  $('workSeg').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; mode = b.dataset.v; $('wNote').textContent = ''; paintForm(); };
  $('wAgent').onchange = paintForm;
  $('wRace').onclick = (e) => { const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a; if (picked.has(a)) picked.delete(a); else if (picked.size < 4) picked.add(a); else toast('Up to 4 agents'); store.set('racePick', [...picked]); paintForm(); };
  $('wSteps').onchange = (e) => { const s = e.target.closest('[data-step]'); if (s) steps[+s.dataset.step] = s.value; };
  $('wSteps').onclick = (e) => { const b = e.target.closest('[data-rmstep]'); if (b) { steps.splice(+b.dataset.rmstep, 1); paintForm(); } };
  $('wAddStep').onclick = () => { steps.push(steps.length % 2 ? 'claude' : 'codex'); paintForm(); };

  // Folders: where your terminals are, and the ones you used here before.
  function folders() {
    const seen = new Set(); const out = [];
    const terms = t.sessions().filter((s) => !s.ask && !s.ext && s.cwd && s.cwd !== '~').map((s) => s.cwd); // real terminals' folders
    for (const f of [...store.get('folders', []), ...terms]) if (f && !seen.has(f)) { seen.add(f); out.push(f); }
    return out.slice(0, 12);
  }
  function paintFolders() {
    const list = folders();
    $('wFolders').innerHTML = list.map((f) => `<option value="${esc(f)}">`).join('');
    if (!$('wFolder').value) { const cur = t.sessions().find((s) => s.sid === t.current() && !s.ask && !s.ext); $('wFolder').value = (cur && cur.cwd && cur.cwd !== '~' ? cur.cwd : '') || list[0] || ''; }
  }
  const remember = (f) => store.set('folders', [f, ...store.get('folders', []).filter((x) => x !== f)].slice(0, 8));

  function call(msg, done) {
    if (!ctx.live()) { toast('Connect first'); return; }
    const id = ctx.newId();
    const late = setTimeout(() => { ctx.unlisten(id); $('wGo').disabled = false; if (msg.t !== 'tasks') toast('No answer from the computer. If it runs an older Pocket Terminal: npx pocket-terminal@latest'); else if (!view) $('workList').innerHTML = '<div class="empty">This computer runs an older Pocket Terminal. Update it: <code>npx pocket-terminal@latest</code></div>'; }, ['race', 'race-pick', 'task-push', 'wt-merge'].includes(msg.t) ? 120e3 : 20e3);
    ctx.listen(id, (m) => { clearTimeout(late); ctx.unlisten(id); if (m.agents) { const first = !view; view = m; paintList(); if (first) paintForm(); } done && done(m); });
    ctx.send({ ...msg, id });
  }
  $('workForm').onsubmit = (e) => {
    e.preventDefault();
    const cwd = $('wFolder').value.trim(), text = $('wText').value.trim(), test = $('wTest').value.trim();
    if (!cwd) { $('wFolder').focus(); return toast('Which folder? (the project)'); }
    if (!text) { $('wText').focus(); return toast(mode === 'queue' && $('wAgent').value === '__cmd' ? 'Type the command' : 'Write the task'); }
    let msg;
    if (mode === 'queue') msg = $('wAgent').value === '__cmd' ? { t: 'task-add', cwd, cmd: text } : { t: 'task-add', cwd, agent: $('wAgent').value, prompt: text, worktree: $('wCopy').checked };
    else if (mode === 'race') { if (picked.size < 2) return toast('Pick at least 2 agents'); msg = { t: 'race', cwd, prompt: text, agents: [...picked], test }; }
    else msg = { t: 'chain', cwd, prompt: text, steps: steps.map((a) => ({ agent: a })), test };
    $('wGo').disabled = true; $('wNote').textContent = mode === 'race' ? 'Making a copy of the project for each agent…' : '';
    call(msg, (m) => {
      $('wGo').disabled = false;
      if (m.error) { $('wNote').textContent = m.error; return toast(m.error.split('.')[0]); }
      $('wNote').textContent = ''; $('wText').value = ''; remember(cwd);
      toast(mode === 'queue' ? 'Added to the queue ✓' : mode === 'race' ? 'Race started ✓' : 'Hand-off started ✓'); navigator.vibrate && navigator.vibrate(10);
    });
  };

  // ---------- the list ----------
  const task = (id) => view.tasks.find((x) => x.id === id);
  const busy = new Set(); // lanes being merged right now (the list refreshes meanwhile)
  // After work was kept into the project: offer to push the project itself (its own branch, e.g.
  // main), never the agent's copy (that would put a pt/… branch on GitHub as a pull request).
  const offerPush = (m) => {
    if (m.note) alert(m.note);
    if (!m.root || !confirm('Merged into your project ✓\n\nPush your project now (git push)?')) return toast('Merged into your project ✓');
    toast('Pushing…');
    call({ t: 'task-push', root: m.root }, (p) => { if (p.error) alert(p.error); else toast(`Pushed ${p.branch || ''} ✓`.replace('  ', ' ')); });
  };
  function lane(x, g) {
    const ch = x.changes, tests = x.tests;
    const facts = [x.status === 'done' || x.status === 'failed' ? (ch ? `<span>${ch.files} file${ch.files === 1 ? '' : 's'} <i class="plus">+${ch.add}</i> <i class="minus">−${ch.del}</i></span>` : '') : '',
      tests ? `<span class="${tests.ok ? 'ok' : 'bad'}">tests ${tests.ok ? '✓' : '✗'}</span>` : g && g.test && g.status === 'testing' ? '<span>testing…</span>' : '',
      x.seconds ? `<span>${dur(x.seconds)}</span>` : ''].filter(Boolean).join('');
    const canKeep = g && g.kind === 'race' && g.status === 'compare' && x.status === 'done';
    const live = x.sid && ['running', 'blocked', 'done', 'failed'].includes(x.status) && !(x.wt && x.wt.removed) && !(g && ['picked', 'cancelled'].includes(g.status));
    const win = g && g.winner === x.id;
    return `<div class="lane${win ? ' win' : ''}">
      <div class="ln-top"><i class="st ${DOT[x.status]}"></i><b>${esc(x.title)}</b><span class="ln-st">${win ? 'kept ✓' : WORD[x.status]}</span></div>
      ${facts ? `<div class="ln-facts">${facts}</div>` : ''}
      ${x.why ? `<p class="ag-note">${esc(x.why)}</p>` : ''}${tests && !tests.ok && tests.last && tests.last.length ? `<code>${esc(tests.last.slice(-1)[0])}</code>` : ''}
      ${live || canKeep ? `<div class="ag-acts">${live ? `<button class="btn small ghost" data-open="${esc(x.sid)}" type="button">Open</button><button class="btn small ghost" data-changes="${esc(x.sid)}" type="button">Changes</button>` : ''}${canKeep ? (busy.has(x.id) ? '<button class="btn small" type="button" disabled>Merging…</button>' : `<button class="btn small${tests && !tests.ok ? ' ghost' : ''}" data-keep="${esc(g.id)}" data-lane="${esc(x.id)}" type="button"${busy.size ? ' disabled' : ''}>Keep this one</button>`) : ''}</div>` : ''}
    </div>`;
  }
  function paintList() {
    if (!view) { $('workList').innerHTML = '<div class="empty">Connect to see tasks.</div>'; return; }
    const out = [];
    const groups = [...view.groups].sort((a, b) => b.startedAt - a.startedAt);
    for (const g of groups) {
      const lanes = g.lanes.map(task).filter(Boolean);
      const live = ['running', 'testing', 'compare'].includes(g.status);
      const st = g.kind === 'race' ? { running: 'racing', testing: 'running tests', compare: 'pick the winner', picked: 'done', cancelled: 'stopped' }[g.status]
        : { running: `step ${(g.at || 0) + 1} of ${g.steps}`, done: 'done', failed: 'stopped', cancelled: 'stopped' }[g.status];
      out.push(`<div class="item wgroup g-${g.status}">
        <div class="ag-top"><i class="st ${g.status === 'compare' ? 's-wait' : live ? 's-work' : g.status === 'done' || g.status === 'picked' ? 's-done' : 's-idle'}"></i><span class="ag-name"><b>${g.kind === 'race' ? 'race' : 'hand-off'}</b><small>${esc(g.where)}</small></span><span class="ag-tag">${esc(st || g.status)}</span></div>
        <p class="ag-q">${esc(g.prompt)}</p>
        <div class="lanes">${lanes.map((x) => lane(x, g)).join('')}</div>
        ${live ? `<div class="ag-acts"><button class="btn small danger" data-cancel="${esc(g.id)}" type="button">Stop${g.kind === 'race' ? ' the race' : ''}</button>${g.status === 'compare' && g.test ? `<button class="btn small ghost" data-retest="${esc(g.id)}" type="button">Test again</button>` : ''}</div>` : ''}
      </div>`);
    }
    const q = view.tasks.filter((x) => x.kind === 'queue');
    if (q.length) {
      out.push(`<div class="sub">queue</div>`);
      for (const x of q) {
        const open = x.sid && ['running', 'blocked', 'done', 'failed'].includes(x.status) && !(x.wt && x.wt.removed);
        const bring = x.wt && !x.wt.removed && ['done', 'failed', 'cancelled'].includes(x.status);
        out.push(`<div class="item wtask">
          <div class="ag-top"><i class="st ${DOT[x.status]}"></i><span class="ag-name"><b>${esc(x.title)}</b><small>${esc(x.where)}${x.wt ? ` <span class="br">${esc(x.wt.branch)}</span>` : ''}</small></span><span class="ag-tag">${WORD[x.status]}${x.seconds ? ' · ' + dur(x.seconds) : ''}</span></div>
          ${x.why ? `<p class="ag-note">${esc(x.why)}</p>` : x.last && x.last.length && x.status !== 'waiting' && x.status !== 'running' ? `<code>${esc(x.last.slice(-1)[0])}</code>` : ''}
          ${x.merged ? '<p class="ag-note">Brought into the project ✓</p>' : ''}
          <div class="ag-acts">${open ? `<button class="btn small ghost" data-open="${esc(x.sid)}" type="button">Open</button>` : ''}${bring ? `<button class="btn small" data-wtmerge="${esc(x.id)}" type="button">Bring it in</button><button class="btn small ghost" data-wtdrop="${esc(x.id)}" type="button">Throw away</button>` : ''}${['waiting', 'running', 'blocked'].includes(x.status) ? `<button class="x" data-cancel="${esc(x.id)}" type="button" aria-label="Stop">✕</button>` : ''}</div>
        </div>`);
      }
    }
    setHTML($('workList'), out.join('') || '<div class="empty">Nothing yet. Add a task above.</div>');
    const n = view.groups.filter((g) => g.status === 'compare').length + view.tasks.filter((x) => x.status === 'blocked').length;
    $('workBadge').hidden = !n; $('workBadge').textContent = n || ''; $('workCount').textContent = n || '';
    if (mode && !$('wAgent').options.length) paintForm();
  }
  $('workList').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.open) { t.switchTo(d.open); ctx.closeSheet(); return; }
    if (d.changes) return t.openDiff(d.changes);
    if (d.keep) {
      const x = task(d.lane); if (!confirm(`Keep ${x ? x.title : 'this one'}'s work? It is merged into your project and the other copies are thrown away.`)) return;
      busy.add(d.lane); paintList();
      return call({ t: 'race-pick', gid: d.keep, lane: d.lane }, (m) => { busy.delete(d.lane); paintList(); if (m.error) { toast(m.error.split('.')[0]); alert(m.error); } else offerPush(m); });
    }
    if (d.retest) return call({ t: 'race-test', gid: d.retest }, (m) => toast(m.error || 'Running the tests again…'));
    if (d.cancel) { if (!confirm('Stop it?')) return; return call({ t: 'task-cancel', tid: d.cancel }, (m) => toast(m.error || 'Stopped')); }
    if (d.wtmerge) return call({ t: 'wt-merge', tid: d.wtmerge }, (m) => { if (m.error) alert(m.error); else offerPush(m); });
    if (d.wtdrop) { if (!confirm('Throw its changes away?')) return; return call({ t: 'wt-discard', tid: d.wtdrop }, (m) => toast(m.error || 'Thrown away')); }
  };
  $('wClear').onclick = () => call({ t: 'task-clear' }, () => toast('Cleared'));
  // ---- how each agent starts ----
  $('wAgents').onclick = () => {
    $('wAgentsForm').hidden = !$('wAgentsForm').hidden;
    if (view) $('wAgentsText').value = Object.entries(view.agents).map(([k, v]) => `${k} = ${v}`).join('\n');
  };
  $('wAgentsReset').onclick = () => call({ t: 'task-cfg', agents: {} }, (m) => { $('wAgentsText').value = Object.entries(m.agents).map(([k, v]) => `${k} = ${v}`).join('\n'); paintForm(); toast('Back to the defaults'); });
  $('wAgentsForm').onsubmit = (e) => {
    e.preventDefault();
    const agentsCfg = {};
    for (const l of $('wAgentsText').value.split('\n')) { const m = /^\s*([\w-]{1,30})\s*=\s*(.+?)\s*$/.exec(l); if (m) agentsCfg[m[1]] = m[2]; }
    if (!Object.keys(agentsCfg).length) return toast('Write them as  name = command {q}');
    call({ t: 'task-cfg', agents: agentsCfg }, (m) => { if (m.error) return toast(m.error); toast('Saved on your computer'); $('wAgentsForm').hidden = true; paintForm(); });
  };

  const refresh = () => { if (ctx.live()) call({ t: 'tasks' }); };
  ctx.onPage('work', () => { paintFolders(); paintForm(); refresh(); });
  setInterval(() => { if (ctx.pageOpen('work') && document.visibilityState === 'visible') refresh(); }, 3000);
  ctx.on('hi', () => setTimeout(refresh, 800));
  ctx.on('alert', (m) => { if (m.kind === 'task') { toast(String(m.title || 'Tasks')); refresh(); } });
  paintForm();
}
