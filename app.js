/* ============ Billing POS - app.js ============ */
const UNITS = {
  kg:    { label: 'kg',    factor: 1,     per: 'kg' },
  g:     { label: 'g',     factor: 0.001, per: 'kg' },
  L:     { label: 'L',     factor: 1,     per: 'L' },
  ml:    { label: 'ml',    factor: 0.001, per: 'L' },
  pcs:   { label: 'pcs',   factor: 1,     per: 'pc' },
  dozen: { label: 'dozen', factor: 1,     per: 'dozen' },
  pkt:   { label: 'pkt',   factor: 1,     per: 'pkt' }
};
const PAY_MODES = ['Cash', 'UPI', 'Card', 'Credit'];
const RECEIPT_PAY = { Cash: 'Cash', UPI: 'UPI', Card: 'Card', Credit: 'Credit (Udhaar)' };
const KEYS = { settings: 'pos2_settings', bill: 'pos2_current', history: 'pos2_history', catalog: 'pos2_catalog' };
const DEFAULT_SETTINGS = {
  shopName: 'My Shop', address1: 'G.T. Road, Putlighar', address2: 'Amritsar, Punjab', phone: '', logo: '',
  receiptTitle: 'BILL / RECEIPT', footer: 'Thank you for visiting! Please come again.',
  prefix: 'INV-', startNo: 1, paper: '80', upiId: '', lang: 'en'
};
const STAMP_HTML = '<div class="r-stamp"><div class="r-stamp-ring"><div class="r-stamp-band">PAID</div></div></div>';
const TEXT = (typeof I18N !== 'undefined') ? I18N : { en: {} };

