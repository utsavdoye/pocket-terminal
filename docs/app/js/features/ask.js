// Ask: find a command, or turn plain English into one. Built-in matches show as you type; the
// AI helper (your own key) answers when you tap Ask AI. Nothing runs until you tap Run.

import { randomId } from '../crypto.js';
import { search, riskOf, needsFill, askAi } from '../helper.js';
import { $, esc, toast } from '../core/dom.js';
import { state } from '../core/state.js';
import { input } from '../terminal/input.js';
import { openSheet, closeSheet } from '../ui/sheet.js';
import { jobs, runCommand } from './commands.js';
import { snippets, renderSnips } from './snippets.js';
import { ai, os, OS_LABEL, fillAiForm } from './ai.js';

// ---------- Ask: find a command, or turn plain English into one ----------
let aiResults = [], aiNote = '', aiBusy = null, armed = null;
function cmdHistory() {
  const h = snippets.map((s) => ({ cmd: s.cmd, name: s.name, from: 'saved' }));
  for (const j of jobs) if (!h.some((x) => x.cmd === j.cmd)) h.push({ cmd: j.cmd, from: 'recent' });
  return h;
}
function sugCard(r, i, src) {
  const risk = riskOf(r.cmd) || (r.risk && r.risk !== 'safe' ? { level: r.risk, why: '' } : null);
  const tag = risk ? `<span class="tag ${risk.level === 'danger' ? 'fail' : 'warn'}">${risk.level === 'danger' ? 'danger' : 'careful'}</span>` : (src === 'ai' ? '<span class="tag done">safe</span>' : '');
  const why = risk && risk.why ? `<p class="why">⚠ ${esc(risk.why[0].toUpperCase() + risk.why.slice(1))}.</p>` : '';
  const live = state.dc && state.dc.readyState === 'open';
  return `<div class="item sug" data-src="${src}" data-i="${i}">
    <div class="top"><b>${esc(r.name || r.explain || 'Suggestion')}</b>${tag}</div>
    ${r.name && r.explain ? `<p class="ex">${esc(r.explain)}</p>` : ''}${why}
    <input class="field-in cmdedit" value="${esc(r.cmd)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Command">
    <div class="acts"><button class="btn small" data-act="run">Run</button>${live ? '<button class="btn small ghost" data-act="type">Put in terminal</button>' : ''}<button class="btn small ghost" data-act="save">Save</button></div>
  </div>`;
}
export function paintAsk() {
  const q = $('askIn').value;
  $('askGo').textContent = aiBusy ? 'Asking…' : 'Ask AI';
  $('askGo').disabled = !!aiBusy;
  $('askAi').innerHTML = aiBusy ? '<div class="item thinking"><span></span><span></span><span></span></div>'
    : aiResults.map((r, i) => sugCard(r, i, 'ai')).join('') + (aiNote ? `<p class="hint">${esc(aiNote)}</p>` : '');
  const lib = search(q, os, cmdHistory());
  $('askLibTitle').hidden = !lib.length;
  $('askLibTitle').textContent = aiResults.length ? 'Also matching' : 'Matches';
  $('askLib').innerHTML = lib.map((r, i) => sugCard(r, i, 'lib')).join('') +
    (q.trim() && !lib.length && !aiResults.length && !aiBusy ? `<div class="empty">${ai ? 'Nothing built in. Tap <b>Ask AI</b>.' : 'Nothing built in matches. Turn on the AI helper in <b>Settings</b> to ask in plain English.'}</div>` : '');
  paintAsk.lib = lib;
  $('askHint').textContent = q.trim() ? `Commands for ${OS_LABEL[os]}. Nothing runs until you tap Run.` : 'Say what you want in plain English, or type the part of a command you remember.';
}
export async function doAsk(request) {
  const q = $('askIn').value.trim(); if (!q) return;
  request = request || q;
  if (!ai) { openSheet('settings'); $('aiForm').hidden = false; fillAiForm(); return toast('Add an AI key first. Groq and Gemini keys are free.'); }
  aiBusy?.abort(); const ctl = new AbortController(); aiBusy = ctl; aiResults = []; aiNote = ''; paintAsk();
  const timer = setTimeout(() => ctl.abort(), 25e3);
  try { const r = await askAi(ai, request, os, ctl.signal); if (aiBusy !== ctl) return; aiResults = r.options; aiNote = r.note; }
  catch (e) { if (aiBusy !== ctl) return; aiNote = e.name === 'AbortError' ? 'The AI took too long. Try again.' : /fetch/i.test(e.message) ? 'Could not reach the AI. Check this phone\'s internet.' : e.message; }
  finally { clearTimeout(timer); if (aiBusy === ctl) { aiBusy = null; paintAsk(); } }
}
export function setupAsk() {
  let t; $('askIn').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { aiResults = []; aiNote = ''; paintAsk(); }, 100); });
  $('askForm').onsubmit = (e) => { e.preventDefault(); doAsk(); };
  $('pane-ask').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const card = b.closest('.sug'), inp = card.querySelector('.cmdedit'), cmd = inp.value.trim();
    const src = card.dataset.src === 'ai' ? aiResults : paintAsk.lib, r = src[+card.dataset.i] || {};
    if (!cmd) return;
    if (needsFill(cmd) && b.dataset.act !== 'save') {
      const m = cmd.match(/<[^<>]+>/); inp.focus(); inp.setSelectionRange(m.index, m.index + m[0].length);
      return toast(`Fill in ${m[0]} first`);
    }
    if (b.dataset.act === 'save') { snippets.push({ id: randomId(), name: (r.name || r.explain || cmd).slice(0, 40), cmd }); renderSnips(); return toast('Saved. It shows as a chip now.'); }
    if (b.dataset.act === 'type') { closeSheet(); input(cmd); state.term.focus(); return; }
    const risk = riskOf(cmd);
    if (risk?.level === 'danger' && armed !== b) { armed = b; b.textContent = 'Tap again to run'; b.classList.add('danger'); setTimeout(() => { if (armed === b) { armed = null; b.textContent = 'Run'; b.classList.remove('danger'); } }, 4000); return; }
    armed = null;
    if (state.dc && state.dc.readyState === 'open') { closeSheet(); input(cmd + '\r'); state.term.focus(); }
    else { runCommand(cmd); openSheet('queue'); toast('Sent. It runs at the next check-in.'); }
  });
}
