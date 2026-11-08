// The AI helper's setup (Settings → AI helper): which provider and model, and your own API key,
// kept on this phone encrypted with the pairing key. Also which system (macOS, Windows, Linux)
// commands are written for.

import { askAi, PROVIDERS } from '../helper.js';
import { $, esc, toast } from '../core/dom.js';
import { store } from '../core/store.js';
import { DEMO } from '../core/env.js';
import { state } from '../core/state.js';

export let os = store.get('os', 'darwin');
export const OS_LABEL = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
export function setOs(v) { if (!OS_LABEL[v] || v === os) return; os = v; store.set('os', v); }
export let ai = null; // { provider, model, key } (key only in memory; stored encrypted with the pairing key)
const AI_AAD = new TextEncoder().encode('pocket-terminal/ai-key');
export async function loadAi() {
  const a = store.get('ai'); if (!a) return paintAiInfo();
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(a.iv), additionalData: AI_AAD }, state.keys.key, fromB64(a.ct));
    ai = { provider: a.provider, model: a.model, url: a.url, key: new TextDecoder().decode(plain) };
  } catch { ai = null; }
  paintAiInfo();
}
const toB64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function saveAi(cfg) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AI_AAD }, state.keys.key, new TextEncoder().encode(cfg.key));
  store.set('ai', { provider: cfg.provider, model: cfg.model, url: cfg.url, iv: toB64(iv), ct: toB64(ct) });
  ai = cfg; paintAiInfo();
}
export function paintAiInfo() {
  $('aiInfo').textContent = ai ? `On: ${(PROVIDERS[ai.provider]?.label || ai.provider).split(':')[0]}${ai.model ? ' · ' + ai.model : ''}` : 'Off. Works with ChatGPT, Claude, Gemini or any OpenAI-compatible API, using your own key.';
  $('aiSetup').textContent = ai ? 'Change' : 'Set up';
}

export function fillAiForm() {
  const p = ai?.provider || 'groq';
  $('aiProvider').innerHTML = Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}"${k === p ? ' selected' : ''}>${esc(v.label)}</option>`).join('');
  $('aiKey').value = ''; $('aiKey').placeholder = ai ? 'API key (leave empty to keep)' : 'API key';
  $('aiModel').value = ai?.model || ''; $('aiUrl').value = ai?.url || ''; $('aiNote').textContent = ''; aiHelp();
}
function aiHelp() {
  const k = $('aiProvider').value, p = PROVIDERS[k];
  $('aiUrl').hidden = k !== 'custom';
  $('aiModel').placeholder = p.model ? 'model (default: ' + p.model + ')' : 'model name, e.g. llama3.1';
  $('aiKeyHelp').innerHTML = k === 'custom' ? 'Any service that speaks the OpenAI chat API: Together, Fireworks, Perplexity, Azure OpenAI, your own server… It must allow calls from a browser (CORS).'
    : `Get a key at <b>${esc(p.keyUrl)}</b>.` + (k === 'openai' ? ' A ChatGPT Plus subscription is not an API key; API use is billed separately.' : k === 'openrouter' ? ' Works with every big model, and some are free.' : '');
}
function aiFormCfg() {
  const provider = $('aiProvider').value, key = $('aiKey').value.trim() || (ai && ai.provider === provider ? ai.key : '');
  return { provider, key, model: $('aiModel').value.trim(), url: provider === 'custom' ? $('aiUrl').value.trim() : '' };
}

export function setupAiSettings() {
  $('aiSetup').onclick = () => { $('aiForm').hidden = !$('aiForm').hidden; if (!$('aiForm').hidden) fillAiForm(); };
  $('aiProvider').onchange = aiHelp;
  $('aiForm').onsubmit = async (e) => {
    e.preventDefault();
    if (DEMO) return toast('The demo has no AI key. Pair your own computer to set one up.');
    const c = aiFormCfg();
    if (!c.key) return toast('Paste your API key');
    if (c.provider === 'custom' && !/^https:\/\//.test(c.url)) return toast('Enter the API address (https://…)');
    if (c.provider === 'custom' && !c.model) return toast('Enter a model name');
    await saveAi(c); $('aiForm').hidden = true; toast('AI helper is on. Try it in Ask.');
  };
  $('aiTest').onclick = async () => {
    const c = aiFormCfg(); if (!c.key) return toast('Paste your API key');
    $('aiNote').textContent = 'Testing…';
    try { const r = await askAi(c, 'show the current folder', os, AbortSignal.timeout(20e3)); $('aiNote').textContent = `Works ✓ It answered: ${r.options[0].cmd}`; }
    catch (e) { $('aiNote').textContent = /fetch/i.test(e.message) ? 'Could not reach it. Check the address, or this provider may block calls from a browser (try OpenRouter).' : e.message; }
  };
  $('aiOff').onclick = () => { store.del('ai'); ai = null; paintAiInfo(); $('aiForm').hidden = true; toast('AI helper turned off. The key was removed from this phone.'); };
}
