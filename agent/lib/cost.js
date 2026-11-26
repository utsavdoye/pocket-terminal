// The cost meter: how many tokens a task used, and about what that costs at API prices.
//
// Nothing is measured by us. Each agent already keeps its own log on this computer; we read the
// part written while the task ran, in the task's folder:
//   Claude Code   ~/.claude/projects/<folder>/*.jsonl          (usage on every answer)
//   Codex         ~/.codex/sessions/…/rollout-*.jsonl          (a running total per session)
//   Gemini CLI    ~/.gemini/tmp/<hash of folder>/chats/*.json  (tokens on every answer)
// Other agents: no number (null). Nothing leaves the computer except the totals shown on the phone.
//
// Money is "about": list prices per million tokens (PRICES below, checked November 2026). On a
// subscription (Claude Max, ChatGPT) you don't pay per token; the number then says what the same
// work would cost on the API. Your own prices: ~/.pocket-terminal/prices.json, e.g.
//   { "my-model": { "in": 1, "out": 5, "read": 0.1, "write": 1.25 } }

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// USD per million tokens: in (fresh input), write (cache write), read (cached input), out.
// The longest name found inside the model's id wins ("claude-opus-4-5-2025…" → "opus-4-5").
const PRICES = {
  'fable-5-2': { in: 8, write: 10, read: 0.2, out: 40 }, 'mythos-5-2': { in: 8, write: 10, read: 0.2, out: 40 },
  'fable-5-1': { in: 10, write: 12.5, read: 0.25, out: 50 }, 'mythos-5-1': { in: 10, write: 12.5, read: 0.25, out: 50 },
  'fable-5': { in: 10, write: 12.5, read: 1, out: 50 }, 'mythos-5': { in: 10, write: 12.5, read: 1, out: 50 },
  'opus-5-5': { in: 4, write: 5, read: 0.2, out: 20 }, 'opus-5': { in: 5, write: 6.25, read: 0.5, out: 25 },
  'opus-4-8': { in: 5, write: 6.25, read: 0.5, out: 25 }, 'opus-4-7': { in: 5, write: 6.25, read: 0.5, out: 25 }, 'opus-4-6': { in: 5, write: 6.25, read: 0.5, out: 25 }, 'opus-4-5': { in: 5, write: 6.25, read: 0.5, out: 25 },
  'opus-4-1': { in: 15, write: 18.75, read: 1.5, out: 75 }, 'opus-4': { in: 15, write: 18.75, read: 1.5, out: 75 },
  'sonnet-5-5': { in: 2, write: 2.5, read: 0.1, out: 10 }, 'sonnet-5': { in: 2, write: 2.5, read: 0.2, out: 10 },
  'sonnet-4-6': { in: 3, write: 3.75, read: 0.3, out: 15 }, 'sonnet-4-5': { in: 3, write: 3.75, read: 0.3, out: 15 }, 'sonnet-4': { in: 3, write: 3.75, read: 0.3, out: 15 },
  'haiku-5-5': { in: 0.1, write: 0.125, read: 0.01, out: 0.5 }, 'haiku-4-5': { in: 1, write: 1.25, read: 0.1, out: 5 },
  'gpt-6-astra': { in: 10, read: 1, out: 50 }, 'gpt-6.1-sol': { in: 2, read: 0.1, out: 10 }, 'gpt-6.1-terra': { in: 1, read: 0.05, out: 5 },
  'gpt-6-luna': { in: 0.1, read: 0.01, out: 0.5 }, 'gpt-6-sol': { in: 2, read: 0.2, out: 10 },
  'gpt-5.6-sol': { in: 4, read: 0.4, out: 20 }, 'gpt-5.6-terra': { in: 2, read: 0.2, out: 12 }, 'gpt-5.6-luna': { in: 0.2, read: 0.02, out: 1.2 },
  'gpt-5.5': { in: 5, read: 0.5, out: 30 }, 'gpt-5.4-mini': { in: 0.75, read: 0.075, out: 4.5 }, 'gpt-5.4': { in: 2.5, read: 0.25, out: 15 },
  'gpt-5.3-codex': { in: 1.75, read: 0.175, out: 14 }, 'gpt-5.2': { in: 1.75, read: 0.175, out: 14 }, 'gpt-5.1': { in: 1.25, read: 0.125, out: 10 },
  'gpt-5-mini': { in: 0.25, read: 0.025, out: 2 }, 'gpt-5': { in: 1.25, read: 0.125, out: 10 },
};

