// What a phone can ask for over its direct link: typing and screen size, switching
// sessions, answering questions, commands, settings, notifications, localhost preview,
// files, and live-view links. A viewer (a share link) can only watch, and maybe answer.

const files = require('../lib/files');
const preview = require('../lib/preview');
const webpush = require('../lib/webpush');
const clipboard = require('../lib/clipboard');
const { choicesFor } = require('../lib/core');

// ctx: shared state (see direct.js). L: this link's state (see channel.js).
function onMessage(ctx, L, raw) {
  const { cfg, core, log, x, viewer } = ctx;
  const { dc, send, drain, info, fail, show, bind, keyFor, sidOf, listAll, gets, puts, act } = L;
  const sess = L.sess();
  let m; try { m = JSON.parse(String(raw)); } catch { return; }
  info.seen = Date.now();
  if (m.t === 'ping') return send({ t: 'pong' });
  if (m.t === 'attach' && m.z === 1) L.zOK = true;
  if (viewer) { // watching only. A link made with "can answer" may also press Yes/No on a question, nothing else.
    if (m.t === 'attach') bind(null);
    else if (m.t === 'answer' && cfg.canAnswer) {
      const q = core.question(cfg.watchKey), c = q && choicesFor(q.text, q.menu).find((x) => x.a === m.a);
      const ok = !!c && core.answer(cfg.watchKey, c.d); send({ t: 'answered', ok }); if (ok) { log(`a teammate answered "${c.a}"`); act({ ev: 'answered' }); }
    }
    return;
  }
  switch (m.t) {
    case 'attach': {
      const c = m.cols || L.size.cols, r = m.rows || L.size.rows;
      if (c) L.phoneSize = { cols: c | 0, rows: r | 0 };
      bind(m.sid, { fresh: m.fresh !== false, sz: L.phoneSize }); break;
    }
    case 'i': if (typeof m.d === 'string') {
      const io = bind(null), sz = io.size();
      // a session shared with the computer's own window: whoever types sets the size (and gets a clean screen)
      if (L.phoneSize && sz && (sz.cols !== L.phoneSize.cols || sz.rows !== L.phoneSize.rows)) show(io, L.phoneSize);
      io.input(m.d); L.typed += m.d.length;
    } break;
    case 'r': L.phoneSize = { cols: m.cols | 0, rows: m.rows | 0 }; if (sess) sess.resize(m.cols | 0, m.rows | 0); else L.size = { cols: m.cols, rows: m.rows }; break; // size before attach: keep it
    case 'cmd': act({ ev: 'command' }); core.runJob(String(m.id), m.cmd, (r) => ctx.deliver(r)); break;
    case 'settings': ctx.applySettings(m.power); break;
    // --- sessions: everything this phone has running on the computer ---
    case 'sessions': send(listAll()); break;
    case 'switch': {
      const k = keyFor(m.sid);
      if (/^local:[QC]-/.test(k) || (k.startsWith('local:') && !core.isSession(k))) { send(listAll()); break; } // not a terminal
      const s = core.session(k);
      if (m.cols) L.phoneSize = { cols: m.cols | 0, rows: m.rows | 0 };
      show(s, m.cols ? L.phoneSize : null); act({ ev: 'terminal', sid: sidOf(s.key).slice(0, 12) });
      send({ t: 'switched', sid: sidOf(s.key) }); break;
    }
    case 'reply': { const ok = core.reply(keyFor(m.sid), m.text); send({ t: 'answered', sid: m.sid, ok }); if (ok) { log('answered a waiting terminal in words'); act({ ev: 'answered', where: 'in words' }); } break; }
    case 'diff': core.diff(keyFor(m.sid), (r) => send({ t: 'diff', id: m.id, ...r })); break;
    case 'git': if (m.what === 'commit' || m.what === 'push') { act({ ev: 'git-' + m.what }); core.gitAct(keyFor(m.sid), m.what, m.msg, (r) => send({ t: 'git', id: m.id, ...r })); } break;
    case 'watch-add': send({ t: 'watch', id: m.id, ...core.addWatch(keyFor(m.sid), m.text) }); break;
    case 'watch-rm': send({ t: 'watch', id: m.id, ...core.removeWatch(keyFor(m.sid), String(m.wid)) }); break;
    case 'clip-get': act({ ev: 'clipboard', to: 'phone' }); clipboard.getClip().then((r) => send({ t: 'clip', id: m.id, ...r })); break;
    case 'clip-set': act({ ev: 'clipboard', to: 'computer' }); clipboard.setClip(m.text).then((r) => send({ t: 'clip', id: m.id, ...r })); break;
    case 'tasks': case 'task-add': case 'task-cancel': case 'race': case 'race-pick': case 'race-test': case 'chain': case 'task-cfg': case 'task-clear': case 'wt-merge': case 'wt-discard': case 'task-push':
      if (core.tasks) core.tasks.onPhone(m, send, keyFor, act); else send({ t: 'tasks', id: m.id, error: 'This computer runs an older Pocket Terminal.' }); break;
    case 'auto-get': send({ t: 'auto', ...core.getAuto() }); break;
    case 'auto-set': if (m.cfg && typeof m.cfg === 'object') send({ t: 'auto', ...core.setAuto(m.cfg) }); break;
    case 'answer': { const ok = core.answer(keyFor(m.sid), m.d); send({ t: 'answered', sid: m.sid, ok }); if (ok) { log('answered a waiting terminal from the dashboard'); act({ ev: 'answered' }); } break; }
    case 'close-session': act({ ev: 'close-terminal', sid: String(m.sid).slice(0, 12) }); if (keyFor(m.sid) !== (sess && sess.key) && !/^local:Q-/.test(keyFor(m.sid))) core.close(keyFor(m.sid)); send(listAll()); break;
    // --- notifications ---
    case 'push-sub': if (x.saveSub && m.sub && webpush.allowedEndpoint(m.sub.endpoint) && m.sub.keys) { x.saveSub(m.sub); act({ ev: 'notifications', on: true }); send({ t: 'push-ok', quiet: !!m.quiet }); } else fail('push-ok', null, 'That notification address is not allowed'); break;
    case 'push-off': x.removeSub && x.removeSub(m.endpoint); act({ ev: 'notifications', on: false }); send({ t: 'push-ok', off: true }); break;
    case 'push-test': ctx.notify({ kind: 'test', key: sess && sess.key }, true).then((how) => send({ t: 'push-tested', how })); break;
    // --- localhost preview ---
    case 'ports': preview.listPorts().then((list) => send({ t: 'ports', id: m.id, list })).catch((e) => fail('ports', m.id, e)); break;
    case 'http': if (!L.ports) L.ports = new Set(); if (!L.ports.has(m.port)) { L.ports.add(m.port); act({ ev: 'website', port: m.port | 0 }); } preview.proxy(m, { send, drain }).catch((e) => fail('http-h', m.id, e)); break;
    // --- files ---
    case 'ls': files.list(m.path, { hidden: !!m.hidden }).then((r) => send({ t: 'ls', id: m.id, ...r })).catch((e) => fail('ls', m.id, e)); break;
    case 'get': { const st = { cancelled: false }; gets.set(m.id, st); act({ ev: 'download', path: String(m.path).slice(0, 300) }); files.sendFile(m.id, m.path, { send, drain, cancelled: () => st.cancelled || !dc.isOpen() }).catch((e) => fail('get-h', m.id, e)).finally(() => gets.delete(m.id)); break; }
    case 'get-cancel': { const st = gets.get(m.id); if (st) st.cancelled = true; break; }
    case 'put': try { const r = files.receiver(m.dir, m.name, Number(m.size)); puts.set(m.id, r); send({ t: 'put-ok', id: m.id, path: r.path }); } catch (e) { fail('put-ok', m.id, e); } break;
    case 'put-c': { const r = puts.get(m.id); if (!r) break; try { r.write(m.d); } catch (e) { r.abort(); puts.delete(m.id); fail('put-done', m.id, e); } break; }
    case 'put-end': { const r = puts.get(m.id); if (!r) break; puts.delete(m.id); r.end().then((p) => { log('file received'); act({ ev: 'upload', path: String(p).slice(0, 300) }); send({ t: 'put-done', id: m.id, path: p }); }).catch((e) => fail('put-done', m.id, e)); break; }
    case 'put-cancel': { const r = puts.get(m.id); if (r) { r.abort(); puts.delete(m.id); } break; }
    // --- share a live view of one session ---
    case 'share': if (x.share && sess) { const r = x.share(sess.key, Number(m.minutes) || 60, !!m.canAnswer); act({ ev: 'share', minutes: Math.min(1440, Math.max(5, Number(m.minutes) || 60)), canAnswer: !!m.canAnswer }); send({ t: 'share', ...r }); } break;
    case 'shares': send({ t: 'shares', list: x.shares ? x.shares() : [] }); break;
    case 'unshare': x.unshare && x.unshare(String(m.id)); act({ ev: 'unshare' }); send({ t: 'shares', list: x.shares ? x.shares() : [] }); break;
  }
}

module.exports = { onMessage };
