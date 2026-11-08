// Needs you: a program asks something (an AI agent's "Do you want to proceed?", [y/N]). A card
// over the terminal answers it in one tap, or in your own words (typed or spoken).

export function setupNeeds(ctx, t) {
  const { $, esc, toast } = ctx;

  // ================= Needs you: one-tap answers =================
  let needsFor = null;
  // Buttons that fit a question: [label, what to type, class]
  const SAY = ['🎤 Say', 'SAY'];
  function answerBtns(text, menu, ask) {
    text = String(text || '');
    if (ask) return [['Allow', 'yes', 'yes'], ['Deny', 'no']]; // an agent outside Pocket Terminal: it only takes allow / deny
    if (ctx.viewer) return [['Yes', { a: 'yes' }, 'yes'], ['No', { a: 'no' }]]; // a teammate's link: Yes / No only, checked on the computer
    if (/password|passphrase/i.test(text)) return [['Type it', null, 'yes'], ['^C', '\x03']];
    return [...baseBtns(text, menu), SAY];
  }
  function baseBtns(text, menu) {
    if (menu || /(?:❯|›)\s*1\./.test(text) || /do you want/i.test(text)) return [['1 · Yes', '1', 'yes'], ['2', '2'], ['3 · No', '3'], ['Enter', '\r'], ['Esc', '\x1b']];
    if (/y\/n|yes\/no/i.test(text)) return [['Yes', 'y\r', 'yes'], ['No', 'n\r'], ['Enter', '\r'], ['^C', '\x03']];
    return [['Enter', '\r', 'yes'], ['y', 'y\r'], ['n', 'n\r'], ['Esc', '\x1b'], ['^C', '\x03']];
  }
  // ---- answer in your own words (typed or spoken): "No, do it this way instead" ----
  let sayFor = null, sayRec = null;
  const SRx = window.SpeechRecognition || window.webkitSpeechRecognition;
  function openSay(sid, q) {
    sayFor = sid; $('sayQ').textContent = q || ''; $('sayIn').value = ''; $('sayBox').hidden = false;
    $('sayMic').hidden = !SRx; setTimeout(() => $('sayIn').focus(), 50);
  }
  function closeSay() { if (sayRec) try { sayRec.stop(); } catch {} $('sayBox').hidden = true; sayFor = null; }
  $('sayCancel').onclick = closeSay;
  $('sayForm').onsubmit = (e) => {
    e.preventDefault(); const text = $('sayIn').value.trim(); if (!text || !sayFor) return;
    if (!ctx.live()) return toast('Connect first');
    ctx.send({ t: 'reply', sid: sayFor, text }); closeSay();
  };
  $('sayIn').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('sayForm').requestSubmit(); } };
  $('sayMic').onclick = () => {
    if (sayRec) { sayRec.stop(); return; }
    try {
      sayRec = new SRx(); sayRec.lang = navigator.language || 'en-US'; sayRec.interimResults = true;
      $('sayMic').classList.add('on');
      sayRec.onresult = (ev) => { $('sayIn').value = [...ev.results].map((r) => r[0].transcript).join(' '); };
      sayRec.onerror = () => toast('Voice is blocked here. Tap the 🎤 on your keyboard instead.');
      sayRec.onend = () => { $('sayMic').classList.remove('on'); sayRec = null; };
      sayRec.start();
    } catch { sayRec = null; $('sayMic').classList.remove('on'); toast('Tap the 🎤 on your keyboard and say it.'); }
  };
  function showNeeds(m) {
    if (m.kind !== 'input' || (!m.ask && !ctx.viewer && m.sid && m.sid !== ctx.sid())) return;
    if (m.ask && ctx.viewer) return;
    const text = String(m.text || '');
    $('needsTitle').textContent = m.ask ? `${m.program || 'Your AI agent'} asks for permission` : `${m.program ? m.program[0].toUpperCase() + m.program.slice(1) : 'Your terminal'} needs you`;
    $('needsLine').textContent = m.ask && m.cwd ? `${text} · ${m.cwd}` : text;
    const btns = answerBtns(text, m.menu, m.ask);
    $('needsBtns').innerHTML = btns.map(([l, d, c], i) => `<button type="button" data-i="${i}"${c ? ` class="${c}"` : ''}>${esc(l)}</button>`).join('');
    $('needsBtns').onclick = (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const d = btns[+b.dataset.i][1];
      if (d === 'SAY') return openSay(ctx.sid(), text);
      hideNeeds();
      if (m.ask) return ctx.send({ t: 'answer', sid: m.sid, d }); // allow / deny, checked on the computer
      if (d && typeof d === 'object') return ctx.send({ t: 'answer', ...d }); // teammate link
      if (d) ctx.input(d); ctx.focus();
    };
    needsFor = m.sid || ctx.sid(); $('needs').hidden = false; ctx.relayout();
    navigator.vibrate && navigator.vibrate([30, 60, 30]);
  }
  function hideNeeds() { if (!$('needs').hidden) { $('needs').hidden = true; needsFor = null; ctx.relayout(); } }
  ctx.on('alert', (m) => {
    if (m.kind === 'input') showNeeds(m);
    if (m.kind === 'gone' && needsFor === m.sid) hideNeeds(); // answered elsewhere, or back at the computer
    if (m.kind === 'auto') toast(`Auto-approved (${m.rule || 'your rule'}): ${String(m.text || '').slice(0, 60)}`);
    t.refreshSessionsSoon();
  });
  ctx.on('hi', (m) => { if (m.viewer && m.canAnswer) document.body.classList.add('cananswer'); });
  ctx.onInput(hideNeeds);

  Object.assign(t, { answerBtns, openSay, hideNeeds });
}
