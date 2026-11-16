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
    // ⚠️ هر رویداد جدا محافظت می‌شود: نبودِ PointerEvent نباید مانع کلیک شود
    const fire = (Ctor, type) => {
      try { if (typeof Ctor === 'function') el.dispatchEvent(new Ctor(type, opts)); } catch (e) { /* noop */ }
    };
    fire(g.PointerEvent, 'pointerdown');
    fire(g.MouseEvent, 'mousedown');
    fire(g.PointerEvent, 'pointerup');
    fire(g.MouseEvent, 'mouseup');
    try {
      if (typeof el.click === 'function') el.click();
      else el.dispatchEvent(new MouseEvent('click', opts));
      return true;
    } catch (e) {
      try { el.dispatchEvent(new g.MouseEvent('click', opts)); return true; } catch (e2) { return false; }
    }
  };

  /**
   * افزودن به سبد — نسخه‌ی سریع و مبتنی بر رویداد.
   *
   * درس گرفته‌شده از لاگ واقعی: انتظارِ DOM (`product-selected`) هرگز پر
   * نمی‌شد و هر تلاش ۳.۵ ثانیه تلف می‌کرد. راه درست، گوش دادن به پاسخ
   * شبکه‌ی Livewire است که در چند صد میلی‌ثانیه می‌رسد.
   *
   * خروجی: { sent, method, wait } که wait تابع انتظار برای نتیجه است.
   */
  S.addToCart = async (product, { onEvent } = {}) => {
    const el = S.cardById(product.id) || product.el;
    if (!el) return { sent: false, reason: 'کارت محصول پیدا نشد', code: 'ADD_NO_ELEMENT' };

    const sel = S.selectors();
    const addBtn = el.querySelector(sel.addBtn);

    // ⚠️ درس گرفته‌شده از سایت واقعی:
    //   wire:snapshot روی صفحه «کهنه» است و ممکن است هنوز ناموجود نشان دهد،
    //   در حالی که API همین لحظه می‌گوید موجود است. پس هرگز بر اساس
    //   snapshot تصمیم به «نپذیرفتن» نمی‌گیریم؛ سعی می‌کنیم و نتیجه را
    //   از پاسخ سرور/شبکه می‌گیریم. فقط اگر هیچ روشی در دسترس نبود، رد می‌کنیم.
    const domSays = S.statusFromDom(el);

    const mode = K.config.addMethod || 'auto';
    const net = g.__KVT_NET__;
    const t0 = performance.now();

    // --- استراتژی ۱: Livewire $call (سریع‌ترین و مطمئن‌ترین) ---
    if (mode !== 'click') {
      const wire = S.wireOf(el);
      if (wire && typeof wire.$call === 'function') {
        let promise = null;
        try { promise = wire.$call('add'); } catch (e) {
          if (onEvent) onEvent({ type: 'add-throw', err: String(e && e.message || e) });
        }
        if (promise) {
          promise.then((res) => {
            if (onEvent) onEvent({ type: 'add-resolved', ms: Math.round(performance.now() - t0), res });
          }).catch((e) => {
            if (onEvent) onEvent({ type: 'add-rejected', ms: Math.round(performance.now() - t0), err: String(e && e.message || e) });
          });
          return { sent: true, method: 'wire', promise, el, wait: makeWaiter(el, promise, t0, net) };
        }
      }
    }

    // --- استراتژی ۲: کلیک واقعی ماوس ---
    if (addBtn) {
      addBtn.classList.remove('d-none');
      addBtn.disabled = false;
      S.click(addBtn);
      if (onEvent) onEvent({ type: 'add-click', ms: Math.round(performance.now() - t0) });
      return { sent: true, method: 'click', el, wait: makeWaiter(el, null, t0, net) };
    }

    // --- استراتژی ۳: آخرین تلاش، setSelected روی کامپوننت ---
    const wire = S.wireOf(el);
    if (wire && typeof wire.$set === 'function') {
      try {
        wire.$set('selected', true);
        return { sent: true, method: 'set', el, wait: makeWaiter(el, null, t0, net) };
      } catch (e) { /* noop */ }
    }

    return {
      sent: false,
      reason: 'دکمه/کامپوننت افزودن پیدا نشد',
      code: 'ADD_NO_METHOD',
      status: domSays
    };
  };

  /**
   * انتظار برای نتیجه — هر کدام اول رسید:
   *   ۱) ریدایرکت به درگاه (قوی‌ترین نشانه)
   *   ۲) پاسخ Livewire با کد 4xx/5xx (خطای قطعی)
   *   ۳) نشانه‌ی DOM (product-selected)
   *   ۴) تغییر صفحه
   */
  function makeWaiter(el, promise, t0, net) {
    const startLen = net ? net.queue.length : 0;
    const startPath = location.pathname;

    return async function wait(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      let promiseResult = null;
      let promiseError = null;
      const p = promise ? promise.then((r) => { promiseResult = r; }, (e) => { promiseError = e; }) : Promise.resolve();

      while (Date.now() < deadline) {
        // ۱) ریدایرکت یا ترک صفحه
        if (K.store.get('navigating', false)) {
          return { ok: true, how: 'navigating', ms: Math.round(performance.now() - t0), method: promiseResult?.method };
        }
        if (location.pathname !== startPath) {
          return { ok: true, how: 'navigated', path: location.pathname, ms: Math.round(performance.now() - t0) };
        }

        // ۲) پاسخ شبکه‌ی مرتبط
        if (net) {
          const fresh = net.queue.slice(startLen);
          for (const r of fresh) {
            if (r.redirect) {
              return { ok: true, how: 'livewire-redirect', redirect: r.redirect, status: r.status, ms: Math.round(performance.now() - t0) };
            }
            if (r.kind === 'livewire' && r.body && /add|select/i.test(r.body)) {
              if (r.status >= 400) {
                return { ok: false, how: 'server-error', status: r.status, ms: Math.round(performance.now() - t0), body: r.body };
              }
              if (r.status === 200 && r.phase === 'xhr') {
                return { ok: true, how: 'livewire-200', status: 200, calls: r.calls, ms: Math.round(performance.now() - t0) };
              }
            }
          }
        }

        // ۳) نشانه‌ی DOM (سریع، بدون querySelector سنگین)
        if (el && el.isConnected && el.querySelector('.product-selected')) {
          return { ok: true, how: 'dom-selected', ms: Math.round(performance.now() - t0) };
        }

        // ۴) خطای Livewire (اسنپ‌شات خود کامپوننت)
        if (promiseError) {
          return { ok: false, how: 'promise-error', err: String(promiseError && promiseError.message || promiseError), status: promiseError?.status, ms: Math.round(performance.now() - t0) };
        }

        await K.sleep(25);   // بازرسی سریع: هر ۲۵ms
      }

      // مهلت تمام شد ولی promise پاسخ داده بود؟
      if (promiseResult) {
        return { ok: true, how: 'promise-resolved', res: promiseResult, ms: Math.round(performance.now() - t0) };
      }
      return { ok: false, how: 'timeout', ms: Math.round(performance.now() - t0), code: 'ADD_TIMEOUT' };
    };
  }

  /** آیا این صفحه پرداخت را نشان می‌دهد؟ (نه فقط path — شاید effect ریدایرکت) */
  S.isPaymentRendered = () => {
    if (S.paymentPage()) return true;
    try {
      return !!document.querySelector('[wire\\:click="next()"]')
        || !!document.querySelector('[wire\\:click*="setGateway("]');
    } catch (e) { return false; }
  };

  /** علامت‌های موفقیت افزودن به سبد */
  S.addedSignals = (el) => {
    if (S.isPaymentRendered()) return true;
    if (!el) return false;
    const sel = S.selectors();
    try { if (el.querySelector('.' + sel.selectedClass)) return true; } catch (e) { /* noop */ }
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

  /** در صفحه‌ی پرداخت: لیست همه‌ی دکمه‌های درگاه (داینامیک — کلیدها ثابت نیستند) */
  S.gatewayButtons = () => {
    const out = [];
    const seen = new Set();
    const add = (el) => {
      if (!el || seen.has(el)) return;
      const key = S.gatewayKeyFromButton(el);
      if (!key) return;
      seen.add(el);
      out.push({ el, key, name: S.norm(el.textContent).slice(0, 40) || key });
    };
    // مسیر اصلی: هر المانی که wire:click آن setGateway(...) دارد
    try {
      document.querySelectorAll('[wire\\:click*="setGateway("]').forEach(add);
    } catch (e) { /* noop */ }
    // فالبک‌ها برای پیاده‌سازی‌های دیگر
    try { document.querySelectorAll('[data-gateway]').forEach(add); } catch (e) { /* noop */ }
    if (!out.length) {
      try {
        document.querySelectorAll('button, label, .gateway, .gw-item, [role="radio"]').forEach((el) => {
          const key = S.gatewayKeyFromButton(el);
          if (key) add(el);
        });
      } catch (e) { /* noop */ }
    }
    return out;
  };

  /** پیدا کردن دکمه‌ی درگاه با کلید (اگر باشد) */
  S.gatewayButton = (key) => {
    if (!key) return null;
    const list = S.gatewayButtons();
    const hit = list.find((g) => g.key === key);
    return hit ? hit.el : null;
  };

  /** انتخاب درگاه: کلید مشخص؛ اگر نبود، «همان اولی» یا تصادفی — هدف سرعت است */
  S.pickGateway = (preferred, strategy = 'first') => {
    const list = S.gatewayButtons();
    if (!list.length) return null;
    if (preferred) {
      const hit = list.find((g) => g.key === preferred);
      if (hit) return hit;
    }
    if (strategy === 'random') return list[Math.floor(Math.random() * list.length)];
    return list[0];
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