/* ============ Helpers ============ */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const plain = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => '₹' + plain(n);
const fmtQty = (q) => String(Number(Number(q).toFixed(3)));
const fmtRate = (r) => { r = Number(r) || 0; return Number.isInteger(r) ? String(r) : r.toFixed(2); };
const pad = (n, w) => String(n).padStart(w, '0');
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}T${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`;
const parseLocal = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : new Date();
};
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const unitOf = (u) => UNITS[u] || UNITS.pcs;
const itemAmount = (qty, unit, rate) => round2(qty * unitOf(unit).factor * rate);
const isTouch = () => window.matchMedia('(pointer: coarse)').matches;
const store = {
  get(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch (e) { return fallback; } },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } }
};

function amountInWords(amount) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  const three = (n) => [Math.floor(n / 100) ? ones[Math.floor(n / 100)] + ' Hundred' : '', n % 100 ? two(n % 100) : ''].filter(Boolean).join(' ');
  const words = (n) => {
    if (n === 0) return 'Zero';
    const parts = [];
    const crore = Math.floor(n / 10000000); n %= 10000000;
    const lakh = Math.floor(n / 100000); n %= 100000;
    const thousand = Math.floor(n / 1000); n %= 1000;
    if (crore) parts.push(words(crore) + ' Crore');
    if (lakh) parts.push(two(lakh) + ' Lakh');
    if (thousand) parts.push(two(thousand) + ' Thousand');
    if (n) parts.push(three(n));
    return parts.join(' ');
  };
  const totalPaise = Math.round((Number(amount) || 0) * 100);
  const rupees = Math.floor(totalPaise / 100), paise = totalPaise % 100;
  let out = 'Rupees ' + words(rupees);
  if (paise) out += ' and ' + two(paise) + ' Paise';
  return out + ' Only';
}

/* ============ App ============ */
class POSApp {
  constructor() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, store.get(KEYS.settings, {}));
    this.history = store.get(KEYS.history, []);
    this.catalog = store.get(KEYS.catalog, []);
    if (!Array.isArray(this.history)) this.history = [];
    if (!Array.isArray(this.catalog)) this.catalog = [];
    const saved = store.get(KEYS.bill, null);
    this.bill = (saved && Array.isArray(saved.items)) ? saved : this.createBill();
    if (!this.bill.items.length) { this.bill.date = toLocalInput(new Date()); this.renumberIfEmpty(); }
    this.reportPeriod = 'today';
    this.editingId = null;
    this.viewingBillId = null;
    this.toastTimer = null;
    this.toastAction = null;
    this._raf = null;
    this._lastHtml = null;
    this._qr = null;

    this.fillUnitSelects();
    this.bindEvents();
    this.applyLanguage();
    this.loadBillIntoForm();
    this.renderAll();
    this.switchTab('bill');
  }

  /* ---------- Language ---------- */
  t(key) { const L = TEXT[this.settings.lang] || TEXT.en || {}; return L[key] ?? (TEXT.en || {})[key] ?? key; }
  payLabel(m) { return this.t('pay_' + m); }
  uiLocale() { return this.settings.lang === 'pa' ? 'pa-IN' : 'en-IN'; }
  applyLanguage() {
    document.documentElement.lang = this.settings.lang === 'pa' ? 'pa' : 'en';
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = this.t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = this.t(el.dataset.i18nPh); });
    this.updateRateLabels();
    this.updateAddButton();
  }
  setLanguage(lang) { this.settings.lang = lang; this.saveSettings(); this.applyLanguage(); this.renderAll(); }

  /* ---------- Bill numbers & totals ---------- */
  nextSeq() {
    const maxSeq = this.history.reduce((m, b) => Math.max(m, Number(b.seq) || 0), 0);
    return Math.max(Number(this.settings.startNo) || 1, maxSeq + 1);
  }
  formatNo(seq) { return (this.settings.prefix || '') + pad(seq, 4); }
  createBill() {
    const seq = this.nextSeq();
    return { id: uid(), seq, no: this.formatNo(seq), date: toLocalInput(new Date()), customerName: '', customerPhone: '', items: [], discountVal: '', discountType: 'percent', payMode: 'Cash', paid: false };
  }
  renumberIfEmpty() {
    if (this.bill.items.length) return;
    this.bill.seq = this.nextSeq();
    this.bill.no = this.formatNo(this.bill.seq);
  }
  calc(bill) {
    const subtotal = round2(bill.items.reduce((s, it) => s + (Number(it.amount) || 0), 0));
    const val = parseFloat(bill.discountVal) || 0;
    let discount = bill.discountType === 'fixed' ? val : subtotal * val / 100;
    discount = round2(Math.min(Math.max(discount, 0), subtotal));
    return { subtotal, discount, total: round2(subtotal - discount), count: bill.items.length };
  }

  /* ---------- Saving ---------- */
  syncHistory() {
    const idx = this.history.findIndex(b => b.id === this.bill.id);
    if (this.bill.items.length) {
      const copy = JSON.parse(JSON.stringify(this.bill));
      if (idx >= 0) this.history[idx] = copy; else this.history.push(copy);
    } else if (idx >= 0) {
      this.history.splice(idx, 1);
    }
  }
  persist() {
    this.syncHistory();
    const ok = store.set(KEYS.bill, this.bill) && store.set(KEYS.history, this.history) && store.set(KEYS.catalog, this.catalog);
    if (!ok) this.toast(this.t('storageFull'), null, null, 6000);
  }
  saveSettings() { if (!store.set(KEYS.settings, this.settings)) this.toast(this.t('storageFull'), null, null, 6000); }

  /* ---------- Events ---------- */
  fillUnitSelects() {
    const opts = Object.keys(UNITS).map(k => `<option value="${k}">${UNITS[k].label}</option>`).join('');
    $('f-unit').innerHTML = opts;
    $('e-unit').innerHTML = opts;
    $('f-unit').value = 'kg';
  }

  bindEvents() {
    document.querySelectorAll('button[data-tab]').forEach(b => b.addEventListener('click', () => this.switchTab(b.dataset.tab)));
    $('btn-new-bill').addEventListener('click', () => this.newBill());
    $('setup-go').addEventListener('click', () => this.switchTab('settings'));

    // Item entry: Enter moves Item -> Qty -> Rate -> Add
    const name = $('f-name'), qty = $('f-qty'), unit = $('f-unit'), rate = $('f-rate');
    name.addEventListener('input', () => this.showSuggestions());
    name.addEventListener('focus', () => this.showSuggestions());
    name.addEventListener('blur', () => setTimeout(() => { this.hideSuggestions(); this.autoFillExact(); }, 150));
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.hideSuggestions(); this.autoFillExact(); qty.focus(); } });
    qty.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); rate.focus(); } });
    rate.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.addItem(); } });
    qty.addEventListener('input', () => this.updateAddButton());
    rate.addEventListener('input', () => this.updateAddButton());
    unit.addEventListener('change', () => { this.updateRateLabels(); this.updateAddButton(); });
    $('btn-add').addEventListener('click', () => this.addItem());
    const pick = e => { const b = e.target.closest('button[data-name]'); if (b) this.pickCatalog(b.dataset.name); };
    $('suggest').addEventListener('mousedown', e => e.preventDefault());
    $('suggest').addEventListener('click', pick);
    $('quick-chips').addEventListener('click', pick);

    $('items-list').addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (del) { this.removeItem(del.dataset.del); return; }
      const ed = e.target.closest('[data-edit]');
      if (ed) this.openEdit(ed.dataset.edit);
    });

    // Bill details
    const bind = (id, ev, fn) => $(id).addEventListener(ev, e => { fn(e.target); this.onBillChanged(); });
    bind('f-cust', 'input', el => { this.bill.customerName = el.value; });
    bind('f-phone', 'input', el => { this.bill.customerPhone = el.value; });
    bind('f-disc', 'input', el => { this.bill.discountVal = el.value; });
    bind('f-disc-type', 'change', el => { this.bill.discountType = el.value; });
    bind('f-date', 'change', el => { this.bill.date = el.value || toLocalInput(new Date()); });
    bind('f-paid', 'change', el => { this.bill.paid = el.checked; });
    $('pay-modes').addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]'); if (!b) return;
      this.bill.payMode = b.dataset.mode;
      if (b.dataset.mode === 'Credit') { this.bill.paid = false; $('f-paid').checked = false; }
      this.renderPayModes();
      this.onBillChanged();
    });

    // Bottom action bar
    $('btn-print').addEventListener('click', () => this.printBill(this.bill));
    $('btn-share').addEventListener('click', () => this.shareBill(this.bill));
    $('btn-wa').addEventListener('click', () => this.sendWhatsApp(this.bill));

    // Edit item popup
    $('e-save').addEventListener('click', () => this.saveEdit());
    $('e-cancel').addEventListener('click', () => this.closeSheet('edit-sheet'));
    $('e-delete').addEventListener('click', () => { const id = this.editingId; this.closeSheet('edit-sheet'); this.removeItem(id); });
    $('e-unit').addEventListener('change', () => this.updateRateLabels());
    ['e-name', 'e-qty', 'e-rate'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.saveEdit(); } }));
    document.querySelectorAll('.sheet-backdrop').forEach(bd => bd.addEventListener('click', e => { if (e.target === bd) this.closeSheet(bd.id); }));

    // Old bill popup
    $('bs-close').addEventListener('click', () => this.closeSheet('bill-sheet'));
    $('bs-print').addEventListener('click', () => { const b = this.viewingBill(); if (b) this.printBill(b); });
    $('bs-share').addEventListener('click', () => { const b = this.viewingBill(); if (b) this.shareBill(b); });
    $('bs-wa').addEventListener('click', () => { const b = this.viewingBill(); if (b) this.sendWhatsApp(b); });
    $('bs-open').addEventListener('click', () => this.openBillForEdit(this.viewingBillId));
    $('bs-delete').addEventListener('click', () => this.deleteBill(this.viewingBillId));

    // History & reports
    $('h-search').addEventListener('input', () => this.renderHistory());
    $('history-list').addEventListener('click', e => { const c = e.target.closest('[data-bill]'); if (c) this.viewBill(c.dataset.bill); });
    $('report-periods').addEventListener('click', e => { const b = e.target.closest('button[data-period]'); if (b) { this.reportPeriod = b.dataset.period; this.renderReports(); } });
    $('report-body').addEventListener('click', e => { if (e.target.closest('#btn-export')) this.exportCSV(); });

    // Settings (auto-save)
    document.querySelectorAll('[data-setting]').forEach(el => {
      const key = el.dataset.setting;
      el.addEventListener('change', () => this.updateSetting(key, el.value));
      if (el.tagName === 'INPUT' && !['upiId', 'startNo', 'prefix'].includes(key)) {
        el.addEventListener('input', () => { this.settings[key] = el.value; this.saveSettings(); this.scheduleOutputs(); });
      }
    });
    $('btn-logo').addEventListener('click', () => $('logo-input').click());
    $('logo-input').addEventListener('change', e => this.uploadLogo(e.target));
    $('btn-logo-remove').addEventListener('click', () => { this.settings.logo = ''; this.saveSettings(); this.renderSettings(); this.scheduleOutputs(); });
    $('lang-switch').addEventListener('click', e => { const b = e.target.closest('button[data-lang]'); if (b) this.setLanguage(b.dataset.lang); });
    $('saved-items').addEventListener('click', e => { const b = e.target.closest('[data-del-cat]'); if (b) this.deleteCatalog(b.dataset.delCat); });
    $('btn-backup').addEventListener('click', () => this.backup());
    $('btn-restore').addEventListener('click', () => $('restore-input').click());
    $('restore-input').addEventListener('change', e => this.restore(e.target));

    // General
    $('toast-btn').addEventListener('click', () => { const fn = this.toastAction; this.hideToast(); if (fn) fn(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.sheet-backdrop.show').forEach(s => this.closeSheet(s.id)); });
    window.addEventListener('afterprint', () => { this._lastHtml = null; this.renderBillOutputs(); });
    window.addEventListener('load', () => { this._lastHtml = null; this.renderBillOutputs(); });
    if (window.visualViewport) {
      const vv = window.visualViewport;
      vv.addEventListener('resize', () => document.body.classList.toggle('kb-open', vv.scale <= 1.05 && vv.height < window.innerHeight * 0.75));
    }
  }

  /* ---------- Navigation, popups, messages ---------- */
  switchTab(tab) {
    if (tab === 'preview' && window.matchMedia('(min-width: 900px)').matches) tab = 'bill';
    document.body.dataset.tab = tab;
    document.querySelectorAll('button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'history') this.renderHistory();
    if (tab === 'reports') this.renderReports();
    if (tab === 'settings') this.renderSettings();
    window.scrollTo(0, 0);
  }
  openSheet(id) { $(id).classList.add('show'); document.body.style.overflow = 'hidden'; }
  closeSheet(id) { $(id).classList.remove('show'); if (!document.querySelector('.sheet-backdrop.show')) document.body.style.overflow = ''; }
  toast(msg, actionLabel, actionFn, ms) {
    $('toast-msg').textContent = msg;
    const btn = $('toast-btn');
    this.toastAction = actionFn || null;
    btn.hidden = !actionFn;
    if (actionFn) btn.textContent = actionLabel;
    $('toast').classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.hideToast(), ms || (actionFn ? 5000 : 2200));
  }
  hideToast() { clearTimeout(this.toastTimer); $('toast').classList.remove('show'); this.toastAction = null; }

  /* ---------- Rendering ---------- */
  renderAll() {
    this.renderItems();
    this.renderChips();
    this.renderPayModes();
    this._lastHtml = null;
    this.renderBillOutputs();
    this.renderSettings();
    const tab = document.body.dataset.tab;
    if (tab === 'history') this.renderHistory();
    if (tab === 'reports') this.renderReports();
  }
  scheduleOutputs() { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = null; this.renderBillOutputs(); }); }
  flushOutputs() { if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; } this.renderBillOutputs(); }
  renderBillOutputs() {
    const tot = this.calc(this.bill);
    const html = this.receiptHTML(this.bill);
    if (html !== this._lastHtml) {
      $('receipt-preview').innerHTML = html;
      $('render-area').innerHTML = this.receiptHTML(this.bill, true);
      this._lastHtml = html;
    }
    $('bar-total').textContent = money(tot.total);
    $('bar-count').textContent = tot.count;
    $('items-count').textContent = tot.count ? `${tot.count} · ${money(tot.subtotal)}` : '';
    $('hdr-shop').textContent = this.settings.shopName || DEFAULT_SETTINGS.shopName;
    $('hdr-bill').textContent = `${this.t('billNo')} ${this.bill.no}`;
    $('setup-card').hidden = this.settings.shopName !== DEFAULT_SETTINGS.shopName;
  }
  loadBillIntoForm() {
    $('f-cust').value = this.bill.customerName || '';
    $('f-phone').value = this.bill.customerPhone || '';
    $('f-disc').value = this.bill.discountVal || '';
    $('f-disc-type').value = this.bill.discountType || 'percent';
    $('f-date').value = this.bill.date;
    $('f-paid').checked = !!this.bill.paid;
    this.renderPayModes();
  }
  renderPayModes() {
    $('pay-modes').innerHTML = PAY_MODES.map(m => `<button type="button" data-mode="${m}" class="${this.bill.payMode === m ? 'active' : ''}">${esc(this.payLabel(m))}</button>`).join('');
  }
  renderItems() {
    const list = $('items-list');
    if (!this.bill.items.length) { list.innerHTML = `<div class="empty">${esc(this.t('noItems'))}</div>`; return; }
    list.innerHTML = this.bill.items.map((it, i) => {
      const u = unitOf(it.unit);
      return `<div class="item-row">
        <button class="item-main" data-edit="${esc(it.id)}">
          <span class="item-text"><span class="item-name">${i + 1}. ${esc(it.name)}</span>
          <span class="item-meta">${fmtQty(it.qty)} ${u.label} × ₹${fmtRate(it.rate)}/${u.per}</span></span>
          <span class="item-amt">${money(it.amount)}</span>
        </button>
        <button class="icon-btn" data-del="${esc(it.id)}" aria-label="${esc(this.t('delete'))}"><svg class="ic"><use href="#i-x"/></svg></button>
      </div>`;
    }).join('');
  }
  renderChips() {
    const top = [...this.catalog].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 12);
    $('quick-wrap').hidden = !top.length;
    $('quick-chips').innerHTML = top.map(c => `<button class="chip" data-name="${esc(c.name)}">${esc(c.name)}<small>₹${fmtRate(c.rate)}/${unitOf(c.unit).per}</small></button>`).join('');
  }

  /* ---------- Item entry ---------- */
  showSuggestions() {
    const q = $('f-name').value.trim().toLowerCase();
    if (!q) { this.hideSuggestions(); return; }
    const starts = (c) => c.name.toLowerCase().startsWith(q) ? 0 : 1;
    const matches = this.catalog.filter(c => c.name.toLowerCase().includes(q))
      .sort((a, b) => starts(a) - starts(b) || (b.count || 0) - (a.count || 0)).slice(0, 6);
    if (!matches.length) { this.hideSuggestions(); return; }
    $('suggest').innerHTML = matches.map(c => `<button type="button" data-name="${esc(c.name)}"><span>${esc(c.name)}</span><small>₹${fmtRate(c.rate)}/${unitOf(c.unit).per}</small></button>`).join('');
    $('suggest').classList.add('show');
  }
  hideSuggestions() { $('suggest').classList.remove('show'); }
  pickCatalog(name) {
    const c = this.catalog.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    if (!c) return;
    $('f-name').value = c.name;
    $('f-unit').value = UNITS[c.unit] ? c.unit : 'pcs';
    $('f-rate').value = c.rate;
    $('f-qty').value = '';
    this.hideSuggestions();
    this.updateRateLabels();
    this.updateAddButton();
    $('f-qty').focus();
  }
  autoFillExact() {
    const name = $('f-name').value.trim().toLowerCase();
    if (!name || $('f-rate').value) return;
    const c = this.catalog.find(x => x.name.toLowerCase() === name);
    if (!c) return;
    $('f-unit').value = UNITS[c.unit] ? c.unit : 'pcs';
    $('f-rate').value = c.rate;
    this.updateRateLabels();
    this.updateAddButton();
  }
  updateRateLabels() {
    [['f-rate-label', 'f-unit'], ['e-rate-label', 'e-unit']].forEach(([labelId, unitId]) => {
      $(labelId).textContent = `${this.t('rate')} (₹/${unitOf($(unitId).value || 'kg').per})`;
    });
  }
  updateAddButton() {
    const qty = parseFloat($('f-qty').value), rate = parseFloat($('f-rate').value);
    const ok = qty > 0 && rate >= 0;
    $('btn-add-label').textContent = ok ? `${this.t('addItem')} · ${money(itemAmount(qty, $('f-unit').value, rate))}` : this.t('addItem');
  }
  addItem() {
    this.autoFillExact();
    const name = $('f-name').value.trim();
    const qty = parseFloat($('f-qty').value);
    const rate = parseFloat($('f-rate').value);
    const unit = $('f-unit').value;
    if (!name) { this.toast(this.t('enterName')); $('f-name').focus(); return; }
    if (!(qty > 0)) { this.toast(this.t('enterQty')); $('f-qty').focus(); return; }
    if (isNaN(rate) || rate < 0) { this.toast(this.t('enterRate')); $('f-rate').focus(); return; }
    this.bill.items.push({ id: uid(), name, qty, unit, rate, amount: itemAmount(qty, unit, rate) });
    this.rememberItem(name, unit, rate);
    $('f-name').value = '';
    $('f-qty').value = '';
    $('f-rate').value = '';
    this.hideSuggestions();
    this.updateAddButton();
    this.onItemsChanged();
    this.toast(`✓ ${this.t('added')}: ${name}`);
    $('f-name').focus();
  }
  rememberItem(name, unit, rate) {
    const c = this.catalog.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (c) { c.name = name; c.unit = unit; c.rate = rate; c.count = (c.count || 0) + 1; c.last = Date.now(); }
    else this.catalog.push({ name, unit, rate, count: 1, last: Date.now() });
  }
  removeItem(id) {
    const idx = this.bill.items.findIndex(it => it.id === id);
    if (idx < 0) return;
    const [removed] = this.bill.items.splice(idx, 1);
    const billId = this.bill.id;
    this.onItemsChanged();
    this.toast(`${this.t('removed')}: ${removed.name}`, this.t('undo'), () => {
      if (this.bill.id !== billId) return;
      this.bill.items.splice(Math.min(idx, this.bill.items.length), 0, removed);
      this.onItemsChanged();
    });
  }
  openEdit(id) {
    const it = this.bill.items.find(x => x.id === id);
    if (!it) return;
    this.editingId = id;
    $('e-name').value = it.name;
    $('e-qty').value = it.qty;
    $('e-unit').value = UNITS[it.unit] ? it.unit : 'pcs';
    $('e-rate').value = it.rate;
    this.updateRateLabels();
    this.openSheet('edit-sheet');
  }
  saveEdit() {
    const it = this.bill.items.find(x => x.id === this.editingId);
    if (!it) { this.closeSheet('edit-sheet'); return; }
    const name = $('e-name').value.trim(), qty = parseFloat($('e-qty').value), rate = parseFloat($('e-rate').value), unit = $('e-unit').value;
    if (!name) { this.toast(this.t('enterName')); return; }
    if (!(qty > 0)) { this.toast(this.t('enterQty')); return; }
    if (isNaN(rate) || rate < 0) { this.toast(this.t('enterRate')); return; }
    Object.assign(it, { name, qty, unit, rate, amount: itemAmount(qty, unit, rate) });
    const c = this.catalog.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (c) { c.rate = rate; c.unit = unit; } else this.catalog.push({ name, unit, rate, count: 1, last: Date.now() });
    this.closeSheet('edit-sheet');
    this.onItemsChanged();
  }
  onItemsChanged() { this.persist(); this.renderItems(); this.renderChips(); this.scheduleOutputs(); }
  onBillChanged() { this.persist(); this.scheduleOutputs(); }
  newBill() {
    if (this.bill.items.length) {
      const savedNo = this.bill.no;
      this.persist();
      this.bill = this.createBill();
      this.toast(`${this.t('billSaved')} (${savedNo})`);
    } else {
      this.bill.date = toLocalInput(new Date());
      this.renumberIfEmpty();
    }
    this.persist();
    this.loadBillIntoForm();
    this.renderItems();
    this.scheduleOutputs();
    this.switchTab('bill');
  }

  /* ---------- Receipt ---------- */
  receiptHTML(bill, flat = false) {
    const s = this.settings, t = this.calc(bill), d = parseLocal(bill.date);
    const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const items = bill.items.map((it, i) => {
      const u = unitOf(it.unit);
      return `<div class="r-item"><div class="r-item-name">${i + 1}. ${esc(it.name)}</div><div class="r-item-line"><span>${fmtQty(it.qty)} ${u.label} x ${fmtRate(it.rate)}/${u.per}</span><span>${plain(it.amount)}</span></div></div>`;
    }).join('');
    const qr = (s.upiId && !bill.paid && t.total > 0)
      ? this.qrDataURL(`upi://pay?pa=${s.upiId}&pn=${encodeURIComponent(s.shopName || 'Shop')}&am=${t.total.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Bill ' + bill.no)}`)
      : '';
    const discLabel = bill.discountType === 'percent' ? ` (${fmtQty(parseFloat(bill.discountVal) || 0)}%)` : '';
    return `<div class="receipt${s.paper === '58' ? ' p58' : ''}${flat ? ' flat' : ''}">
<div class="r-center">
${s.logo ? `<img class="r-logo" src="${esc(s.logo)}" alt="">` : ''}
<div class="r-shop">${esc(s.shopName)}</div>
${s.address1 ? `<div class="r-small">${esc(s.address1)}</div>` : ''}
${s.address2 ? `<div class="r-small">${esc(s.address2)}</div>` : ''}
${s.phone ? `<div class="r-small">Ph: ${esc(s.phone)}</div>` : ''}
</div>
<div class="r-div"></div>
${s.receiptTitle ? `<div class="r-center r-title">${esc(s.receiptTitle)}</div><div class="r-div"></div>` : ''}
<div class="r-row"><span>Bill No:</span><span><b>${esc(bill.no)}</b></span></div>
<div class="r-row"><span>Date:</span><span>${date} ${time}</span></div>
${bill.customerName ? `<div class="r-row"><span>Customer:</span><span>${esc(bill.customerName)}</span></div>` : ''}
${bill.customerPhone ? `<div class="r-row"><span>Phone:</span><span>${esc(bill.customerPhone)}</span></div>` : ''}
<div class="r-div"></div>
<div class="r-items">
<div class="r-head"><span>Item / Qty x Rate</span><span>Amount</span></div>
${items}
${bill.paid ? STAMP_HTML : ''}
</div>
<div class="r-div"></div>
<div class="r-row"><span>Subtotal (${t.count} items):</span><span>${money(t.subtotal)}</span></div>
${t.discount > 0 ? `<div class="r-row"><span>Discount${discLabel}:</span><span>-${money(t.discount)}</span></div>` : ''}
<div class="r-total"><span>TOTAL</span><span>${money(t.total)}</span></div>
<div class="r-words">${esc(amountInWords(t.total))}</div>
<div class="r-row" style="margin-top:4px"><span>Payment:</span><span>${esc(RECEIPT_PAY[bill.payMode] || bill.payMode)}${bill.paid ? ' - PAID' : ''}</span></div>
${qr ? `<div class="r-div"></div><div class="r-qr r-center"><div class="r-small"><b>Scan &amp; Pay ${money(t.total)}</b></div><img src="${qr}" alt="UPI QR"><div class="r-small">UPI: ${esc(s.upiId)}</div></div>` : ''}
${s.footer ? `<div class="r-div"></div><div class="r-foot">${esc(s.footer)}</div>` : ''}
</div>`;
  }
  qrDataURL(text) {
    if (typeof qrcode === 'undefined') return '';
    if (this._qr && this._qr.text === text) return this._qr.url;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const url = qr.createDataURL(4, 2);
      this._qr = { text, url };
      return url;
    } catch (e) { return ''; }
  }

  /* ---------- Print / Share / WhatsApp ---------- */
  async prepareArea(bill) {
    if (bill.id === this.bill.id) this.flushOutputs();
    else { $('render-area').innerHTML = this.receiptHTML(bill, true); this._lastHtml = null; }
    const el = $('render-area').firstElementChild;
    await Promise.all([...el.querySelectorAll('img')].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
    return el;
  }
  async printBill(bill) {
    if (!bill.items.length) { this.toast(this.t('emptyBill')); return; }
    await this.prepareArea(bill);
    window.print();
  }
  async shareBill(bill) {
    if (!bill.items.length) { this.toast(this.t('emptyBill')); return; }
    if (typeof html2canvas === 'undefined') { this.toast(this.t('needInternet')); return; }
    this.toast(this.t('making'), null, null, 20000);
    let blob = null;
    try {
      const el = await this.prepareArea(bill);
      const canvas = await html2canvas(el, {
        scale: 3, backgroundColor: '#ffffff', useCORS: true, logging: false,
        onclone: doc => { const a = doc.getElementById('render-area'); if (a) a.style.left = '0px'; }
      });
      blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    } catch (e) { blob = null; }
    if (bill.id !== this.bill.id) { this._lastHtml = null; this.renderBillOutputs(); }
    this.hideToast();
    if (!blob) { this.toast(this.t('shareFail')); return; }
    await this.deliverFile(blob, `${bill.no}.png`, `${this.settings.shopName} - ${bill.no}`);
  }
  async deliverFile(blob, fileName, title) {
    const file = new File([blob], fileName, { type: blob.type });
    if (isTouch() && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); return; }
      catch (err) {
        if (err.name === 'AbortError') return;
        if (err.name === 'NotAllowedError') {
          this.toast(this.t('tapToShare'), this.t('share'), () => navigator.share({ files: [file], title }).catch(() => {}), 10000);
          return;
        }
      }
    }
    this.downloadBlob(blob, fileName);
  }
  downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  sendWhatsApp(bill) {
    if (!bill.items.length) { this.toast(this.t('emptyBill')); return; }
    const s = this.settings, t = this.calc(bill), d = parseLocal(bill.date);
    const lines = [`*${s.shopName}*`, `Bill No: ${bill.no}`,
      `Date: ${d.toLocaleDateString('en-IN')} ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`];
    if (bill.customerName) lines.push(`Customer: ${bill.customerName}`);
    lines.push('------------------------');
    bill.items.forEach((it, i) => {
      const u = unitOf(it.unit);
      lines.push(`${i + 1}. ${it.name} - ${fmtQty(it.qty)} ${u.label} x ₹${fmtRate(it.rate)}/${u.per} = ${money(it.amount)}`);
    });
    lines.push('------------------------');
    if (t.discount > 0) { lines.push(`Subtotal: ${money(t.subtotal)}`); lines.push(`Discount: -${money(t.discount)}`); }
    lines.push(`*Total: ${money(t.total)}*`);
    lines.push(`Payment: ${RECEIPT_PAY[bill.payMode] || bill.payMode}${bill.paid ? ' (PAID)' : ''}`);
    if (s.upiId && !bill.paid && t.total > 0) lines.push(`Pay via UPI: ${s.upiId}`);
    if (s.footer) lines.push('', s.footer);
    window.open(`https://wa.me/${this.waPhone(bill.customerPhone)}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
  }
  waPhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 10) d = '91' + d;
    return d;
  }

  /* ---------- History ---------- */
  renderHistory() {
    const q = $('h-search').value.trim().toLowerCase();
    const bills = [...this.history]
      .sort((a, b) => parseLocal(b.date) - parseLocal(a.date) || (b.seq || 0) - (a.seq || 0))
      .filter(b => !q || String(b.no).toLowerCase().includes(q) || String(b.customerName || '').toLowerCase().includes(q) || String(b.customerPhone || '').includes(q));
    if (!bills.length) { $('history-list').innerHTML = `<div class="card empty mt14">${esc(this.t(q ? 'noResults' : 'noHistory'))}</div>`; return; }
    let html = '', lastDay = '';
    bills.forEach(b => {
      const d = parseLocal(b.date), tot = this.calc(b);
      const day = d.toLocaleDateString(this.uiLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      if (day !== lastDay) { html += `<div class="date-head">${esc(day)}</div>`; lastDay = day; }
      const badges = (b.id === this.bill.id ? `<span class="badge cur">${esc(this.t('current'))}</span>` : '')
        + (b.payMode === 'Credit' ? `<span class="badge credit">${esc(this.payLabel('Credit'))}</span>` : '');
      const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      html += `<button class="bill-card" data-bill="${esc(b.id)}">
        <span class="b-left"><span class="b-no">${esc(b.no)}${badges}</span>
        <span class="b-meta">${time} · ${tot.count} ${esc(this.t('itemsCount'))}${b.customerName ? ' · ' + esc(b.customerName) : ''}</span></span>
        <span class="b-right"><span class="b-amt">${money(tot.total)}</span><span class="b-meta">${esc(this.payLabel(b.payMode || 'Cash'))}</span></span>
      </button>`;
    });
    $('history-list').innerHTML = html;
  }
  viewBill(id) {
    const b = this.history.find(x => x.id === id);
    if (!b) return;
    this.viewingBillId = id;
    $('bs-title').textContent = b.no;
    $('bs-receipt').innerHTML = this.receiptHTML(b);
    this.openSheet('bill-sheet');
  }
  viewingBill() { return this.history.find(x => x.id === this.viewingBillId); }
  openBillForEdit(id) {
    const b = this.history.find(x => x.id === id);
    if (!b) return;
    if (this.bill.id !== id) { this.persist(); this.bill = JSON.parse(JSON.stringify(b)); this.persist(); }
    this.closeSheet('bill-sheet');
    this.loadBillIntoForm();
    this.renderItems();
    this._lastHtml = null;
    this.renderBillOutputs();
    this.switchTab('bill');
  }
  deleteBill(id) {
    if (!confirm(this.t('confirmDeleteBill'))) return;
    this.history = this.history.filter(b => b.id !== id);
    if (this.bill.id === id) { this.bill = this.createBill(); this.loadBillIntoForm(); }
    this.persist();
    this.closeSheet('bill-sheet');
    this.renderItems();
    this._lastHtml = null;
    this.renderBillOutputs();
    this.renderHistory();
    this.toast(this.t('deleted'));
  }

  /* ---------- Reports ---------- */
  periodRange(p) {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    if (p === 'today') return [new Date(y, m, d), new Date(y, m, d + 1)];
    if (p === 'week') { const dow = (now.getDay() + 6) % 7; return [new Date(y, m, d - dow), new Date(y, m, d - dow + 7)]; }
    if (p === 'month') return [new Date(y, m, 1), new Date(y, m + 1, 1)];
    if (p === 'lastMonth') return [new Date(y, m - 1, 1), new Date(y, m, 1)];
    return [new Date(1970, 0, 1), new Date(9999, 0, 1)];
  }
  billsInPeriod() {
    const [from, to] = this.periodRange(this.reportPeriod);
    return this.history.filter(b => { const d = parseLocal(b.date); return d >= from && d < to; });
  }
  renderReports() {
    const periods = ['today', 'week', 'month', 'lastMonth', 'all'];
    $('report-periods').innerHTML = periods.map(p => `<button class="chip${p === this.reportPeriod ? ' active' : ''}" data-period="${p}">${esc(this.t('p_' + p))}</button>`).join('');
    const [from, to] = this.periodRange(this.reportPeriod);
    const fmtD = (d) => d.toLocaleDateString(this.uiLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
    $('report-range').textContent = this.reportPeriod === 'all' ? '' : this.reportPeriod === 'today' ? fmtD(from) : `${fmtD(from)} – ${fmtD(new Date(to - 1))}`;
    const bills = this.billsInPeriod();
    if (!bills.length) { $('report-body').innerHTML = `<div class="card empty">${esc(this.t('noData'))}</div>`; return; }
    let gross = 0, disc = 0, net = 0;
    const byMode = {}, items = {};
    bills.forEach(b => {
      const t = this.calc(b);
      gross += t.subtotal; disc += t.discount; net += t.total;
      const mode = b.payMode || 'Cash';
      byMode[mode] = byMode[mode] || { count: 0, amount: 0 };
      byMode[mode].count++; byMode[mode].amount += t.total;
      b.items.forEach(it => {
        const k = String(it.name).toLowerCase();
        items[k] = items[k] || { name: it.name, times: 0, amount: 0 };
        items[k].times++; items[k].amount += Number(it.amount) || 0;
      });
    });
    const top = Object.values(items).sort((a, b) => b.amount - a.amount).slice(0, 10);
    const stat = (label, val, big) => `<div class="stat${big ? ' big' : ''}"><div class="s-label">${esc(this.t(label))}</div><div class="s-val">${val}</div></div>`;
    $('report-body').innerHTML = `
      <div class="stats">
        ${stat('netTotal', money(net), true)}
        ${stat('bills', bills.length)}
        ${stat('avgBill', money(net / bills.length))}
        ${stat('gross', money(gross))}
        ${stat('discountGiven', money(disc))}
      </div>
      <div class="card mt14"><div class="card-title">${esc(this.t('byPayment'))}</div>
        ${PAY_MODES.filter(m => byMode[m]).map(m => `<div class="list-row"><span>${esc(this.payLabel(m))} <span class="muted">· ${byMode[m].count} ${esc(this.t('bills'))}</span></span><strong>${money(byMode[m].amount)}</strong></div>`).join('')}
      </div>
      <div class="card mt14"><div class="card-title">${esc(this.t('topItems'))}</div>
        ${top.map((it, i) => `<div class="list-row"><span>${i + 1}. ${esc(it.name)} <span class="muted">· ${it.times}×</span></span><strong>${money(it.amount)}</strong></div>`).join('')}
      </div>
      <button class="btn btn-primary btn-block mt14" id="btn-export"><svg class="ic"><use href="#i-download"/></svg>${esc(this.t('exportExcel'))}</button>`;
  }
  exportCSV() {
    const bills = this.billsInPeriod().sort((a, b) => parseLocal(a.date) - parseLocal(b.date));
    if (!bills.length) { this.toast(this.t('noData')); return; }
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Bill No', 'Date', 'Time', 'Customer', 'Phone', 'Items', 'Subtotal', 'Discount', 'Total', 'Payment', 'Paid']];
    let sumSub = 0, sumDisc = 0, sumTotal = 0;
    bills.forEach(b => {
      const d = parseLocal(b.date), t = this.calc(b);
      sumSub += t.subtotal; sumDisc += t.discount; sumTotal += t.total;
      rows.push([b.no, d.toLocaleDateString('en-IN'), d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
        b.customerName, b.customerPhone,
        b.items.map(it => `${it.name} ${fmtQty(it.qty)}${unitOf(it.unit).label} x ${fmtRate(it.rate)}`).join('; '),
        t.subtotal.toFixed(2), t.discount.toFixed(2), t.total.toFixed(2), RECEIPT_PAY[b.payMode] || b.payMode, b.paid ? 'Yes' : 'No']);
    });
    rows.push(['TOTAL', '', '', '', '', '', sumSub.toFixed(2), sumDisc.toFixed(2), sumTotal.toFixed(2), '', '']);
    const csv = '\uFEFF' + rows.map(r => r.map(q).join(',')).join('\r\n');
    this.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `Report_${this.reportPeriod}_${toLocalInput(new Date()).slice(0, 10)}.csv`);
  }

  /* ---------- Settings ---------- */
  renderSettings() {
    document.querySelectorAll('[data-setting]').forEach(el => {
      if (el !== document.activeElement) el.value = this.settings[el.dataset.setting] ?? '';
    });
    $('logo-preview').innerHTML = this.settings.logo ? `<img src="${esc(this.settings.logo)}" alt="">` : esc(this.t('noLogo'));
    $('btn-logo-remove').hidden = !this.settings.logo;
    document.querySelectorAll('#lang-switch button').forEach(b => b.classList.toggle('active', b.dataset.lang === this.settings.lang));
    const list = [...this.catalog].sort((a, b) => a.name.localeCompare(b.name));
    $('saved-count').textContent = list.length || '';
    $('saved-items').innerHTML = list.length
      ? list.map(c => `<div class="item-row"><span class="item-text"><span class="item-name">${esc(c.name)}</span><span class="item-meta">₹${fmtRate(c.rate)}/${unitOf(c.unit).per} · ${c.count || 0}×</span></span><button class="icon-btn" data-del-cat="${esc(c.name)}" aria-label="${esc(this.t('delete'))}"><svg class="ic"><use href="#i-x"/></svg></button></div>`).join('')
      : `<div class="empty">${esc(this.t('noSavedItems'))}</div>`;
  }
  updateSetting(key, raw) {
    let value = typeof raw === 'string' ? raw.trim() : raw;
    if (key === 'startNo') value = Math.max(1, parseInt(value, 10) || 1);
    if (key === 'upiId') {
      value = value.replace(/\s+/g, '');
      if (value && !/^[\w.\-]+@[\w.\-]+$/.test(value)) { this.toast(this.t('upiInvalid'), null, null, 4000); return; }
    }
    if (key === 'shopName' && !value) value = DEFAULT_SETTINGS.shopName;
    this.settings[key] = value;
    this.saveSettings();
    if (key === 'prefix' || key === 'startNo') { this.renumberIfEmpty(); this.persist(); }
    this.renderSettings();
    this._lastHtml = null;
    this.renderBillOutputs();
    this.toast(this.t('settingsSaved'));
  }
  uploadLogo(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 240 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        this.settings.logo = c.toDataURL('image/png');
        this.saveSettings();
        this.renderSettings();
        this._lastHtml = null;
        this.renderBillOutputs();
        this.toast(this.t('settingsSaved'));
      };
      img.onerror = () => this.toast(this.t('logoFail'));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  deleteCatalog(name) {
    this.catalog = this.catalog.filter(c => c.name.toLowerCase() !== String(name).toLowerCase());
    this.persist();
    this.renderSettings();
    this.renderChips();
  }
  backup() {
    this.persist();
    const data = { app: 'billing-pos', version: 2, exportedAt: new Date().toISOString(), settings: this.settings, history: this.history, catalog: this.catalog, current: this.bill };
    this.downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `POS_Backup_${toLocalInput(new Date()).slice(0, 10)}.json`);
    this.toast(this.t('backupDone'));
  }
  restore(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.history) || typeof data.settings !== 'object') throw new Error('bad');
      } catch (e) { this.toast(this.t('restoreFail')); return; }
      if (!confirm(this.t('restoreConfirm'))) return;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
      this.history = data.history.filter(b => b && Array.isArray(b.items));
      this.catalog = Array.isArray(data.catalog) ? data.catalog : [];
      this.bill = (data.current && Array.isArray(data.current.items)) ? data.current : this.createBill();
      this.saveSettings();
      this.persist();
      this.applyLanguage();
      this.loadBillIntoForm();
      this.renderAll();
      this.toast(this.t('restoreDone'));
    };
    reader.readAsText(file);
  }
}

const app = new POSApp();

/* Offline support + install as app */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}