function priceFor(model, extra) {
  const id = String(model || '').toLowerCase().replace(/_/g, '-');
  if (!id) return null;
  const table = { ...PRICES, ...(extra || {}) };
  const forms = [id, id.replace(/\./g, '-')]; // "claude-opus-4.5" and "claude-opus-4-5" both match
  let best = null;
  for (const k of Object.keys(table)) {
    const kk = k.toLowerCase();
    for (const f of forms) for (const key of new Set([kk, kk.replace(/\./g, '-')])) {
      const i = f.indexOf(key); if (i < 0) continue;
      // "opus-4" must not match "opus-4-7" or a future "gpt-5.9" match "gpt-5": a 1-2 digit version part after it means another model (a date like -20250514 is fine)
      if (/^\d|^[.-]\d{1,2}(?!\d)/.test(f.slice(i + key.length))) continue;
      if (!best || kk.length > best.length) best = k;
    }
  }
  return best ? table[best] : null;
}
// u: { in, out, read, write } in tokens. "in" is fresh input only (not the cached part).
function usd(u, model, extra) {
  const p = priceFor(model, extra); if (!p) return null;
  const v = (u.in * p.in + u.out * p.out + (u.read || 0) * (p.read != null ? p.read : p.in) + (u.write || 0) * (p.write != null ? p.write : p.in)) / 1e6;
  return Math.round(v * 10000) / 10000;
}

const lines = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n'); } catch { return []; } };
const real = (d) => { try { return fs.realpathSync(d); } catch { return path.resolve(d); } };
const fresh = (file, from) => { try { return fs.statSync(file).mtimeMs >= from - 2000; } catch { return false; } };
const MAX_FILE = 40 << 20; // skip very large logs
const small = (file) => { try { return fs.statSync(file).size <= MAX_FILE; } catch { return false; } };

// ---- Claude Code ----
function claude(cwd, from, to, home) {
  const root = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const tot = { in: 0, out: 0, read: 0, write: 0 }; const models = {}; let found = false;
  for (const c of new Set([cwd, real(cwd)])) {
    const dir = path.join(root, 'projects', c.replace(/[^a-zA-Z0-9]/g, '-'));
    let files = []; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f)); } catch { continue; }
    const seen = new Map(); // message id -> usage (the same answer is written more than once while it streams)
    for (const f of files) {
      if (!fresh(f, from) || !small(f)) continue;
      for (const l of lines(f)) {
        if (!l || l.indexOf('"usage"') < 0) continue;
        let j; try { j = JSON.parse(l); } catch { continue; }
        const m = j.message, u = m && m.usage; if (!u || j.type !== 'assistant') continue;
        const at = Date.parse(j.timestamp); if (!(at >= from - 5000 && at <= to + 5000)) continue;
        const id = m.id || j.uuid; const old = seen.get(id);
        if (!old || (u.output_tokens || 0) >= (old.u.output_tokens || 0)) seen.set(id, { u, model: m.model });
      }
    }
    for (const { u, model } of seen.values()) {
      found = true;
      const one = { in: u.input_tokens || 0, out: u.output_tokens || 0, read: u.cache_read_input_tokens || 0, write: u.cache_creation_input_tokens || 0 };
      for (const k of Object.keys(tot)) tot[k] += one[k];
      if (model && model !== '<synthetic>') { const x = models[model] || (models[model] = { in: 0, out: 0, read: 0, write: 0 }); for (const k of Object.keys(one)) x[k] += one[k]; }
    }
    if (found) break;
  }
  return found ? { tot, models } : null;
}

