// Saved commands (snippets), stored on this phone: the Saved commands page, and the chips in the
// quick bar that run one with a tap.

import { randomId } from '../crypto.js';
import { $, esc, toast } from '../core/dom.js';
import { store } from '../core/store.js';
import { state } from '../core/state.js';
import { input } from '../terminal/input.js';
import { closeQuick } from '../terminal/keyrow.js';
import { openSheet, closeSheet } from '../ui/sheet.js';
import { runCommand } from './commands.js';

// ---------- snippets (stored on this phone) ----------
export let snippets = store.get('snippets', [
  { id: 's1', name: 'Git status', cmd: 'git status' }, { id: 's2', name: 'Git pull', cmd: 'git pull' },
  { id: 's3', name: 'Run tests', cmd: 'npm test' }, { id: 's4', name: 'Disk space', cmd: 'df -h /' }]);
let editing = null; // the id of the saved command being changed in the form
export function renderSnips() {
  store.set('snippets', snippets);
  renderChips();
  $('snips').innerHTML = snippets.length ? snippets.map((s) => `<div class="item snip"><button class="run" data-run="${esc(s.id)}"><b>${esc(s.name)}</b><code>${esc(s.cmd)}</code></button><button class="x" data-sedit="${esc(s.id)}" aria-label="Change ${esc(s.name)}">✎</button><button class="x" data-sdel="${esc(s.id)}" aria-label="Delete ${esc(s.name)}">✕</button></div>`).join('') : '<div class="empty">No saved commands yet. Add one below.</div>';
}
function renderChips() {
  $('chips').innerHTML = '<button class="chip ask" id="askChip">✦ Ask</button>' + snippets.map((s) => `<button class="chip" data-run="${esc(s.id)}">${esc(s.name)}</button>`).join('') + '<button class="chip add" id="addChip">+ Save a command</button>';
}

export function setupSnippets() {
  $('chips').onclick = (e) => {
    if (e.target.id === 'addChip') return openSheet('snippets');
    if (e.target.id === 'askChip') return openSheet('ask');
    const c = e.target.closest('[data-run]'); if (!c) return;
    const s = snippets.find((x) => x.id === c.dataset.run); if (!s) return;
    closeQuick();
    if (state.dc && state.dc.readyState === 'open') { input(s.cmd + '\r'); state.term.focus(); }
    else { runCommand(s.cmd); toast(`Sent “${s.name}”. The reply lands in ⋯ → Send a command.`); }
  };
  const stopEdit = () => { editing = null; $('sname').value = $('scmd').value = ''; $('sform').querySelector('button').textContent = 'Save'; };
  $('sform').onsubmit = (e) => { e.preventDefault(); const name = $('sname').value.trim(), cmd = $('scmd').value.trim(); if (!name || !cmd) return toast('Give it a name and a command');
    const old = editing && snippets.find((x) => x.id === editing);
    if (old) { old.name = name.slice(0, 40); old.cmd = cmd; } else snippets.push({ id: randomId(), name: name.slice(0, 40), cmd });
    stopEdit(); renderSnips(); };
  $('snips').onclick = (e) => {
    const del = e.target.closest('[data-sdel]'), run = e.target.closest('[data-run]'), ed = e.target.closest('[data-sedit]');
    if (ed) { // change one: it goes into the form below
      const s = snippets.find((x) => x.id === ed.dataset.sedit); if (!s) return;
      editing = s.id; $('sname').value = s.name; $('scmd').value = s.cmd; $('sform').querySelector('button').textContent = 'Update'; $('scmd').focus(); return;
    }
    if (del) { snippets = snippets.filter((s) => s.id !== del.dataset.sdel); if (editing === del.dataset.sdel) stopEdit(); return renderSnips(); }
    if (!run) return;
    const s = snippets.find((x) => x.id === run.dataset.run); if (!s) return;
    if (state.dc && state.dc.readyState === 'open') { input(s.cmd + '\r'); closeSheet(); }
    else { runCommand(s.cmd); openSheet('queue'); }
  };
}
