/* ============ Billing POS - pin.js (PIN lock) ============ */
(function () {
  const KEY = 'pos2_pin';
  const LOCK_AFTER_MS = 5 * 60 * 1000; // lock again after 5 minutes in background

  const T = {
    en: {
      enter: 'Enter PIN', wrong: 'Wrong PIN, try again', title: 'App PIN lock',
      hintOff: 'Set a 4-digit PIN. It will be asked every time the app opens.',
      hintOn: 'PIN is ON. It is asked when the app opens, and when you come back after more than 5 minutes in another app.',
      set: 'Set PIN', change: 'Change PIN', remove: 'Remove PIN',
      newPin: 'Enter new 4-digit PIN', confirmPin: 'Enter the same PIN again', current: 'Enter current PIN',
      mismatch: 'PINs did not match. Try again.', saved: 'PIN saved ✓', removed: 'PIN removed',
      wait: 'Too many wrong tries. Wait 30 seconds.', cancel: 'Cancel'
    },
    pa: {
      enter: 'PIN ਪਾਓ', wrong: 'ਗਲਤ PIN, ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ', title: 'ਐਪ PIN ਲੌਕ',
      hintOff: '4 ਅੰਕਾਂ ਦਾ PIN ਲਗਾਓ। ਐਪ ਖੋਲ੍ਹਣ ਵੇਲੇ ਹਰ ਵਾਰ ਪੁੱਛਿਆ ਜਾਵੇਗਾ।',
      hintOn: 'PIN ਚਾਲੂ ਹੈ। ਐਪ ਖੋਲ੍ਹਣ ਵੇਲੇ, ਅਤੇ 5 ਮਿੰਟ ਤੋਂ ਵੱਧ ਦੂਜੀ ਐਪ ਵਰਤ ਕੇ ਵਾਪਸ ਆਉਣ ਤੇ ਪੁੱਛਿਆ ਜਾਂਦਾ ਹੈ।',
      set: 'PIN ਲਗਾਓ', change: 'PIN ਬਦਲੋ', remove: 'PIN ਹਟਾਓ',
      newPin: 'ਨਵਾਂ 4 ਅੰਕਾਂ ਦਾ PIN ਪਾਓ', confirmPin: 'ਉਹੀ PIN ਦੁਬਾਰਾ ਪਾਓ', current: 'ਪੁਰਾਣਾ PIN ਪਾਓ',
      mismatch: 'ਦੋਵੇਂ PIN ਨਹੀਂ ਮਿਲੇ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।', saved: 'PIN ਸੇਵ ਹੋ ਗਿਆ ✓', removed: 'PIN ਹਟਾ ਦਿੱਤਾ',
      wait: 'ਬਹੁਤ ਵਾਰ ਗਲਤ। 30 ਸਕਿੰਟ ਰੁਕੋ।', cancel: 'ਰੱਦ'
    }
  };

  const getApp = () => (typeof app !== 'undefined' ? app : null);
  const lang = () => { const a = getApp(); return a && a.settings && a.settings.lang === 'pa' ? 'pa' : 'en'; };
  const t = (k) => (T[lang()] || T.en)[k] || T.en[k];
  const toast = (m) => { const a = getApp(); if (a && a.toast) a.toast(m); };
  const getHash = () => localStorage.getItem(KEY);

  async function hash(pin) {
    if (!(window.crypto && crypto.subtle)) return 'plain:' + pin;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pos-pin:' + pin));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ---------- Styles ---------- */
  const style = document.createElement('style');
  style.textContent = `
    #pin-lock { position: fixed; inset: 0; z-index: 300; display: none; flex-direction: column; align-items: center; justify-content: center;
      background: linear-gradient(160deg, #4f46e5, #312e81); color: #fff; user-select: none; -webkit-user-select: none;
      padding: calc(24px + env(safe-area-inset-top, 0px)) 24px calc(24px + env(safe-area-inset-bottom, 0px)); }
    #pin-lock.show { display: flex; }
    .pin-logo { width: 72px; height: 72px; border-radius: 18px; background: rgba(255,255,255,.15); display: flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 14px; font-size: 32px; }
    .pin-logo img { width: 100%; height: 100%; object-fit: cover; }
    .pin-shop { font-size: 20px; font-weight: 800; text-align: center; }
    .pin-msg { margin-top: 6px; font-size: 15px; opacity: .85; min-height: 22px; text-align: center; }
    .pin-msg.err { color: #fecaca; opacity: 1; font-weight: 700; }
    .pin-dots { display: flex; gap: 16px; margin: 22px 0 28px; }
    .pin-dots span { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff; transition: background .1s; }
    .pin-dots span.on { background: #fff; }
    .pin-dots.shake { animation: pinShake .35s; }
    @keyframes pinShake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-10px); } 75% { transform: translateX(10px); } }
    .pin-pad { display: grid; grid-template-columns: repeat(3, 76px); gap: 16px; }
    .pin-pad button { width: 76px; height: 76px; border-radius: 50%; border: none; background: rgba(255,255,255,.14); color: #fff; font-size: 28px; font-weight: 600; }
    .pin-pad button:active { background: rgba(255,255,255,.32); }
    .pin-pad button.ghost { background: none; font-size: 16px; }
    @media (max-height: 640px) {
      .pin-pad { grid-template-columns: repeat(3, 64px); gap: 12px; }
      .pin-pad button { width: 64px; height: 64px; font-size: 24px; }
      .pin-dots { margin: 16px 0 20px; }
      .pin-logo { width: 56px; height: 56px; }
    }`;
  document.head.appendChild(style);

  /* ---------- Lock screen ---------- */
  const el = document.createElement('div');
  el.id = 'pin-lock';
  el.innerHTML = `
    <div class="pin-logo" id="pin-logo"></div>
    <div class="pin-shop" id="pin-shop"></div>
    <div class="pin-msg" id="pin-msg"></div>
    <div class="pin-dots" id="pin-dots"><span></span><span></span><span></span><span></span></div>
    <div class="pin-pad">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(n => `<button type="button" data-k="${n}">${n}</button>`).join('')}
      <button type="button" class="ghost" data-k="cancel" id="pin-cancel"></button>
      <button type="button" data-k="0">0</button>
      <button type="button" class="ghost" data-k="back">⌫</button>
    </div>`;
  document.body.appendChild(el);
  const dots = document.getElementById('pin-dots');

  let mode = null;      // 'unlock' | 'verify' | 'new' | 'confirm'
  let after = null;     // 'change' | 'remove'
  let entry = '';
  let firstPin = '';
  let fails = 0;
  let blockedUntil = 0;
  let hiddenAt = 0;

  function setMsg(text, isError) {
    const m = document.getElementById('pin-msg');
    m.textContent = text;
    m.classList.toggle('err', !!isError);
  }
  function drawDots() { [...dots.children].forEach((d, i) => d.classList.toggle('on', i < entry.length)); }
  function render() {
    const a = getApp();
    const s = a && a.settings ? a.settings : {};
    document.getElementById('pin-shop').textContent = s.shopName || 'Billing POS';
    const logo = document.getElementById('pin-logo');
    logo.innerHTML = '';
    if (s.logo) { const img = new Image(); img.src = s.logo; img.alt = ''; logo.appendChild(img); } else logo.textContent = '🔒';
    setMsg(t({ unlock: 'enter', verify: 'current', new: 'newPin', confirm: 'confirmPin' }[mode]), false);
    const c = document.getElementById('pin-cancel');
    c.textContent = t('cancel');
    c.style.visibility = mode === 'unlock' ? 'hidden' : 'visible';
    drawDots();
  }
  function open(m) {
    mode = m;
    entry = '';
    render();
    el.classList.add('show');
    document.body.style.overflow = 'hidden';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  function close() {
    el.classList.remove('show');
    mode = null;
    entry = '';
    if (!document.querySelector('.sheet-backdrop.show')) document.body.style.overflow = '';
  }
  function error(msg) {
    entry = '';
    drawDots();
    setMsg(msg, true);
    dots.classList.remove('shake');
    void dots.offsetWidth;
    dots.classList.add('shake');
    if (navigator.vibrate) navigator.vibrate(150);
  }

  function press(k) {
    if (!mode) return;
    if (k === 'back') { entry = entry.slice(0, -1); drawDots(); return; }
    if (k === 'cancel') { if (mode !== 'unlock') close(); return; }
    if (Date.now() < blockedUntil) { setMsg(t('wait'), true); return; }
    if (entry.length >= 4) return;
    entry += k;
    drawDots();
    if (entry.length === 4) setTimeout(submit, 120);
  }

  async function submit() {
    const pin = entry;
    if (pin.length !== 4) return;
    if (mode === 'unlock' || mode === 'verify') {
      const ok = (await hash(pin)) === getHash();
      if (!ok) {
        fails++;
        if (fails >= 5) { fails = 0; blockedUntil = Date.now() + 30000; }
        error(Date.now() < blockedUntil ? t('wait') : t('wrong'));
        return;
      }
      fails = 0;
      if (mode === 'unlock') { close(); return; }
      if (after === 'remove') { localStorage.removeItem(KEY); close(); renderCard(); toast(t('removed')); return; }
      mode = 'new'; entry = ''; render();
      return;
    }
    if (mode === 'new') { firstPin = pin; mode = 'confirm'; entry = ''; render(); return; }
    if (mode === 'confirm') {
      if (pin !== firstPin) { mode = 'new'; firstPin = ''; error(t('mismatch')); return; }
      localStorage.setItem(KEY, await hash(pin));
      close();
      renderCard();
      toast(t('saved'));
    }
  }

  el.addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) press(b.dataset.k); });
  document.addEventListener('keydown', e => {
    if (!mode) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); press('back'); }
    else if (e.key === 'Escape') { e.preventDefault(); press('cancel'); }
  });

  /* ---------- Settings card ---------- */
  function renderCard() {
    const stack = document.querySelector('#view-settings .stack');
    if (!stack) return;
    let card = document.getElementById('pin-card');
    if (!card) {
      card = document.createElement('div');
      card.className = 'card';
      card.id = 'pin-card';
      stack.insertBefore(card, stack.lastElementChild);
      card.addEventListener('click', e => {
        const b = e.target.closest('[data-pin]');
        if (!b) return;
        if (b.dataset.pin === 'set') { firstPin = ''; after = null; open('new'); }
        else { after = b.dataset.pin; open('verify'); }
      });
    }
    const on = !!getHash();
    card.innerHTML = `
      <div class="card-title"><span>🔒 ${t('title')}</span><span class="count">${on ? 'ON' : 'OFF'}</span></div>
      <p class="hint">${t(on ? 'hintOn' : 'hintOff')}</p>
      ${on
        ? `<div class="grid-2 mt"><button class="btn btn-light" data-pin="change">${t('change')}</button><button class="btn btn-danger-light" data-pin="remove">${t('remove')}</button></div>`
        : `<button class="btn btn-primary btn-block mt" data-pin="set">${t('set')}</button>`}`;
  }
  document.addEventListener('click', e => { if (e.target.closest('#lang-switch button')) setTimeout(renderCard, 0); });

  /* ---------- Lock on open & after background ---------- */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (getHash() && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && mode !== 'unlock') open('unlock');
  });

  renderCard();
  if (getHash()) open('unlock');
})();