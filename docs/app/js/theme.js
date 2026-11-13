// Runs before the page paints, so there's no flash of the wrong theme.
// The look (Settings → Appearance):
//   tech   the Terminal look: monospace everywhere, hairline borders, a dark palette (the default)
//   light / dark / auto (follows the phone)   the rounded look
// Colors for the Terminal look: charcoal, catppuccin, nord, dracula, gruvbox, paper (light).
(function () {
  var mq = matchMedia('(prefers-color-scheme: dark)');
  var BG = { charcoal: '#1e1f22', catppuccin: '#1e1e2e', nord: '#2e3440', dracula: '#282a36', gruvbox: '#282828', paper: '#f7f5ef' };
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v || d; } catch (e) { return d; } }
  function pick() { return get('pt_theme', 'tech'); }
  function palette() { var p = get('pt_palette', 'charcoal'); return BG[p] ? p : 'charcoal'; }
  function apply() {
    var m = pick(), root = document.documentElement, tech = m === 'tech', p = palette();
    var dark = tech ? p !== 'paper' : m === 'dark' || (m === 'auto' && mq.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    if (tech) { root.dataset.style = 'tech'; root.dataset.palette = p; } else { delete root.dataset.style; delete root.dataset.palette; }
    var meta = document.getElementById('themeColor'); if (meta) meta.content = tech ? BG[p] : dark ? '#08090D' : '#F4F5F7';
    document.dispatchEvent(new Event('pt-theme'));
  }
  window.ptTheme = { apply: apply, pick: pick, palette: palette };
  mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
  apply();
})();
