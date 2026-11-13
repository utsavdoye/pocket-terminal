// Every agent on every computer, on the Agents page. The computer on screen is live (its own
// list above). For the others, each leaves a short encrypted summary in this phone's mailbox on
// the board (agent/link/summary.js): which agents run there and which need you. You can answer
// them from here: the answer goes back as an encrypted note, without switching computers.
// A computer whose PIN is needed (locked on this phone) shows as locked: tap to switch and unlock.

import { computers, sessionFor, switchTo as useComputer } from '../core/computers.js';
import { seal, open, randomId } from '../crypto.js';
import { boardsFor, ownBoard } from '../core/env.js';
import { state, mac } from '../core/state.js';

const POLL = 15e3;

export function setupEverywhere(ctx, t) {
  const { $, esc, ago, toast } = ctx;
  if (ctx.viewer || ctx.demo) { t.paintOthers = () => { $('thisComp').hidden = true; }; return; }
  let others = []; // [{ topic, name, locked, list, ts, asleep }]
  let busy = false, lastPoll = 0;
  const asked = new Map(); // topic -> when we last asked it for a fresh list

  async function peek(S) {
    const keys = { key: S.key, topic: S.topic };
    const own = ownBoard(S.boards);
    const urls = own ? [own] : boardsFor(S.boards);
    let best = null, status = null;
    for (const u of urls) {
      try {
        const r = await fetch(`${u.replace(/\/+$/, '')}/${S.topic}/json?poll=1&since=12h`, { signal: AbortSignal.timeout(10e3) });
        if (!r.ok) continue;
        for (const line of (await r.text()).split('\n')) {
          let ev; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.event !== 'message') continue;
          const m = await open(keys, ev.message);
          if (!m || m.from !== 'mac') continue;
          if (m.type === 'agents' && (!best || m.ts > best.ts)) best = m;
          if (m.type === 'status' && (!status || m.ts > status.ts)) status = m;
        }
        if (best) break;
      } catch {}
    }
    return { best, status };
  }
  async function post(S, type, extra) {
    const keys = { key: S.key, topic: S.topic };
    const text = await seal(keys, { id: randomId(), ts: Date.now(), from: 'phone', type, ...extra });
    const own = ownBoard(S.boards);
    for (const u of own ? [own, ...boardsFor(S.boards).filter((b) => b !== own)] : boardsFor(S.boards)) {
      try { const r = await fetch(`${u.replace(/\/+$/, '')}/${S.topic}`, { method: 'POST', body: text, signal: AbortSignal.timeout(12e3) }); if (r.ok) return true; } catch {}
    }
    return false;
  }

  async function poll(force = false) {
    if (busy || (!force && Date.now() - lastPoll < POLL - 500)) return;
    busy = true; lastPoll = Date.now();
    try {
      const list = computers().filter((c) => state.S && c.topic !== state.S.topic);
      const next = [];
      for (const c of list) {
        const S = await sessionFor(c.topic);
        if (!S) { next.push({ topic: c.topic, name: c.name, locked: true }); continue; }
        const { best, status } = await peek(S);
        const o = { topic: c.topic, name: c.name, S, list: best ? best.list || [] : null, ts: best ? best.ts : 0, asleep: status && status.state === 'sleeping' && (!best || status.ts > best.ts) };
        next.push(o);
        // Old or no list: ask it for a fresh one (it answers if it's awake). At most once a minute.
        if ((!best || Date.now() - best.ts > 2 * 60e3) && Date.now() - (asked.get(c.topic) || 0) > 60e3) { asked.set(c.topic, Date.now()); post(S, 'agents?', {}).catch(() => {}); }
      }
      others = next;
    } finally { busy = false; }
    paintOthers();
  }

  const DOT = { blocked: 's-wait', working: 's-work', idle: 's-idle' };
  const NAMES = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', aider: 'Aider', opencode: 'OpenCode', 'cursor-agent': 'Cursor', qwen: 'Qwen Code' };
  const nice = (p) => NAMES[p] || (p ? p[0].toUpperCase() + p.slice(1) : 'Terminal');
  let sayFor = null;
  function paintOthers() {
    $('thisComp').textContent = `This computer · ${mac.name || (state.S && state.S.name) || ''}`;
    $('thisComp').hidden = !others.length;
    let blocked = 0;
    $('others').innerHTML = others.map((o) => {
      const head = `<div class="sub other-h"><span>${esc(o.name)}</span>${o.locked ? '<em>locked</em>' : o.asleep ? '<em>asleep</em>' : o.ts ? `<em>${esc(ago(o.ts))}</em>` : ''}</div>`;
      if (o.locked) return `${head}<div class="item agent s-idle"><p class="ag-note">Locked on this phone. Unlock it once (12 hours) to see its agents here.</p><div class="ag-acts"><button class="btn small ghost" data-unlock="${esc(o.topic)}" type="button">Switch &amp; unlock</button></div></div>`;
      if (!o.list) return `${head}<div class="item agent s-idle"><p class="ag-note">No word from it yet. It sends its list when an agent starts, needs you or stops (it needs Pocket Terminal 7.6 or newer).</p></div>`;
      if (!o.list.length) return `${head}<div class="item agent s-idle"><p class="ag-note">No agents running.</p></div>`;
      return head + `<div class="list">${o.list.map((a) => {
        if (a.st === 'blocked') blocked++;
        const k = `${o.topic}|${a.sid}`;
        const btns = a.st !== 'blocked' ? '' : a.ask ? [['Allow', 'yes', 'yes'], ['Deny', 'no']] : [['Yes', 'yes', 'yes'], ['No', 'no'], ['🎤 Say', 'say']];
        return `<div class="item agent s-${a.st === 'blocked' ? 'wait' : a.st === 'working' ? 'work' : 'idle'}">
          <div class="ag-top"><i class="st ${DOT[a.st] || 's-idle'}"></i><span class="ag-name"><b>${esc(nice(a.p))}</b>${a.t ? `<em class="ag-task">${esc(a.t)}</em>` : ''}<small>${esc(a.cwd || '')}</small></span><span class="ag-tag">${esc(a.st)}${a.at ? ' · ' + esc(ago(a.at)) : ''}</span></div>
          ${a.st === 'blocked' ? `<p class="ag-q">${esc(a.q || 'It is waiting for your answer.')}</p><div class="needs-btns ag-btns">${btns.map(([l, v, c]) => `<button type="button" data-oans="${esc(k)}" data-a="${v}"${c ? ` class="${c}"` : ''}>${esc(l)}</button>`).join('')}</div>` : ''}
          ${sayFor === k ? `<form class="row2 wform" data-osay="${esc(k)}"><input class="field-in plain" name="w" placeholder="No, do it this way instead…" autocomplete="off" enterkeyhint="send"><button class="btn small">Send</button></form>` : ''}
        </div>`;
      }).join('')}</div>`;
    }).join('');
    // the dock's Agents badge counts these too
    const here = t.sessions().filter((s) => s.waiting).length, badge = $('dockBadge');
    const n = here + blocked; badge.hidden = !n; if (n) badge.textContent = n; badge.parentElement.classList.toggle('hot', !!n);
  }
  async function answer(k, a, text) {
    const [topic, sid] = k.split('|'); const o = others.find((x) => x.topic === topic); if (!o || !o.S) return;
    const ok = await post(o.S, 'answer', { sid, a, ...(text ? { text } : {}) });
    toast(ok ? `Sent to ${o.name} ✓` : 'Could not reach the board. Try again.');
    if (ok) { const x = o.list && o.list.find((y) => y.sid === sid); if (x) x.st = 'idle'; paintOthers(); setTimeout(() => poll(true), 5000); }
  }
  $('others').addEventListener('click', (e) => {
    const u = e.target.closest('[data-unlock]'); if (u) { if (useComputer(u.dataset.unlock)) location.replace(location.pathname); return; }
    const b = e.target.closest('[data-oans]'); if (!b) return;
    if (b.dataset.a === 'say') { sayFor = sayFor === b.dataset.oans ? null : b.dataset.oans; paintOthers(); const f = $('others').querySelector('[data-osay] input'); f && f.focus(); return; }
    b.disabled = true; navigator.vibrate && navigator.vibrate(10); answer(b.dataset.oans, b.dataset.a);
  });
  $('others').addEventListener('submit', (e) => {
    const f = e.target.closest('[data-osay]'); if (!f) return; e.preventDefault();
    const text = f.w.value.trim(); if (!text) return; const k = f.dataset.osay; sayFor = null; answer(k, 'say', text);
  });

  ctx.onPage('sessions', () => { t.refreshSessions(); ctx.send({ t: 'shares' }); poll(true); });
  setInterval(() => { if (document.visibilityState === 'visible' && (ctx.pageOpen('sessions') || Date.now() - lastPoll > 60e3)) poll(); }, 5000);
  setTimeout(() => poll(true), 3000);
  t.paintOthers = paintOthers;
}
