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
  const stateOf = (s) => s.waiting ? 'wait' : s.ext && s.busy ? 'work' : s.busy && s.lastOut && Date.now() - s.lastOut < 60e3 ? 'work' : s.program ? 'run' : s.done ? 'done' : 'idle';
  const ORDER = { wait: 0, work: 1, run: 2, done: 3, idle: 4 };
  function paintSessions() {
    const waiting = sessions.filter((s) => s.waiting && s.sid !== current).length;
    $('sessCount').textContent = waiting || '';
    const n = { wait: 0, work: 0, done: 0 }; for (const s of sessions) { const k = stateOf(s); if (k in n) n[k]++; else if (k === 'run') n.work++; }
    $('agSum').innerHTML = sessions.length ? `<span class="${n.wait ? 'hot' : ''}"><b>${n.wait}</b> need${n.wait === 1 ? 's' : ''} you</span><span><b>${n.work}</b> working</span><span><b>${n.done}</b> finished</span>` : '';
    sessBtns = {};
    const list = [...sessions].sort((a, b) => ORDER[stateOf(a)] - ORDER[stateOf(b)] || a.created - b.created);
    $('sessList').innerHTML = list.length ? list.map((s) => {
      const st = stateOf(s), cur = s.sid === current, others = s.viewers - (cur ? 1 : 0);
      const tag = st === 'wait' ? `${s.ask ? 'Asks permission' : 'Needs you'}${s.askedAt ? ' · ' + dur(Date.now() - s.askedAt) : ''}`
        : st === 'work' ? `Working${s.since ? ' · ' + dur(Date.now() - s.since) : ''}`
          : st === 'run' ? `Running · quiet ${s.lastOut ? dur(Date.now() - s.lastOut) : ''}`
            : st === 'done' ? `Finished ${ago(s.done.at)}` : 'At the prompt';
      const title = st === 'done' && !s.program ? nice(s.done.program) : label(s);
      let body = '';
      if (st === 'wait') {
        const btns = (sessBtns[s.sid] = answerBtns(s.question, s.menu, s.ask).filter(([l]) => !['Enter', 'Esc', '^C'].includes(l))); // the dashboard keeps it short
        body = `<p class="ag-q">${esc(s.question || 'It is waiting for your answer.')}</p><div class="needs-btns ag-btns">${btns.map(([l, d, c], i) => d ? `<button type="button" data-ans="${esc(s.sid)}" data-i="${i}"${c ? ` class="${c}"` : ''}>${esc(l)}</button>` : '').join('')}</div>`;
      } else if (st === 'done') {
        const ch = s.done.changes;
        body = `<p class="ag-note">Ran for ${dur(s.done.seconds * 1000)}${ch && ch.files ? ` · <b>${ch.files} file${ch.files === 1 ? '' : 's'} changed</b> <span class="plus">+${ch.add}</span> <span class="minus">−${ch.del}</span>` : ''}.</p>${ch && ch.files ? `<div class="needs-btns ag-btns"><button type="button" class="yes" data-diff="${esc(s.sid)}">See changes</button></div>` : ''}`;
      }
      else if (s.line) body = `<code>${esc(s.line)}</code>`;
      else if (s.ext && st === 'work') body = '<p class="ag-note">Working outside Pocket Terminal (its own window or VS Code). Its questions come here.</p>';
      const term = !s.ask && !s.ext; // a real terminal you can open
      return `<div class="item agent s-${st}${cur ? ' cur' : ''}">
        <div class="ag-top"><i class="st s-${st}"></i><span class="ag-name"><b>${esc(title)}</b>${s.cwd ? `<small>${esc(s.cwd)}</small>` : ''}</span><span class="ag-tag">${esc(tag)}</span></div>
        ${body}
        ${term || s.ext ? `<div class="ag-acts">${term ? `<button class="btn small ghost" data-sw="${esc(s.sid)}" type="button">${cur ? 'Open · on screen' : 'Open'}</button>` : ''}${others > 0 ? `<span class="ag-eye">👁 ${others}</span>` : ''}${!cur ? `<button class="x" data-close="${esc(s.sid)}" type="button" aria-label="${s.ext ? 'Remove from the list' : 'Close terminal'}">✕</button>` : ''}</div>` : ''}</div>`;
    }).join('') : '<div class="empty">Connect to see your agents and terminals.</div>';
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
    const c = e.target.closest('[data-close]');
    if (c) { const s = sessions.find((x) => x.sid === c.dataset.close); if (s && s.program && !s.ext && !confirm(`Close this terminal? ${s.program} is still running in it.`)) return; ctx.send({ t: 'close-session', sid: c.dataset.close }); return; }
    const b = e.target.closest('[data-sw]'); if (!b) return;
    if (b.dataset.sw !== current) switchTo(b.dataset.sw);
    ctx.closeSheet();
  };
  function openDiff(sid) {
    if (!ctx.live()) return toast('Connect first');
    $('diffInfo').textContent = 'Loading the changes…'; $('diffOut').innerHTML = ''; ctx.openSheet('diff');
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

  Object.assign(t, { refreshSessions, refreshSessionsSoon, current: () => current });
}
