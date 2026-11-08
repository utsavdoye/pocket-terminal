// Voice: the 🎤 button in Ask. Say what you want; when you stop talking it asks the AI helper.

export function setupVoice(ctx) {
  const { $, toast } = ctx;

  // ================= Voice =================
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  $('micBtn').onclick = () => {
    if (rec) { rec.stop(); return; }
    if (!SR) { $('askIn').focus(); return toast('Tap the 🎤 on your keyboard and say it.'); }
    try {
      rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1;
      $('micBtn').classList.add('on');
      rec.onresult = (ev) => { const r = ev.results[ev.results.length - 1]; $('askIn').value = r[0].transcript; $('askIn').dispatchEvent(new Event('input')); if (r.isFinal) rec.stop(); };
      rec.onerror = (ev) => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { $('askIn').focus(); toast('Voice is blocked here. Tap the 🎤 on your keyboard instead.'); } };
      rec.onend = () => { $('micBtn').classList.remove('on'); rec = null; if ($('askIn').value.trim()) ctx.ask(); };
      rec.start();
    } catch { $('micBtn').classList.remove('on'); rec = null; $('askIn').focus(); toast('Tap the 🎤 on your keyboard and say it.'); }
  };
}
