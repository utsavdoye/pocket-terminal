// Share a view-only link to the terminal on screen: for an hour or so, optionally letting the
// viewer answer Yes / No to its questions. Copy, send or stop it from the Agents page.

export function setupSharing(ctx, t) {
  const { $, toast } = ctx;
  let shareId = null;

  // ---- share a view-only link ----
  let shareMins = 60, shareExp = 0;
  $('shareMins').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; shareMins = +b.dataset.v; $('shareMins').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
  $('shareBtn').onclick = () => {
    if (!ctx.live()) return toast('Connect first');
    ctx.send({ t: 'share', minutes: shareMins, canAnswer: $('shareAnswer').checked });
  };
  ctx.on('share', (m) => {
    if (!m.link) return;
    shareId = m.id; shareExp = m.expires; $('shareLink').value = m.link; $('shareBox').hidden = false; paintShareLeft();
    $('shareBox').querySelector('.ex').textContent = $('shareAnswer').checked ? 'Anyone with the link can watch this terminal live and answer its questions with Yes or No, until it expires. They can\'t type or run anything else.' : 'Anyone with the link can watch this terminal live until it expires. They can\'t type or run anything.';
    $('shareSend').hidden = !navigator.share;
  });
  ctx.on('shares', (m) => {
    const mine = (m.list || []).filter((s) => s.sid === t.current());
    if (!mine.length) { if (shareId && !(m.list || []).some((s) => s.id === shareId)) { shareId = null; $('shareBox').hidden = true; } return; }
    if (!shareId) { shareId = mine[0].id; shareExp = mine[0].expires; $('shareBox').hidden = false; $('shareLink').value = '(made earlier: stop it and share again to see the link)'; paintShareLeft(); }
  });
  function paintShareLeft() { const m = Math.max(0, Math.round((shareExp - Date.now()) / 60e3)); $('shareLeft').textContent = m >= 60 ? `${Math.round(m / 60)} h left` : `${m} min left`; }
  setInterval(() => { if (shareId) paintShareLeft(); }, 30e3);
  $('shareCopy').onclick = async () => { try { await navigator.clipboard.writeText($('shareLink').value); toast('Link copied'); } catch { $('shareLink').select(); toast('Select and copy the link'); } };
  $('shareSend').onclick = () => navigator.share({ title: 'Watch my terminal', text: 'Live, view only:', url: $('shareLink').value }).catch(() => {});
  $('shareStop').onclick = () => { if (shareId) ctx.send({ t: 'unshare', id: shareId }); shareId = null; $('shareBox').hidden = true; toast('Stopped sharing. The link no longer works.'); };
}
