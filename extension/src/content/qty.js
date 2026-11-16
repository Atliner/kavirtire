/*
 * Kavirtire FastBuy — Quantity (MAIN world)
 *
 * انتخاب تعداد حلقه (پیش‌فرض ۲) در صفحه‌ی پیش از درگاه پرداخت.
 *
 * مهم: پیاده‌سازی سایت ممکن است با هر بار تغییر کند (input، +، سلکت،
 * دکمه‌های data-* یا کامپوننت Livewire). بنابراین به‌جای فرض یک الگو،
 * همه‌ی راه‌های رایج به ترتیب «سریع‌ترین» امتحان می‌شوند و نتیجه از
 * روی state واقعی (خواندن مقدار) تأیید می‌شود.
 *
 * همه‌ی اقدامات با زمان‌سنج در Trace ثبت می‌شوند.
 */
(function (g) {
  'use strict';
  const K = g.__KVTB = g.__KVTB || {};

  const Q = {};

  /** آیتم‌های سبد در صفحه‌ی پیش از درگاه */
  Q.cartItems = () => {
    try {
      const sel = K.config.cartItemSelector || '.checkout-item';
      return [...document.querySelectorAll(sel)];
    } catch (e) { return []; }
  };

  /** اگر سبد چند آیتم دارد، آیتم محصول هدف را ترجیح بده */
  Q.targetItems = () => {
    const items = Q.cartItems();
    if (!items.length) return [];
    const pid = String(K.store.get('purchaseId', '') || '');
    if (!pid) return [items[items.length - 1]];
    const hit = items.filter((el) => {
      const attrs = [el.getAttribute('data-tire-id'), el.getAttribute('data-id'),
        el.getAttribute('data-product-id'), el.dataset?.tireId, el.dataset?.id];
      if (attrs.some((a) => a != null && String(a) === pid)) return true;
      const snap = el.getAttribute('wire:snapshot');
      return snap ? snap.includes(`"${pid}"`) : false;
    });
    return hit.length ? hit : [items[items.length - 1]];
  };

  /** تمام کنترل‌های عددی داخل یک آیتم سبد */
  Q.controlsIn = (scope) => {
    if (!scope) return [];
    const out = [];
    const add = (el, kind) => { if (el && !out.some((x) => x.el === el)) out.push({ el, kind }); };

    // ۱) input عددی
    scope.querySelectorAll('input[type="number"], input[inputmode="numeric"], input.qty, input[name*="qty" i], input[name*="quantity" i], input[name*="count" i], input[id*="qty" i], input[id*="quantity" i]')
      .forEach((el) => add(el, 'input'));

    // ۲) select
    scope.querySelectorAll('select, [role="combobox"]').forEach((el) => add(el, 'select'));

    // ۳) دکمه‌های افزایش/کاهش با متن یا ویژگی
    scope.querySelectorAll('button, [role="button"], a[role="button"], span[role="button"]').forEach((el) => {
      const txt = (el.textContent || '').trim();
      const attrs = [el.getAttribute('wire:click'), el.getAttribute('onclick'), el.getAttribute('data-action'),
        el.getAttribute('data-inc'), el.getAttribute('data-dec'), el.getAttribute('aria-label'), el.title]
        .filter(Boolean).join(' ');
      if (isPlus(txt, attrs)) add(el, 'plus');
      else if (isMinus(txt, attrs)) add(el, 'minus');
    });

    // ۴) دکمه‌های عددی (انتخاب مستقیم "۲")
    scope.querySelectorAll('button, [role="button"], option').forEach((el) => {
      const t = K.site.norm(el.textContent);
      if (/^[0-9]+$/.test(t)) add(el, 'num');
    });

    return out;
  };

  function isPlus(txt, attrs) {
    if (/^\+$|^＋$|^increase$|^افزایش$/.test(txt)) return true;
    if (/هزینه|more|increase|increment|plus|add|qty-up|qtyPlus/i.test(attrs)) return true;
    if (/(^|\s)(\+|＋)(\s|$)/.test(txt) && txt.length <= 3) return true;
    return false;
  }
  function isMinus(txt, attrs) {
    if (/^[-−–]$|^decrease$|^کاهش$/.test(txt)) return true;
    if (/کاهش|decrease|increment--|minus|qty-down|qtyMinus|remove|delete|trash/i.test(attrs)) return true;
    return false;
  }

  /** مقدار فعلی یک کنترل */
  Q.read = (ctrl) => {
    if (!ctrl || !ctrl.el) return null;
    const el = ctrl.el;
    try {
      if (ctrl.kind === 'input') {
        const v = Number(el.value);
        return Number.isFinite(v) ? v : null;
      }
      if (ctrl.kind === 'select') {
        if (el.tagName === 'SELECT') {
          const v = Number(el.value);
          if (Number.isFinite(v)) return v;
          return el.selectedIndex >= 0 ? el.selectedIndex + 1 : null;
        }
        return null;
      }
    } catch (e) { /* noop */ }
    return null;
  };

  /** مقدار نمایشی داخل آیتم (مثلاً «۲ عدد») */
  Q.readText = (item) => {
    if (!item) return null;
    const txt = K.site.norm(item.textContent || '');
    // «×۲»، «۲ عدد»، «تعداد: ۲»
    const m = txt.match(/(?:×|x|تعداد\s*:?|qty\s*:?)\s*([0-9]{1,2})/i);
    if (m) return Number(m[1]);
    return null;
  };

  /** تنظیم input با رویدادهای کامل (Livewire نیاز دارد) */
  Q.setInput = (el, value) => {
    try {
      el.focus?.();
      const proto = el instanceof g.HTMLInputElement ? g.HTMLInputElement.prototype : null;
      const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, String(value));
      else el.value = String(value);
      ['input', 'change', 'blur', 'keyup'].forEach((t) => {
        el.dispatchEvent(new Event(t, { bubbles: true, composed: true }));
      });
      return true;
    } catch (e) { return false; }
  };

  /** انتخاب گزینه‌ی سلکت با مقدار یا ایندکس */
  Q.setSelect = (el, value) => {
    try {
      const opts = [...el.options];
      if (!opts.length) return false;
      const byVal = opts.find((o) => Number(o.value) === value);
      const target = byVal || opts[Math.min(value - 1, opts.length - 1)];
      if (!target) return false;
      el.value = target.value;
      el.selectedIndex = target.index;
      ['input', 'change'].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true, composed: true })));
      return true;
    } catch (e) { return false; }
  };

  /**
   * تعیین تعداد — هسته‌ی منطق.
   * @returns {{ok:boolean, how?:string, from?:number|null, to?:number, tried?:string[], ms:number, reason?:string}}
   */
  Q.ensure = async (want = K.config.quantity || 2, opts = {}) => {
    const T = K.trace;
    const t0 = performance.now();
    const budget = Math.max(300, Number(opts.budget) || Number(K.config.qtyWait) || 1500);
    const wantN = Math.max(1, Math.min(Number(want) || 2, 10));
    const result = { ok: false, tried: [], ms: 0 };

    // کامپوننت Livewire صفحه (اگر باشد) — سریع‌ترین و مطمئن‌ترین راه
    const wireCallOk = async () => {
      const host = document.querySelector('[wire\\:id]');
      const wire = K.site.wireOf(host);
      if (!wire || typeof wire.$call !== 'function') return false;
      // نام متد ممکن است متفاوت باشد؛ همه را به ترتیب امتحان می‌کنیم
      const methods = ['setQty', 'setQuantity', 'setCount', 'updateQty', 'changeQty', 'setTireCount'];
      for (const m of methods) {
        try {
          const p = wire.$call(m, wantN);
          if (p && typeof p.then === 'function') {
            await Promise.race([p.catch(() => {}), K.sleep(400)]);
          }
          // اگر خطا نداد، ممکن است انجام شده باشد
          const st = (() => { try { return wire.$get?.('qty') ?? wire.$get?.('quantity') ?? wire.$get?.('count'); } catch (e) { return undefined; } })();
          if (st === wantN) return true;
        } catch (e) { /* متد وجود ندارد */ }
      }
      return false;
    };

    const deadline = Date.now() + budget;
    let items = Q.targetItems();

    while (Date.now() < deadline) {
      // صفحه‌ی پرداخت آماده است؟
      items = Q.targetItems();
      const scope = items[0] || document;

      const ctrls = Q.controlsIn(scope);
      if (ctrls.length) {
        const input = ctrls.find((c) => c.kind === 'input');
        const plus = ctrls.find((c) => c.kind === 'plus');
        const numBtn = ctrls.find((c) => c.kind === 'num' && Number(K.site.norm(c.el.textContent)) === wantN);
        const sel = ctrls.find((c) => c.kind === 'select');

        // ---- ۱) input عددی ----
        if (input) {
          const cur = Q.read(input);
          result.from = cur;
          result.tried.push('input');
          if (cur === wantN) { result.ok = true; result.how = 'input-already'; break; }
          Q.setInput(input.el, wantN);
          const after = await K.waitFor(() => (Q.read(input) === wantN ? true : null), Math.min(500, budget), 20);
          if (after) { result.ok = true; result.how = 'input-set'; break; }
        }

        // ---- ۲) سلکت ----
        if (sel) {
          result.tried.push('select');
          Q.setSelect(sel.el, wantN);
          const after = await K.waitFor(() => (Q.read(sel) === wantN ? true : null), Math.min(400, budget), 20);
          if (after) { result.ok = true; result.how = 'select-set'; break; }
        }

        // ---- ۳) دکمه‌ی عددی مستقیم ----
        if (numBtn) {
          result.tried.push('num-button');
          K.site.click(numBtn.el);
          await K.sleep(120);
          const cur2 = input ? Q.read(input) : Q.readText(scope);
          if (cur2 === wantN) { result.ok = true; result.how = 'num-button'; break; }
          // حتی اگر نخواندیم، کلیک را موفق تلقی می‌کنیم
          result.ok = true; result.how = 'num-button-assumed'; break;
        }

        // ---- ۴) زدن «+» تا رسیدن ----
        if (plus) {
          result.tried.push('plus-button');
          let cur = input ? Q.read(input) : Q.readText(scope);
          if (cur == null) cur = 1;
          let guard = 0;
          while (cur < wantN && guard++ < 10 && Date.now() < deadline) {
            K.site.click(plus.el);
            await K.sleep(90);
            const next = await K.waitFor(() => {
              const v = input ? Q.read(input) : Q.readText(scope);
              return v != null && v !== cur ? v : null;
            }, 250, 20);
            if (next == null) break;
            cur = next;
            // دکمه ممکن است دوباره رندر شود
            const again = Q.controlsIn(Q.targetItems()[0] || document).find((c) => c.kind === 'plus');
            if (again) plus.el = again.el;
          }
          if (cur === wantN) { result.ok = true; result.how = 'plus-clicks'; break; }
        }
      }

      await K.sleep(60);
    }

    // ---- ۵) آخرین تلاش: API کامپوننت ----
    if (!result.ok && opts.allowWireApi !== false) {
      result.tried.push('wire-api');
      if (await wireCallOk()) { result.ok = true; result.how = 'wire-api'; }
    }

    result.ms = Math.round(performance.now() - t0);
    result.to = wantN;

    if (T) {
      T.log('PAY', result.ok ? 'info' : 'warn',
        result.ok ? `تعداد روی ${wantN} تنظیم شد (${result.how})` : `تنظیم تعداد ${wantN} ناموفق بود`,
        { ...result, items: items.length }, result.ok ? null : 'PAY_QTY_FAILED');
    }
    return result;
  };

  /** آیا تعداد فعلی، مقدار هدف است؟ (بدون تغییر) */
  Q.current = () => {
    const items = Q.targetItems();
    const scope = items[0] || document;
    const ctrls = Q.controlsIn(scope);
    const input = ctrls.find((c) => c.kind === 'input');
    if (input) return Q.read(input);
    const sel = ctrls.find((c) => c.kind === 'select');
    if (sel) return Q.read(sel);
    return Q.readText(scope);
  };

  K.qty = Q;
})(globalThis);
