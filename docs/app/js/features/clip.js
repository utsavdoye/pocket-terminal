// Clipboard (Menu → Clipboard): copy on the phone, paste on the computer, and the other way.
// Text only, through the same encrypted link.

export function setupClip(ctx) {
  const { $, toast } = ctx;
  const ask = (msg, then) => {
    if (!ctx.live()) return toast('Connect first');
    const id = ctx.newId();
    ctx.listen(id, (m) => { ctx.unlisten(id); if (m.error) { $('clipNote').textContent = m.error; toast(m.error); return; } then(m); });
    ctx.send({ ...msg, id });
  };
  $('clipPaste').onclick = async () => {
    try { $('clipOut').value = await navigator.clipboard.readText(); } catch { $('clipOut').focus(); toast('Long-press the box and tap Paste'); }
  };
  $('clipSend').onclick = () => {
    const text = $('clipOut').value; if (!text) { $('clipOut').focus(); return toast('Nothing to send'); }
    ask({ t: 'clip-set', text }, () => { $('clipNote').textContent = 'On the computer\'s clipboard. Paste it there.'; toast('Copied to the computer ✓'); navigator.vibrate && navigator.vibrate(10); });
  };
  $('clipGet').onclick = () => ask({ t: 'clip-get' }, (m) => {
    $('clipIn').textContent = m.text || ''; $('clipIn').hidden = false; $('clipInActs').hidden = !m.text;
    $('clipNote').textContent = m.text ? (m.cut ? 'Long: showing the first 100 KB.' : '') : 'The computer\'s clipboard is empty (or holds a picture).';
    // Copying right away works on most phones; where it needs a tap, the button below does it.
    if (m.text) navigator.clipboard.writeText(m.text).then(() => toast('Copied to this phone ✓')).catch(() => {});
  });
  $('clipCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('clipIn').textContent); toast('Copied to this phone ✓'); }
    catch { const r = document.createRange(); r.selectNodeContents($('clipIn')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Selected: tap Copy'); }
  };
  $('clipType').onclick = () => { const t = $('clipIn').textContent; if (!t) return; ctx.paste(t); ctx.closeSheet(); ctx.focus(); }; // as a paste: line breaks don't run anything
}
