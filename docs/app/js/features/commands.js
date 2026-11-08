// Send a command: commands (jobs) run on the computer, straight away over the live link or at
// its next check-in through the board, with their results kept on this phone.

import { randomId } from '../crypto.js';
import { $, esc, ago, toast } from '../core/dom.js';
import { store } from '../core/store.js';
import { state } from '../core/state.js';
import { sendTerm, connect } from '../connection/link.js';
import { post } from '../connection/notes.js';
import { openSheet } from '../ui/sheet.js';
import { doAsk } from './ask.js';
import { ai } from './ai.js';

// ---------- commands (jobs) ----------
export let jobs = store.get('jobs', []);
export const saveJobs = () => { jobs = jobs.slice(0, 50); store.set('jobs', jobs); renderJobs(); };
export function replaceJobs(list) { jobs = list; } // the demo brings its own sample history
export async function runCommand(cmd) {
  cmd = cmd.trim(); if (!cmd) return;
  const j = { cid: randomId(), cmd, created: Date.now(), status: 'sending' };
  jobs.unshift(j); saveJobs();
  try {
    if (state.dc && state.dc.readyState === 'open') { sendTerm({ t: 'cmd', id: j.cid, cmd }); j.status = 'running'; }
    else { await post('cmd', { cid: j.cid, cmd }); j.status = 'waiting'; if (state.linkState !== 'backup' && state.linkState !== 'connecting') connect(); }
  } catch (e) { j.status = 'error'; j.out = e.message; }
  saveJobs();
}
export function gotResult(cid, code, out) {
  const j = jobs.find((x) => x.cid === cid); if (!j || j.status === 'done') return;
  Object.assign(j, { status: 'done', code, out, finished: Date.now() }); saveJobs();
  toast(code === 0 ? `Done: ${j.cmd.slice(0, 40)}` : `Failed (exit ${code}): ${j.cmd.slice(0, 40)}`);
}
export function renderJobs() {
  $('qn').textContent = $('qn2').textContent = jobs.filter((j) => j.status === 'waiting' || j.status === 'running').length || '';
  $('jobs').innerHTML = jobs.length ? jobs.map((j, i) => {
    const tag = j.status === 'done' ? (j.code === 0 ? '<span class="tag done">done</span>' : `<span class="tag fail">exit ${esc(j.code)}</span>`)
      : j.status === 'running' ? '<span class="tag running">running</span>' : j.status === 'error' ? '<span class="tag fail">not sent</span>' : '<span class="tag">waiting for computer</span>';
    const lines = String(j.out || '').split('\n').filter(Boolean).length;
    // newest result open; older ones fold to one line, like a trade history
    const out = j.status === 'done' || j.status === 'error'
      ? `<details${i === 0 ? ' open' : ''}><summary>Output · ${lines} line${lines === 1 ? '' : 's'}</summary><pre>${esc(j.out) || '(no output)'}</pre></details>` : '';
    const st = j.status === 'done' ? (j.code === 0 ? 'ok' : 'fail') : j.status === 'running' ? 'run' : j.status === 'error' ? 'fail' : 'wait';
    const fix = j.status === 'done' && j.code !== 0 ? `<button class="x fixit" data-fix="${esc(j.cid)}">✦ Fix with AI</button>` : '';
    return `<div class="item job s-${st}"><div class="top"><i class="sdot"></i><code>${esc(j.cmd)}</code>${tag}</div>${out}<div class="meta"><span>sent ${ago(j.created)}${j.finished ? ' · finished ' + ago(j.finished) : ''}</span><span>${fix}<button class="x" data-del="${esc(j.cid)}">remove</button></span></div></div>`;
  }).join('') : '<div class="empty">Nothing sent yet. Type a command above and tap Run.</div>';
}

export function setupCommands() {
  $('bannerForm').onsubmit = (e) => { e.preventDefault(); const c = $('bannerCmd').value; if (!c.trim()) return; runCommand(c); $('bannerCmd').value = ''; $('bannerCmd').blur(); toast(state.dc && state.dc.readyState === 'open' ? 'Running…' : "Sent. It runs at the next check-in."); };
  $('qform').onsubmit = (e) => { e.preventDefault(); runCommand($('qcmd').value); $('qcmd').value = ''; };
  $('jobs').onclick = (e) => {
    const id = e.target.dataset.del; if (id) { jobs = jobs.filter((j) => j.cid !== id); saveJobs(); return; }
    const f = jobs.find((j) => j.cid === e.target.dataset.fix); if (!f) return;
    openSheet('ask'); $('askIn').value = 'Fix: ' + f.cmd;
    if (!ai) return doAsk();
    toast('Sending the command and the end of its output to your AI');
    doAsk(`This command failed with exit code ${f.code}:\n$ ${f.cmd}\n\nOutput (last part):\n${String(f.out || '').slice(-1500)}\n\nWhat went wrong, and what should I run instead?`);
  };
  $('clearDone').onclick = () => { jobs = jobs.filter((j) => j.status !== 'done'); saveJobs(); };
}
