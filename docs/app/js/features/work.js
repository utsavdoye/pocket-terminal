// Tasks for your agents (dock → Tasks), run on the computer (agent/lib/tasks.js):
//   queue     "when this finishes, run the next one", an agent with a task or a plain command,
//             optionally in its own copy of the project (git worktree)
//   race      one task, 2 to 4 agents at once, each in its own copy; compare files changed, tests,
//             time; keep the winner (merged into your project), the rest are thrown away
//   hand-off  a chain: one agent writes, the next reviews, then tests; one notification at the end
// and work that starts by itself (agent/lib/plans.js): schedules with their log, the morning
// summary, recipes (a saved way of working as one button; shared as a link), GitHub issues.

import { setHTML } from '../core/dom.js';
export function setupWork(ctx, t) {
  const { $, esc, ago, toast, store } = ctx;
  let mode = 'queue', view = null, steps = ['claude', 'codex'], picked = new Set(store.get('racePick', ['claude', 'codex']));
  const NAMES = () => (view && view.names) || {};
  const nice = (a) => NAMES()[a] || a;
  const agents = () => Object.keys((view && view.agents) || { claude: 1, codex: 1, gemini: 1, opencode: 1, aider: 1 });
  const dur = (s) => (!s ? '' : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`);
  // tokens the agent used and about what they cost at API prices (from the agent's own log)
  const cost = (c) => (!c ? '' : `<span class="cost" title="${esc(c.model || '')}">${c.usd != null ? `about $${c.usd < 0.01 ? c.usd.toFixed(4) : c.usd.toFixed(2)}` : `${c.tokens >= 1e6 ? (c.tokens / 1e6).toFixed(1) + 'M' : Math.max(1, Math.round(c.tokens / 1000)) + 'k'} tokens`}</span>`);
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
    const late = setTimeout(() => { ctx.unlisten(id); $('wGo').disabled = false; if (msg.t === 'plans') return; if (msg.t !== 'tasks') toast('No answer from the computer. If it runs an older Pocket Terminal: npx pocket-terminal@latest'); else if (!view) $('workList').innerHTML = '<div class="empty">This computer runs an older Pocket Terminal. Update it: <code>npx pocket-terminal@latest</code></div>'; }, ['race', 'race-pick', 'task-push', 'wt-merge', 'gh-check', 'gh-save'].includes(msg.t) ? 120e3 : 20e3);
    ctx.listen(id, (m) => { clearTimeout(late); ctx.unlisten(id); if (m.agents) { const first = !view; view = m; paintList(); if (first) paintForm(); } if (m.t === 'plans' && m.schedules) { plans = m; paintPlans(); } done && done(m); });
    ctx.send({ ...msg, id });
  }
  // The form as "what to run", for a schedule or a recipe. needText: the task and folder must be there.
  function formWhat(needText) {
    const cwd = $('wFolder').value.trim(), text = $('wText').value.trim(), test = $('wTest').value.trim();
    const cmd = mode === 'queue' && $('wAgent').value === '__cmd';
    if (needText && !cwd) { $('wFolder').focus(); toast('Which folder? (the project)'); return null; }
    if ((needText || cmd) && !text) { $('wText').focus(); toast(cmd ? 'Type the command' : 'Write the task'); return null; }
    if (mode === 'queue') return cmd ? { kind: 'task', cwd, cmd: text } : { kind: 'task', cwd, agent: $('wAgent').value, prompt: text, worktree: $('wCopy').checked };
    if (mode === 'race') { if (picked.size < 2) { toast('Pick at least 2 agents'); return null; } return { kind: 'race', cwd, prompt: text, agents: [...picked], test }; }
    return { kind: 'chain', cwd, prompt: text, steps: steps.map((a) => ({ agent: a })), test };
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
      x.seconds ? `<span>${dur(x.seconds)}</span>` : '', cost(x.cost)].filter(Boolean).join('');
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
          ${x.cost ? `<div class="ln-facts">${cost(x.cost)}</div>` : ''}
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

  // ---------- recipes: a saved way of working, as one button ----------
  let plans = null;
  const b64 = { to: (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), from: (t) => JSON.parse(decodeURIComponent(escape(atob(String(t).replace(/-/g, '+').replace(/_/g, '/'))))) };
  // Every line of what a recipe would run, for the "add it?" question: a recipe from someone else
  // can hold a command (its tests, or a command task), so you see all of it before it is saved.
  function describe(w) {
    const out = [];
    if (w.kind === 'race') out.push(`Race: ${(w.agents || []).map(nice).join(' vs ')}`);
    else if (w.kind === 'chain') out.push(`Hand-off: ${(w.steps || []).map((x) => nice(x.agent)).join(' → ')}`);
    else out.push(w.cmd ? `Runs this command: ${w.cmd}` : `Agent: ${nice(w.agent)}${w.worktree ? ' (in its own copy)' : ''}`);
    for (const x of w.steps || []) if (x.ask) out.push(`${nice(x.agent)} is told: ${x.ask}`);
    if (w.prompt) out.push(`Task: ${w.prompt}`);
    if (w.test) out.push(`Runs this command as tests: ${w.test}`);
    return out.join('\n');
  }
  function useRecipe(r) {
    const w = r.what; mode = w.kind === 'task' ? 'queue' : w.kind;
    if (w.kind === 'race') { picked = new Set(w.agents); store.set('racePick', [...picked]); }
    if (w.kind === 'chain') steps = w.steps.map((x) => x.agent);
    paintForm();
    if (w.kind === 'task') { $('wAgent').value = w.cmd ? '__cmd' : w.agent; $('wCopy').checked = !!w.worktree; paintForm(); }
    $('wTest').value = w.test || '';
    if (w.cmd || w.prompt) $('wText').value = w.cmd || w.prompt;
    $('wText').focus(); toast(`${r.name}: write the task, then start`);
  }
  function addShared(code) {
    let r; try { r = b64.from(String(code).replace(/^.*[#&]recipe=/, '').trim()); } catch { return toast('That is not a recipe link'); }
    if (!r || typeof r.n !== 'string' || !r.w || typeof r.w !== 'object') return toast('That is not a recipe link');
    if (!confirm(`Add the recipe "${r.n.slice(0, 60)}"?\n\n${describe(r.w)}\n\nOnly add recipes from people you trust: the commands above would run on your computer when you use it.`)) return;
    call({ t: 'recipe-save', name: r.n, what: r.w }, (m) => toast(m.error || 'Recipe added ✓'));
  }
  $('wSaveRecipe').onclick = () => {
    const w = formWhat(false); if (!w) return;
    const name = (prompt('Name this recipe (the agents, steps and tests are saved; the folder is not)', w.kind === 'chain' ? steps.map(nice).join(' → ') : w.kind === 'race' ? [...picked].map(nice).join(' vs ') : '') || '').trim();
    if (!name) return;
    if (!w.cmd && w.prompt && !confirm('Save the task text with it too?\n\nOK: yes, it is always this task.\nCancel: no, I write the task each time.')) w.prompt = '';
    call({ t: 'recipe-save', name, what: w }, (m) => toast(m.error || 'Saved as a recipe ✓'));
  };
  $('wRecipes').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b || !plans) return;
    if ('paste' in b.dataset) { const t = prompt('Paste a recipe link'); if (t) addShared(t); return; }
    const r = plans.recipes.find((x) => x.id === b.dataset.r); if (!r) return;
    if (b.dataset.act === 'x') { if (confirm(`Remove the recipe "${r.name}"?`)) call({ t: 'recipe-del', rid: r.id }); return; }
    if (b.dataset.act === 'share') {
      const { cwd, ...w } = r.what; const url = `${location.origin}${location.pathname}#recipe=${b64.to({ n: r.name, w })}`;
      try { if (navigator.share) await navigator.share({ title: `Pocket Terminal recipe: ${r.name}`, url }); else { await navigator.clipboard.writeText(url); toast('Link copied'); } } catch { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link', url); } }
      return;
    }
    if (picking === r.id) { picking = null; paintPlans(); return useRecipe(r); }
    picking = r.id; paintPlans();
  };
  let picking = null; // the recipe whose buttons (use, share, remove) are open

  // ---------- schedules ----------
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const schedDays = new Set(); let openLog = null;
  const paintDays = () => { $('wSchedDays').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" class="pick${schedDays.has(d) ? ' on' : ''}" data-d="${d}">${DAYS[d]}</button>`).join(''); };
  $('wSchedDays').onclick = (e) => { const b = e.target.closest('[data-d]'); if (!b) return; const d = +b.dataset.d; if (schedDays.has(d)) schedDays.delete(d); else schedDays.add(d); paintDays(); };
  $('wSchedOpen').onclick = () => { $('wSched').hidden = !$('wSched').hidden; paintDays(); if (!$('wSched').hidden) $('wSched').scrollIntoView({ block: 'nearest' }); };
  $('wSchedCancel').onclick = () => { $('wSched').hidden = true; };
  $('wSchedSave').onclick = () => {
    const w = formWhat(true); if (!w) return;
    const at = $('wSchedAt').value; if (!/^\d\d:\d\d$/.test(at)) return toast('Pick a time');
    call({ t: 'sched-save', name: $('wSchedName').value.trim(), at, days: [...schedDays], what: w }, (m) => {
      if (m.error) return toast(m.error);
      remember(w.cwd); $('wSched').hidden = true; $('wSchedName').value = ''; $('wText').value = ''; toast(`Saved. Runs at ${at}${schedDays.size ? ' on ' + [...schedDays].sort().map((d) => DAYS[d]).join(', ') : ' every day'}.`);
    });
  };
  const when = (ts) => { const d = new Date(ts); return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`; };
  function paintPlans() {
    if (!plans) return;
    $('wRecipes').hidden = false;
    setHTML($('wRecipes'), plans.recipes.map((r) => (picking === r.id
      ? `<button type="button" class="pick on" data-r="${esc(r.id)}">Use “${esc(r.name)}”</button><button type="button" class="pick" data-r="${esc(r.id)}" data-act="share">Share</button><button type="button" class="pick" data-r="${esc(r.id)}" data-act="x">Remove</button>`
      : `<button type="button" class="pick" data-r="${esc(r.id)}">${esc(r.name)}<small>${esc(r.label)}</small></button>`)).join('') + `<button type="button" class="pick" data-paste>${plans.recipes.length ? '+ from a link' : '+ Add a recipe from a link'}</button>`);
    setHTML($('schedList'), plans.schedules.map((x) => {
      const last = x.log[x.log.length - 1];
      const cls = (l) => (/done|started|ready/.test(l.status) ? 'ok' : /missed|could not|failed|stopped/.test(l.status) ? 'bad' : '');
      return `<div class="item wtask">
        <div class="ag-top"><i class="st ${x.on ? 's-work' : 's-idle'}"></i><span class="ag-name"><b>${esc(x.name)}</b><small>${esc(x.at)} · ${x.days.length ? x.days.map((d) => DAYS[d]).join(', ') : 'every day'} · ${esc(x.label)} · ${esc(x.what.cwd)}</small></span><span class="ag-tag">${x.on ? 'on' : 'off'}</span></div>
        ${last ? `<p class="ag-note">Last: ${esc(last.status)} · ${esc(when(last.at))}</p>` : '<p class="ag-note">Has not run yet.</p>'}
        ${openLog === x.id ? `<ul class="plog">${x.log.length ? [...x.log].reverse().map((l) => `<li><b>${esc(when(l.at))}</b> <span class="${cls(l)}">${esc(l.status)}</span>${l.text ? '\n' + esc(l.text) : ''}</li>`).join('') : '<li>Nothing yet.</li>'}</ul>` : ''}
        <div class="ag-acts"><button class="btn small ghost" data-slog="${esc(x.id)}" type="button">${openLog === x.id ? 'Hide log' : 'Log'}</button><button class="btn small ghost" data-srun="${esc(x.id)}" type="button">Run now</button><button class="btn small ghost" data-stoggle="${esc(x.id)}" type="button">${x.on ? 'Turn off' : 'Turn on'}</button><button class="x" data-sdel="${esc(x.id)}" type="button" aria-label="Remove">✕</button></div>
      </div>`;
    }).join('') || '<div class="empty">None yet. Fill in a task above, then tap “Run it on a schedule”.</div>');
    if (document.activeElement !== $('mornAt')) $('mornAt').value = plans.morning.at; $('mornOn').checked = plans.morning.on;
    setHTML($('ghList'), plans.github.map((w) => `<div class="item wtask">
        <div class="ag-top"><i class="st ${w.on ? 's-work' : 's-idle'}"></i><span class="ag-name"><b>${esc(w.where)}</b><small>label “${esc(w.label)}” · ${w.agents.map((a) => esc(nice(a))).join(w.agents.length > 1 ? ' vs ' : '')}${w.test ? ` · ${esc(w.test)}` : ''}</small></span><span class="ag-tag">${w.on ? 'on' : 'off'}</span></div>
        ${w.note ? `<p class="ag-note">${esc(w.note)}</p>` : ''}
        <div class="ag-acts"><button class="btn small ghost" data-gcheck="${esc(w.id)}" type="button">Check now</button><button class="x" data-gdel="${esc(w.id)}" type="button" aria-label="Remove">✕</button></div>
      </div>`).join(''));
  }
  $('schedList').onclick = (e) => {
    const b = e.target.closest('button'); if (!b || !plans) return; const d = b.dataset;
    if (d.slog) { openLog = openLog === d.slog ? null : d.slog; return paintPlans(); }
    if (d.srun) return call({ t: 'sched-run', pid: d.srun }, (m) => { toast(m.error || 'Started ✓'); refresh(); });
    if (d.sdel) { if (confirm('Remove this schedule?')) call({ t: 'sched-del', pid: d.sdel }); return; }
    if (d.stoggle) { const x = plans.schedules.find((y) => y.id === d.stoggle); if (x) call({ t: 'sched-save', pid: x.id, name: x.name, at: x.at, days: x.days, what: x.what, on: !x.on }, (m) => toast(m.error || (x.on ? 'Turned off' : 'Turned on'))); }
  };
  // ---------- the morning summary ----------
  const setMorning = () => call({ t: 'morning-set', on: $('mornOn').checked, at: $('mornAt').value }, (m) => toast(m.error || ($('mornOn').checked ? `Morning summary at ${$('mornAt').value}` : 'Morning summary off')));
  $('mornOn').onchange = setMorning; $('mornAt').onchange = () => { if ($('mornOn').checked) setMorning(); };
  $('mornNow').onclick = () => call({ t: 'morning-now' }, (m) => toast(m.error || 'Sent to your notifications'));
  // ---------- GitHub issues ----------
  const ghPicked = new Set();
  const paintGhAgents = () => { $('ghAgents').innerHTML = agents().map((a) => `<button type="button" class="pick${ghPicked.has(a) ? ' on' : ''}" data-a="${esc(a)}">${esc(nice(a))}</button>`).join(''); };
  $('ghAgents').onclick = (e) => { const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a; if (ghPicked.has(a)) ghPicked.delete(a); else if (ghPicked.size < 4) ghPicked.add(a); else toast('Up to 4 agents'); paintGhAgents(); };
  $('ghAdd').onclick = () => { $('ghForm').hidden = !$('ghForm').hidden; if (!ghPicked.size) for (const a of picked) ghPicked.add(a); if (!$('ghFolder').value) $('ghFolder').value = $('wFolder').value; paintGhAgents(); };
  $('ghCancel').onclick = () => { $('ghForm').hidden = true; };
  $('ghForm').onsubmit = (e) => {
    e.preventDefault(); $('ghNote').textContent = 'Checking the project…';
    call({ t: 'gh-save', cwd: $('ghFolder').value.trim(), label: $('ghLabel').value.trim(), agents: [...ghPicked], test: $('ghTest').value.trim() }, (m) => {
      $('ghNote').textContent = m.error || ''; if (m.error) return toast(m.error.split('.')[0]);
      $('ghForm').hidden = true; toast('Saved. Label an issue you wrote, and it starts.');
    });
  };
  $('ghList').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.gcheck) { toast('Asking GitHub…'); return call({ t: 'gh-check', gid: d.gcheck }, (m) => { if (m.error) toast(m.error); refresh(); }); }
    if (d.gdel && confirm('Stop watching this project\'s issues?')) call({ t: 'gh-del', gid: d.gdel });
  };
  ctx.on('plans', (m) => { if (m.schedules && !m.id) { plans = m; paintPlans(); } }); // the computer finished a check by itself

  const refreshPlans = () => { if (ctx.live()) call({ t: 'plans' }, () => { let code = null; try { code = localStorage.getItem('pt-recipe-in'); localStorage.removeItem('pt-recipe-in'); } catch {} if (code) addShared(code); }); };
  const refresh = () => { if (ctx.live()) call({ t: 'tasks' }); };
  ctx.onPage('work', () => { paintFolders(); paintForm(); refresh(); refreshPlans(); });
  setInterval(() => { if (ctx.pageOpen('work') && document.visibilityState === 'visible') refresh(); }, 3000);
  ctx.on('hi', () => setTimeout(refresh, 800));
  ctx.on('alert', (m) => { if (m.kind === 'task') { toast(String(m.title || 'Tasks')); refresh(); if (ctx.pageOpen('work')) refreshPlans(); } });
  paintForm();
}
