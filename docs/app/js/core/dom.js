// Small DOM helpers used everywhere: find by id, make text safe for HTML, "5 min ago",
// the toast at the bottom, and switching between the pair / lock / not-paired / app screens.

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Replace an element's HTML only when it changed: lists that refresh every few seconds then stay still
// (no flicker, no lost taps, open menus and scroll positions kept).
export const setHTML = (el, html) => { if (!el || el._html === html) return false; el._html = html; el.innerHTML = html; return true; };
export const ago = (t) => { if (!t) return 'never'; const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
let toastT; export const toast = (m) => { const t = $('toast'); t.textContent = m; t.style.display = 'block'; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => (t.style.display = 'none'), 2600); };
export const show = (id) => { for (const g of ['gate-pair', 'gate-lock', 'gate-none', 'app']) $(g).hidden = g !== id; };
