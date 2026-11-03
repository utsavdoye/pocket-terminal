// pocket-terminal.utsavdoye.com: the live hero terminal, install tabs, copy buttons,
// a card glow that follows the pointer, scroll reveal, and live stars / installs.
(function () {
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var nav = $('.nav');
  if (nav) { var onScroll = function () { nav.classList.toggle('scrolled', scrollY > 8); }; addEventListener('scroll', onScroll, { passive: true }); onScroll(); }

  // install tabs: open on the visitor's own system
  var tabs = $$('.tabs [data-os]'), panes = $$('.pane[data-os]');
  function pick(os) {
    tabs.forEach(function (t) { var on = t.dataset.os === os; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
    panes.forEach(function (p) { p.classList.toggle('on', p.dataset.os === os); });
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { pick(t.dataset.os); }); });
  if (tabs.length) { var ua = navigator.userAgent; pick(/Windows/.test(ua) ? 'win' : /Linux/.test(ua) && !/Android/.test(ua) ? 'linux' : /Android|iPhone|iPad/.test(ua) ? 'npm' : 'mac'); }

  $$('.copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var done = function () { b.textContent = 'copied'; b.classList.add('done'); setTimeout(function () { b.textContent = 'copy'; b.classList.remove('done'); }, 1600); };
      if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(done, function () {});
    });
  });

  $$('.card').forEach(function (c) {
    c.addEventListener('pointermove', function (e) { var r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
  });

  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -6% 0px' });
    $$('.card, .shots figure, .step, .box, .checks li, details, .tablewrap, .install').forEach(function (el, i) { el.classList.add('reveal'); el.style.transitionDelay = (i % 3) * 70 + 'ms'; io.observe(el); });
  }

  // ---------- the hero: an AI coding agent on a laptop with the lid shut (a different agent each loop) ----------
  var term = $('#heroTerm'), notif = $('#heroNotif');
  if (term) {
    var P = '<span class="p">utsav@macbook</span> <span class="d">~/app</span> % ';
    var agents = [['claude', 'Claude'], ['codex', 'Codex'], ['gemini', 'Gemini']], ai = 0;
    var script = [
      ['type', '@ "fix the failing login test"'],
      ['out', '', 250],
      ['out', '<span class="a">●</span> Reading src/auth.ts', 600],
      ['out', '<span class="a">●</span> Running npm test  <span class="del">1 failing</span>', 800],
      ['out', '', 200],
      ['out', '<span class="b">Edit</span> src/auth.ts', 300],
      ['out', '<span class="del">-  if (user = null) return</span>', 160],
      ['out', '<span class="add">+  if (user === null) return</span>', 160],
      ['out', '', 160],
      ['out', 'Do you want to make this edit to auth.ts?', 260],
      ['out', '<span class="sel">❯ 1. Yes</span>', 120],
      ['out', '  2. No, tell @@ what to do instead', 120],
      ['out', '', 100],
      ['ask', '<span class="dim">  waiting… lid closed, phone notified</span>', 2600],
      ['out', '<span class="dim">  answered "1" from phone</span>', 700],
      ['out', '<span class="add">✓</span> Edited src/auth.ts', 300],
      ['out', '<span class="add">✓</span> npm test  <span class="add">42 passing</span>', 700],
      ['done', '', 4200]
    ];
    var lines = [], typed = '', CUR = '<span class="cursor"></span>';
    var draw = function (prompt) { term.innerHTML = lines.join('\n') + (prompt ? (lines.length ? '\n' : '') + P + typed + CUR : ''); };
    var title = notif && notif.querySelector('b');
    var run = function () {
      var ag = agents[ai++ % agents.length];
      var fill = function (t) { return t.replace('@@', ag[1]).replace('@ ', ag[0] + ' '); };
      if (title) title.textContent = ag[1] + ' needs you · app';
      lines = []; typed = ''; if (notif) notif.classList.remove('show');
      var i = 0;
      var step = function () {
        var s = script[i++]; if (!s) return;
        if (s[0] === 'type') {
          var k = 0, txt = fill(s[1]);
          (function t() { typed = txt.slice(0, ++k); draw(true); if (k < txt.length) setTimeout(t, 35 + Math.random() * 45); else setTimeout(function () { lines.push(P + txt); typed = ''; draw(false); step(); }, 450); })();
        } else if (s[0] === 'ask') {
          lines.push(s[1]); draw(false); if (notif) notif.classList.add('show'); setTimeout(function () { lines.pop(); if (notif) notif.classList.remove('show'); step(); }, s[2]);
        } else if (s[0] === 'done') {
          draw(true); setTimeout(run, s[2]);
        } else { lines.push(fill(s[1])); draw(false); setTimeout(step, s[2]); }
      };
      step();
    };
    if (reduce) { // a still frame instead of the animation
      lines = [P + 'claude "fix the failing login test"', '', '<span class="a">●</span> Running npm test  <span class="del">1 failing</span>', '', 'Do you want to make this edit to auth.ts?', '<span class="sel">❯ 1. Yes</span>', '  2. No, tell the agent what to do instead'];
      draw(false); if (notif) notif.classList.add('show');
    } else if ('IntersectionObserver' in window) {
      var started = false;
      new IntersectionObserver(function (es, o) { if (es[0].isIntersecting && !started) { started = true; o.disconnect(); run(); } }).observe(term);
    } else run();
  }

  // ---------- live proof: GitHub stars and npm installs, shown once they help ----------
  var fmt = function (n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n); };
  var get = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw 0; return r.json(); }); };
  Promise.all([get('https://api.github.com/repos/utsavdoye/pocket-terminal').catch(function () { return null; }),
    get('https://api.npmjs.org/downloads/point/last-month/pocket-terminal').catch(function () { return null; })]).then(function (r) {
    var stars = r[0] && r[0].stargazers_count, dl = r[1] && r[1].downloads;
    if (stars >= 10) $$('[data-stars]').forEach(function (el) { el.textContent = fmt(stars); });
    if (dl >= 50) $$('[data-dl]').forEach(function (el) { el.textContent = fmt(dl); });
    var p = $('[data-proof]'); if (p && stars >= 10 && dl >= 50) p.hidden = false;
  });
})();
