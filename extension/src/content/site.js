/*
 * Kavirtire FastBuy — Site adapter (MAIN world)
 *
 * تنها جایی که به DOM/API واقعی کویرتایر وابسته است. اگر سایت تغییر کرد،
 * فقط همین فایل (یا تنظیمات پیشرفته در صفحه‌ی تنظیمات) لازم است عوض شود.
 *
 * قرارداد فعلی (بر اساس اسکریپت V4 کاربر):
 *   کارت محصول:  .product[data-tire-id]
 *   عنوان:       .title
 *   سایز:        .size
 *   دکمه‌ی افزودن: .product-add-button  (با کلاس d-none مخفی می‌شود)
 *   وضعیت:       wire:snapshot → data.available / data.exhausted
 *   API:         GET /esale/products/availability → { products: { [id]: { available, exhausted } } }
 *   پرداخت:      [wire:click="setGateway('KEY')"] و [wire:click="next()"]
 */
(function (g) {
  'use strict';
  const K = g.__KVTB = g.__KVTB || {};

  const S = {};

  S.selectors = () => ({
    card: (K.config.cardSelector || '.product[data-tire-id]').trim(),
    title: '.title',
    size: '.size',
    addBtn: '.product-add-button',
    selectedClass: 'product-selected',
    payItem: (K.config.cartItemSelector || '.checkout-item')
  });

  /** تمام کارت‌های محصول صفحه */
  S.cards = () => {
    try { return [...document.querySelectorAll(S.selectors().card)]; } catch (e) { return []; }
  };

  /** نرمال‌سازی متن: اعداد فارسی/عربی → لاتین، فاصله‌ها */
  S.norm = (s) => String(s || '')
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\u200c/g, ' ')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  /** خواندن snapshot لایوواییر کارت (بدون اجرای کد سرور) */
  S.snapshot = (el) => {
    try {
      const raw = el.getAttribute('wire:snapshot');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  };

  /** استخراج وضعیت از snapshot — مسیرهای مختلف نسخه‌های Livewire را پوشش می‌دهد */
  S.statusFromSnapshot = (el) => {
    const snap = S.snapshot(el);
    const data = snap && (snap.data || snap);
    if (!data || typeof data !== 'object') return null;
    // حالت رایج V4: data.available / data.exhausted
    if (typeof data.available === 'boolean') {
      return { available: data.available, exhausted: !!data.exhausted, source: 'snapshot' };
    }
    // اگر nested بود
    const stack = [data];
    let guard = 0;
    while (stack.length && guard++ < 40) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object') continue;
      if (typeof cur.available === 'boolean') {
        return { available: cur.available, exhausted: !!cur.exhausted, source: 'snapshot' };
      }
      for (const v of Object.values(cur)) {
        if (v && typeof v === 'object') stack.push(v);
      }
    }
    return null;
  };

  /** وضعیت از روی DOM (دکمه‌ی افزودن/کلاس‌ها) */
  S.statusFromDom = (el) => {
    const sel = S.selectors();
    const add = el.querySelector(sel.addBtn);
    const hasAdd = !!add;
    const hidden = hasAdd ? add.classList.contains('d-none') || add.disabled || add.hidden : false;
    const badgeTxt = S.norm(el.querySelector('.badge, .stock, .status, [class*="stock"]')?.textContent || '');
    let exhausted = /اتمام|ناموجود|پایان/.test(badgeTxt);
    let available = hasAdd && !hidden;
    if (badgeTxt) {
      if (/موجود|فعال/.test(badgeTxt) && !/ناموجود/.test(badgeTxt)) available = true;
      if (/ناموجود|اتمام/.test(badgeTxt)) available = false;
    }
    return { available, exhausted, source: 'dom' };
  };

  /** وضعیت یک کارت با اولویت snapshot */
  S.status = (el) => S.statusFromSnapshot(el) || S.statusFromDom(el);

  /** شناسه‌ی پایدار محصول */
  S.idOf = (el) => {
    const raw = el.getAttribute('data-tire-id');
    return raw != null ? String(raw).trim() : '';
  };

  /** عنوان نمایشی */
  S.titleOf = (el) => {
    const sel = S.selectors();
    const t = el.querySelector(sel.title)?.textContent || el.querySelector('.product-title')?.textContent || '';
    const s = el.querySelector(sel.size)?.textContent || '';
    const title = S.norm(t) || `تایر ${S.idOf(el)}`;
    const size = S.norm(s);
    return { title, size, full: size ? `${title} — ${size}` : title };
  };

  /** لیست کامل محصولات صفحه */
  S.products = () => S.cards().map((el) => {
    const { title, size, full } = S.titleOf(el);
    return { id: S.idOf(el), title, size, full, el };
  }).filter((p) => p.id);

  /** نرمال‌سازی پاسخ API به شکل { [id]: {available, exhausted} } */
  S.parseAvailability = (body) => {
    const out = {};
    const raw = body && (body.products || body.data || body.items || body);
    const visit = (id, v) => {
      if (v == null) return;
      if (typeof v === 'boolean') { out[String(id)] = { available: v, exhausted: false }; return; }
      if (typeof v === 'object') {
        const available = typeof v.available === 'boolean' ? v.available
          : typeof v.in_stock === 'boolean' ? v.in_stock
          : typeof v.stock === 'number' ? v.stock > 0
          : typeof v.qty === 'number' ? v.qty > 0
          : undefined;
        if (available === undefined) return;
        out[String(id)] = {
          available,
          exhausted: !!(v.exhausted ?? v.is_exhausted ?? v.sold_out),
          limit: v.limit ?? v.max ?? null
        };
      }
    };
    if (Array.isArray(raw)) {
      raw.forEach((it) => { if (it && typeof it === 'object') visit(it.id ?? it.tire_id ?? it.product_id, it); });
    } else if (raw && typeof raw === 'object') {
      Object.entries(raw).forEach(([id, v]) => visit(id, v));
    }
    return out;
  };

  /** یک SSE/JSON نهایی: گرفتن موجودی از API با guard */
  S.fetchAvailability = async (guard) => {
    const url = K.config.apiUrl || '/esale/products/availability';
    const r = await guard.fetchJson(url, { timeout: K.config.timeout });
    if (!r.ok) return r;
    return { ...r, products: S.parseAvailability(r.data) };
  };

  /** وضعیت از HTML صفحه (بدون رفرش مرورگر) — فقط وقتی کاربر اجازه داده */
  S.fetchPageAvailability = async (guard) => {
    const url = K.config.pageUrl || '/esale/products';
    const w = guard.cooldownLeft();
    if (w) return { ok: false, limited: true, wait: w, reason: 'cooldown' };
    const t = guard.take();
    if (!t.ok) return { ok: false, limited: true, wait: t.wait, reason: 'budget' };
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), Math.max(3000, K.config.timeout || 8000));
    try {
      const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal });
      if (res.status === 429 || res.status === 403 || res.status === 503) {
        const ra = Number(res.headers.get('Retry-After')) || 0;
        return { ok: false, limited: true, status: res.status, ...guard.limited(ra, res.status, 'page') };
      }
      if (!res.ok) { guard.error(res.status); return { ok: false, error: 'سرور ' + res.status, status: res.status }; }
      if (res.redirected && !new URL(res.url).pathname.includes('/esale/products')) {
        return { ok: false, error: 'ریدایرکت (نشست منقضی؟)' };
      }
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const products = {};
      const cardSel = S.selectors().card;
      doc.querySelectorAll(cardSel).forEach((el) => {
        const id = S.idOf(el);
        if (!id) return;
        const st = S.statusFromSnapshot(el) || S.statusFromDom(el);
        products[id] = { available: st.available, exhausted: st.exhausted };
      });
      if (!Object.keys(products).length) return { ok: false, error: 'محصولی در صفحه نبود' };
      guard.success();
      return { ok: true, products, status: res.status };
    } catch (e) {
      guard.error(0);
      return { ok: false, error: /abort/i.test(e.name) ? 'تایم‌اوت' : 'شبکه' };
    } finally { clearTimeout(to); }
  };

  /** پیدا کردن کامپوننت Livewire روی یک المان */
  S.wireOf = (el) => {
    try {
      const id = el?.getAttribute?.('wire:id');
      const L = window.Livewire;
      if (!L) return null;
      if (id && L.find) return L.find(id) || null;
      if (id && L.components?.all) return L.components.all().find((c) => c.id === id) || null;
    } catch (e) { /* noop */ }
    return null;
  };

  /** escape امن برای استفاده در انتخابگر CSS (اگر CSS.escape نباشد) */
  S.esc = (v) => {
    try { return (window.CSS && window.CSS.escape) ? window.CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&'); }
    catch (e) { return String(v).replace(/["\\]/g, '\\$&'); }
  };

  /** پیدا کردن کارت محصول با شناسه (بدون استثناء در صورت نبود CSS.escape) */
  S.cardById = (id) => {
    const all = S.cards();
    return all.find((el) => S.idOf(el) === String(id)) || null;
  };

  /** کلیک واقعی ماوس (رویدادهای کامل) */
  S.click = (el) => {
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, composed: true, button: 0 };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.click();
      return true;
    } catch (e) {
      try { el.click(); return true; } catch (e2) { return false; }
    }
  };

  /** افزودن محصول به سبد: ابتدا Livewire، بعد کلیک؛ خروجی: آیا «درخواست» فرستاده شد */
  S.addToCart = async (product, { guard } = {}) => {
    const mode = K.config.addMethod || 'auto';
    const el = S.cardById(product.id) || product.el;
    if (!el) return { ok: false, reason: 'کارت محصول پیدا نشد' };

    const sel = S.selectors();
    const addBtn = el.querySelector(sel.addBtn);

    if (mode !== 'click') {
      const w = S.wireOf(el);
      if (w && typeof w.$call === 'function') {
        try {
          const p = w.$call('add');
          if (p && typeof p.then === 'function') p.catch(() => {});
          return { ok: true, via: 'wire', mode };
        } catch (e) { /* می‌رود سراغ کلیک */ }
      }
    }
    if (addBtn) {
      addBtn.classList.remove('d-none');
      addBtn.disabled = false;
      S.click(addBtn);
      return { ok: true, via: 'click', mode };
    }
    return { ok: false, reason: 'دکمه‌ی افزودن پیدا نشد' };
  };

  /** علامت‌های موفقیت افزودن به سبد */
  S.addedSignals = (el) => {
    const sel = S.selectors();
    if (location.pathname.startsWith('/esale/payment')) return true;
    if (!el) return false;
    if (el.querySelector('.' + sel.selectedClass)) return true;
    const w = S.wireOf(el);
    try { if (w && w.$get && w.$get('selected') === true) return true; } catch (e) { /* noop */ }
    return false;
  };

  /** بستن مودال‌های مزاحم (SweetAlert و بوت‌استرپ) */
  S.closePopups = () => {
    document.querySelectorAll(
      '.swal2-confirm, .swal2-close, button.swal2-styled, .modal .btn-close, [data-dismiss="modal"], [data-bs-dismiss="modal"]'
    ).forEach((b) => { try { b.click(); } catch (e) { /* noop */ } });
    document.querySelector('dialog#livewire-error')?.close?.();
  };

  /** در صفحه‌ی پرداخت: دکمه‌ی یک درگاه */
  S.gatewayButton = (key) => {
    if (!key) return null;
    const sels = [
      `[wire\\:click="setGateway('${key}')"]`,
      `[wire\\:click*="setGateway('${key}')"]`,
      `[data-gateway="${key}"]`,
      `[value="${key}"]`
    ];
    for (const s of sels) { try { const el = document.querySelector(s); if (el) return el; } catch (e) { /* noop */ } }
    return null;
  };

  S.gatewayKeyFromButton = (el) => {
    const raw = el?.getAttribute?.('wire:click') || el?.getAttribute?.('data-gateway') || el?.getAttribute?.('value') || '';
    const m = /setGateway\(\s*['"]([^'"]+)['"]\s*\)/.exec(raw);
    return m ? m[1] : (raw || '');
  };

  /** در صفحه‌ی پرداخت: دکمه‌ی تایید و پرداخت */
  S.payButton = () => {
    return document.querySelector('[wire\\:click="next()"]')
      || document.querySelector('[wire\\:click*="next("]')
      || [...document.querySelectorAll('button')].find((b) => /تایید|پرداخت|پرداخت کن|ادامه/.test(S.norm(b.textContent)) && !b.disabled)
      || null;
  };

  S.paymentPage = () => location.pathname.startsWith((K.config.paymentUrl || '/esale/payment'));
  S.productsPage = () => location.pathname.startsWith((K.config.pageUrl || '/esale/products'));

  S.readGatewayState = (el) => {
    const host = el?.closest('[wire\\:id]') || document.querySelector('[wire\\:id]');
    const w = S.wireOf(host);
    try { return w && w.$get ? w.$get('gateway') : undefined; } catch (e) { return undefined; }
  };

  S.cartCount = () => document.querySelectorAll(S.selectors().payItem).length;

  K.site = S;
})(globalThis);
