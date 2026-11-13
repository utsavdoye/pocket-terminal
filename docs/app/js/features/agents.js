// Agents & terminals: a dashboard of every terminal on the computer (who needs you, what's
// working, what finished), the live strip over the terminal, switching and closing terminals,
// and the "See changes" diff of what an agent changed.

export function setupAgents(ctx, t) {
  const { $, esc, ago, toast } = ctx;
  const { answerBtns, openSay, hideNeeds } = t;

  // ================= Terminals =================
  let sessions = [], current = null, sessBtns = {};
  const NAMES = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', aider: 'Aider', opencode: 'OpenCode', 'cursor-agent': 'Cursor', amp: 'Amp', goose: 'Goose', qwen: 'Qwen Code', npm: 'npm', pnpm: 'pnpm', yarn: 'yarn' };
  const nice = (p) => NAMES[p] || (p ? p[0].toUpperCase() + p.slice(1) : '');
  const label = (s) => s.ext ? nice(s.agent) : s.program ? nice(s.program) : s.running ? 'Shell' : 'Not started';
  const dur = (ms) => { const sec = Math.max(1, Math.round(ms / 1000)); return sec < 60 ? `${sec} s` : sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)} h`; };
  // What it is doing, in one word. The computer says it (state: blocked / working / idle);
  // older computers don't, so then it's worked out here as before.
  const stateOf = (s) => {
    if (s.waiting) return 'wait';
    if (s.state === 'working' || (s.ext && s.busy)) return 'work';
    if (s.state === 'idle') return s.program ? 'run' : s.done ? 'done' : 'idle';
    return s.busy && s.lastOut && Date.now() - s.lastOut < 60e3 ? 'work' : s.program ? 'run' : s.done ? 'done' : 'idle';
  };
  const WORD = { wait: 'blocked', work: 'working', run: 'idle', done: 'done', idle: 'idle' };
  const ORDER = { wait: 0, work: 1, run: 2, done: 3, idle: 4 };
  const branch = (g) => !g || !g.branch ? '' : `<span class="br">${esc(g.branch)}${g.ahead ? ` <i class="up">↑${g.ahead}</i>` : ''}${g.behind ? ` <i class="dn">↓${g.behind}</i>` : ''}${g.dirty ? ` <i class="dt">●${g.dirty}</i>` : ''}</span>`;
  let watchFor = null; // the card whose "tell me when…" box is open
  function paintSessions() {
    const waiting = sessions.filter((s) => s.waiting && s.sid !== current).length;
    $('sessCount').textContent = waiting || '';
    const n = { wait: 0, work: 0, idle: 0 }; for (const s of sessions) { const k = stateOf(s); if (k === 'wait' || k === 'work') n[k]++; else n.idle++; }
    $('agSum').innerHTML = sessions.length ? `<span class="${n.wait ? 'hot' : ''}"><i class="st s-wait"></i><b>${n.wait}</b> blocked</span><span><i class="st s-work"></i><b>${n.work}</b> working</span><span><i class="st s-idle"></i><b>${n.idle}</b> idle</span>` : '';
    sessBtns = {};
    const list = [...sessions].sort((a, b) => ORDER[stateOf(a)] - ORDER[stateOf(b)] || a.created - b.created);
    $('sessList').innerHTML = list.length ? list.map((s) => {
      const st = stateOf(s), cur = s.sid === current, others = s.viewers - (cur ? 1 : 0);
      const when = st === 'wait' ? (s.askedAt ? dur(Date.now() - s.askedAt) : '')
        : st === 'work' ? (s.since ? dur(Date.now() - s.since) : '')
          : st === 'run' ? (s.lastOut ? `quiet ${dur(Date.now() - s.lastOut)}` : '')
            : st === 'done' ? ago(s.done.at) : '';
      const tag = `${st === 'wait' && s.ask ? 'asks' : WORD[st]}${when ? ' · ' + when : ''}`;
      const title = st === 'done' && !s.program ? nice(s.done.program) : label(s);
      let body = '';
      if (st === 'wait') {
        const btns = (sessBtns[s.sid] = answerBtns(s.question, s.menu, s.ask).filter(([l]) => !['Enter', 'Esc', '^C'].includes(l))); // the dashboard keeps it short
        body = `<p class="ag-q">${esc(s.question || 'It is waiting for your answer.')}</p><div class="needs-btns ag-btns">${btns.map(([l, d, c], i) => d ? `<button type="button" data-ans="${esc(s.sid)}" data-i="${i}"${c ? ` class="${c}"` : ''}>${esc(l)}</button>` : '').join('')}</div>`;
      } else if (st === 'done') {
        const ch = s.done.changes;
        body = `<p class="ag-note">ran ${dur(s.done.seconds * 1000)}${ch && ch.files ? ` · <b>${ch.files} file${ch.files === 1 ? '' : 's'}</b> <span class="plus">+${ch.add}</span> <span class="minus">−${ch.del}</span>` : ''}</p>`;
      }
      else if (s.line) body = `<code>${esc(s.line)}</code>`;
      else if (s.ext && st === 'work') body = '<p class="ag-note">Working outside Pocket Terminal (its own window or VS Code). Its questions come here.</p>';
      const term = !s.ask && !s.ext; // a real terminal you can open
      const w = (s.watches || []).map((x) => `<span class="wchip">🔔 ${esc(x.text)}<button type="button" data-unwatch="${esc(s.sid)}" data-w="${esc(x.id)}" aria-label="Stop waiting for ${esc(x.text)}">×</button></span>`).join('');
      const wform = watchFor === s.sid ? `<form class="row2 wform" data-wform="${esc(s.sid)}"><input class="field-in" name="w" placeholder="tests passed  or  /error|failed/" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"><button class="btn small">Tell me</button></form>` : '';
      const changes = term && (s.git || (st === 'done' && s.done.changes && s.done.changes.files));
      return `<div class="item agent s-${st}${cur ? ' cur' : ''}">
        <div class="ag-top"><i class="st s-${st}"></i><span class="ag-name"><b>${esc(title)}</b>${s.task ? `<em class="ag-task">${esc(s.task.title)}</em>` : ''}<small>${s.cwd ? esc(s.cwd) : ''}${branch(s.git)}</small></span><span class="ag-tag">${esc(tag)}</span></div>
        ${body}${w ? `<div class="wchips">${w}</div>` : ''}${wform}
        ${term || s.ext ? `<div class="ag-acts">${term ? `<button class="btn small ghost" data-sw="${esc(s.sid)}" type="button">${cur ? 'Open · on screen' : 'Open'}</button>` : ''}${changes ? `<button class="btn small ghost" data-diff="${esc(s.sid)}" type="button">Changes</button>` : ''}${term && s.running ? `<button class="btn small ghost" data-watch="${esc(s.sid)}" type="button" aria-label="Tell me when it says something">🔔</button>` : ''}${others > 0 ? `<span class="ag-eye">👁 ${others}</span>` : ''}${!cur ? `<button class="x" data-close="${esc(s.sid)}" type="button" aria-label="${s.ext ? 'Remove from the list' : 'Close terminal'}">✕</button>` : ''}</div>` : ''}</div>`;
    }).join('') : '<div class="empty">Connect to see your agents and terminals.</div>';
    if (watchFor) { const f = $('sessList').querySelector('[data-wform] input'); if (f && document.activeElement !== f) f.focus(); }
    t.paintOthers && t.paintOthers();
  }
  ctx.on('answered', (m) => { toast(m.ok ? 'Sent ✓' : 'It isn’t waiting anymore'); if (m.sid === current) hideNeeds(); refreshSessionsSoon(); });
  function refreshSessions() { if (ctx.live()) ctx.send({ t: 'sessions' }); }
  let rsT; function refreshSessionsSoon() { clearTimeout(rsT); rsT = setTimeout(refreshSessions, 400); }
  ctx.on('sessions', (m) => { sessions = m.list || []; current = m.current; paintSessions(); paintStrip(); });
  // The live strip over the terminal: other agents that need you or are working. One tap: the dashboard.
  function paintStrip() {
    const el = $('agStrip'); if (ctx.viewer) { el.hidden = true; return; }
    const others = sessions.filter((s) => s.sid !== current);
    const wait = others.filter((s) => stateOf(s) === 'wait'), work = others.filter((s) => stateOf(s) === 'work');
    const one = (s) => s.ext || s.ask ? nice(s.agent || s.program) : label(s);
    const text = wait.length ? (wait.length === 1 ? `${one(wait[0])} needs you` : `${wait.length} agents need you`)
      : work.length ? (work.length === 1 ? `${one(work[0])} is working` : `${work.length} agents working`) : '';
    if (el.hidden !== !text) { el.hidden = !text; ctx.relayout(); } // the terminal gives it room
    el.classList.toggle('hot', !!wait.length);
    const n = sessions.filter((s) => stateOf(s) === 'wait').length, badge = $('dockBadge'); // the dock's Agents button
    badge.hidden = !n; if (n && badge.textContent !== String(n)) badge.textContent = n;
    badge.parentElement.classList.toggle('hot', !!n);
    if (text && $('agStripText').textContent !== text) $('agStripText').textContent = text;
  }
  $('agStrip').onclick = () => { navigator.vibrate && navigator.vibrate(8); ctx.openSheet('sessions'); };
  setInterval(() => { if (ctx.live() && document.visibilityState === 'visible' && !ctx.pageOpen('sessions')) refreshSessions(); }, 8000);
  setTimeout(() => { if (ctx.live()) refreshSessions(); }, 1500);
  ctx.on('hi', () => { refreshSessions(); ctx.send({ t: 'shares' }); });
  ctx.on('switched', (m) => { current = m.sid; ctx.setSid(m.sid); hideNeeds(); refreshSessions(); });
  setInterval(() => { if (ctx.pageOpen('sessions')) refreshSessions(); }, 4000);
  $('sessList').onclick = (e) => {
    const a = e.target.closest('[data-ans]');
    if (a) {
      const b = (sessBtns[a.dataset.ans] || [])[+a.dataset.i]; if (!b || !b[1]) return;
      if (b[1] === 'SAY') { const s = sessions.find((x) => x.sid === a.dataset.ans); return openSay(a.dataset.ans, s && s.question); }
      a.disabled = true; navigator.vibrate && navigator.vibrate(10); ctx.send({ t: 'answer', sid: a.dataset.ans, d: b[1] }); return;
    }
    const df = e.target.closest('[data-diff]'); if (df) return openDiff(df.dataset.diff);
    const wb = e.target.closest('[data-watch]'); if (wb) { watchFor = watchFor === wb.dataset.watch ? null : wb.dataset.watch; paintSessions(); return; }
    const uw = e.target.closest('[data-unwatch]'); if (uw) { ctx.send({ t: 'watch-rm', id: ctx.newId(), sid: uw.dataset.unwatch, wid: uw.dataset.w }); refreshSessionsSoon(); return; }
    const c = e.target.closest('[data-close]');
    if (c) { const s = sessions.find((x) => x.sid === c.dataset.close); if (s && s.program && !s.ext && !confirm(`Close this terminal? ${s.program} is still running in it.`)) return; ctx.send({ t: 'close-session', sid: c.dataset.close }); return; }
    const b = e.target.closest('[data-sw]'); if (!b) return;
    if (b.dataset.sw !== current) switchTo(b.dataset.sw);
    ctx.closeSheet();
  };
  $('sessList').addEventListener('submit', (e) => {
    const f = e.target.closest('[data-wform]'); if (!f) return; e.preventDefault();
    const text = f.w.value.trim(); if (!text) return;
    const id = ctx.newId();
    ctx.listen(id, (m) => { ctx.unlisten(id); if (m.error) return toast(m.error); toast(`You'll get a notification when it says "${text}"`); watchFor = null; refreshSessions(); });
    ctx.send({ t: 'watch-add', id, sid: f.dataset.wform, text });
  });
  ctx.on('alert', (m) => { if (m.kind === 'match') toast(`🔔 ${m.pattern}: ${String(m.text || '').slice(0, 60)}`); });

  // ---- changes: see them, commit, push ----
  let diffSid = null;
  function paintGitBar(info) {
    const s = sessions.find((x) => x.sid === diffSid), g = info || (s && s.git);
    $('gitBar').hidden = !g;
    if (!g) return;
    $('gitBranch').innerHTML = `${branch({ ...g, dirty: 0 }) || 'no branch'}${g.dirty ? ` · ${g.dirty} changed` : ' · nothing to commit'}${!g.upstream && g.branch ? ' · not pushed yet' : ''}`;
    $('gitPush').textContent = `Push${g.ahead ? ' ↑' + g.ahead : ''}`;
  }
  function gitDo(what) {
    if (!ctx.live()) return toast('Connect first');
    const msg = $('gitMsg').value.trim();
    if (what === 'commit' && !msg) { $('gitMsg').focus(); return toast('Write what changed first'); }
    const btn = $(what === 'commit' ? 'gitCommit' : 'gitPush'); btn.disabled = true; const was = btn.textContent; btn.textContent = what === 'commit' ? 'Committing…' : 'Pushing…';
    const id = ctx.newId();
    const late = setTimeout(() => { ctx.unlisten(id); btn.disabled = false; btn.textContent = was; toast('No answer from the computer. If it runs an older Pocket Terminal: npx pocket-terminal@latest'); }, what === 'push' ? 100e3 : 30e3);
    ctx.listen(id, (m) => {
      clearTimeout(late); ctx.unlisten(id); btn.disabled = false; btn.textContent = was;
      if (m.error) { $('gitNote').textContent = m.error; return toast(m.error.split('.')[0]); }
      $('gitNote').textContent = what === 'commit' ? `Committed ${m.commit}.` : `Pushed ${m.branch}.`;
      toast(what === 'commit' ? 'Committed ✓' : 'Pushed ✓'); navigator.vibrate && navigator.vibrate(12);
      if (what === 'commit') { $('gitMsg').value = ''; openDiff(diffSid, true); }
      paintGitBar(m.info && { ...m.info, upstream: !!m.info.upstream }); refreshSessionsSoon();
    });
    ctx.send({ t: 'git', id, what, sid: diffSid, msg });
  }
  $('gitCommit').onclick = () => gitDo('commit');
  $('gitPush').onclick = () => gitDo('push');
  $('gitForm').onsubmit = (e) => { e.preventDefault(); gitDo('commit'); };
  function openDiff(sid, again = false) {
    diffSid = sid; if (!again) { $('gitNote').textContent = ''; } paintGitBar();
    if (!ctx.live()) return toast('Connect first');
    $('diffInfo').textContent = 'Loading the changes…'; $('diffOut').innerHTML = ''; if (!again) ctx.openSheet('diff');
    const id = ctx.newId();
    ctx.listen(id, (m) => {
      ctx.unlisten(id);
      if (m.error) { $('diffInfo').textContent = m.error; return; }
      const files = (m.diff.match(/^diff --git /gm) || []).length + (m.fresh || []).length;
      $('diffInfo').textContent = `${m.folder} · ${files} file${files === 1 ? '' : 's'} changed${m.cut ? ' (long: showing the start)' : ''}. Compared with your last commit.`;
      const lines = m.diff.split('\n').map((l) => {
        const c = /^diff --git /.test(l) ? 'f' : /^@@/.test(l) ? 'h' : /^\+(?!\+\+)/.test(l) ? 'a' : /^-(?!--)/.test(l) ? 'd' : '';
        return c ? `<span class="${c}">${esc(l)}</span>` : esc(l);
      });
      if (m.fresh && m.fresh.length) lines.push('', '<span class="f">New files (not in git yet):</span>', ...m.fresh.map((f) => `<span class="a">+ ${esc(f)}</span>`));
      $('diffOut').innerHTML = lines.join('\n') || 'No changes.';
    });
    ctx.send({ t: 'diff', id, sid });
  }
  function switchTo(sid) { if (/^[QC]-/.test(String(sid))) return ctx.openSheet('sessions'); const sz = ctx.size(); ctx.send({ t: 'switch', sid, cols: sz.cols, rows: sz.rows }); }
  $('sessNew').onclick = () => { if (!ctx.live()) return toast('Connect first'); switchTo(ctx.newId()); ctx.closeSheet(); toast('New terminal'); };
  ctx.onPage('sessions', () => { refreshSessions(); ctx.send({ t: 'shares' }); });
  ctx.onSwitchRequest(switchTo); // from a notification tap
  // Swipe left / right on the terminal: the next / previous terminal (in the dashboard's order of opening).
  addEventListener('pt-swipe', (e) => {
    if (ctx.viewer || !ctx.live()) return;
    const terms = sessions.filter((s) => !s.ask && !s.ext).sort((a, b) => a.created - b.created);
    if (terms.length < 2) return toast('Only one terminal. Agents & terminals → + New terminal');
    const i = terms.findIndex((s) => s.sid === current), next = terms[(i + e.detail + terms.length) % terms.length];
    navigator.vibrate && navigator.vibrate(8);
    switchTo(next.sid); toast(`${label(next)} · ${terms.indexOf(next) + 1} of ${terms.length}`);
  });

  Object.assign(t, { refreshSessions, refreshSessionsSoon, current: () => current, sessions: () => sessions, stateOf, openDiff, switchTo, nice });
}