// ---- Codex ----
function walk(dir, out, depth = 0) {
  let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (depth < 4) walk(p, out, depth + 1); } else if (/^rollout-.*\.jsonl$/.test(e.name)) out.push(p); }
  return out;
}
function codex(cwd, from, to, home) {
  const root = path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'sessions');
  const want = new Set([cwd, real(cwd)]);
  const tot = { in: 0, out: 0, read: 0, write: 0 }; const models = {}; let found = false;
  for (const f of walk(root, [])) {
    if (!fresh(f, from) || !small(f)) continue;
    let here = false, model = null, first = null, last = null;
    for (const l of lines(f)) {
      if (!l) continue; let j; try { j = JSON.parse(l); } catch { continue; }
      const p = j.payload || {};
      if (j.type === 'session_meta') { here = want.has(p.cwd) || want.has(real(String(p.cwd || ''))); if (!here) break; }
      else if (j.type === 'turn_context') { if (p.model) model = p.model; if (p.cwd && !here) here = want.has(p.cwd); }
      else if (j.type === 'event_msg' && p.type === 'token_count' && p.info && p.info.total_token_usage) {
        const at = Date.parse(j.timestamp), t = p.info.total_token_usage;
        if (at < from - 5000) first = t; // the total before this task began (a resumed session)
        else if (at <= to + 5000) last = t;
      }
    }
    if (!here || !last) continue;
    const d = (k) => Math.max(0, (last[k] || 0) - ((first && first[k]) || 0));
    const cached = d('cached_input_tokens');
    const one = { in: Math.max(0, d('input_tokens') - cached), out: d('output_tokens'), read: cached, write: 0 }; // Codex counts cached tokens inside input
    found = true; for (const k of Object.keys(tot)) tot[k] += one[k];
    if (model) { const x = models[model] || (models[model] = { in: 0, out: 0, read: 0, write: 0 }); for (const k of Object.keys(one)) x[k] += one[k]; }
  }
  return found ? { tot, models } : null;
}

// ---- Gemini CLI ----
function gemini(cwd, from, to, home) {
  const tot = { in: 0, out: 0, read: 0, write: 0 }; const models = {}; let found = false;
  for (const c of new Set([cwd, real(cwd)])) {
    const dir = path.join(home, '.gemini', 'tmp', crypto.createHash('sha256').update(c).digest('hex'), 'chats');
    let files = []; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)); } catch { continue; }
    for (const f of files) {
      if (!fresh(f, from) || !small(f)) continue;
      let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
      for (const m of Array.isArray(j.messages) ? j.messages : []) {
        const t = m && m.tokens; if (!t) continue;
        const at = Date.parse(m.timestamp); if (!(at >= from - 5000 && at <= to + 5000)) continue;
        const cached = t.cached || 0;
        const one = { in: Math.max(0, (t.input || 0) - cached), out: (t.output || 0) + (t.thoughts || 0), read: cached, write: 0 };
        found = true; for (const k of Object.keys(tot)) tot[k] += one[k];
        if (m.model) { const x = models[m.model] || (models[m.model] = { in: 0, out: 0, read: 0, write: 0 }); for (const k of Object.keys(one)) x[k] += one[k]; }
      }
    }
    if (found) break;
  }
  return found ? { tot, models } : null;
}

const READERS = { claude, codex, gemini };

// → { tokens, in, out, cached, usd (or null: no price known), model } or null (no log found).
function costOf({ agent, cwd, startedAt, endedAt }, { home = os.homedir(), dir = null } = {}) {
  const read = READERS[agent]; if (!read || !cwd || !startedAt) return null;
  let r; try { r = read(cwd, startedAt, endedAt || Date.now(), home); } catch { return null; }
  if (!r) return null;
  let extra = null; if (dir) { try { extra = JSON.parse(fs.readFileSync(path.join(dir, 'prices.json'), 'utf8')); } catch {} }
  const names = Object.keys(r.models);
  let money = names.length ? 0 : null;
  for (const m of names) { const v = usd(r.models[m], m, extra); if (v == null) { money = null; break; } money += v; }
  const t = r.tot;
  return { tokens: t.in + t.out + t.read + t.write, in: t.in + t.write, out: t.out, cached: t.read, usd: money == null ? null : Math.round(money * 10000) / 10000, model: names.sort((a, b) => (r.models[b].out - r.models[a].out))[0] || null };
}

module.exports = { costOf, usd, priceFor, PRICES };
