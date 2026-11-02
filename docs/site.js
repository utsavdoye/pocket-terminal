// terminal.utsavdoye.com: install tabs (opens on your system), copy buttons, gentle reveal on scroll.
(function () {
  var tabs = document.querySelectorAll('.tabs [data-os]'), panes = document.querySelectorAll('.pane[data-os]');
  function pick(os) {
    tabs.forEach(function (t) { var on = t.dataset.os === os; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
    panes.forEach(function (p) { p.classList.toggle('on', p.dataset.os === os); });
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { pick(t.dataset.os); }); });
  var ua = navigator.userAgent;
  pick(/Windows/.test(ua) ? 'win' : /Linux/.test(ua) && !/Android/.test(ua) ? 'linux' : 'mac');

  document.querySelectorAll('.copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var text = b.dataset.copy, done = function () { b.textContent = 'Copied'; b.classList.add('done'); setTimeout(function () { b.textContent = 'Copy'; b.classList.remove('done'); }, 1600); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
    });
  });

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.card, .shots figure, .steps3 li, .checks li, details').forEach(function (el, i) {
      el.classList.add('reveal'); el.style.transitionDelay = (i % 4) * 60 + 'ms'; io.observe(el);
    });
  }
})();
