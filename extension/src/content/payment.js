/*
 * Kavirtire FastBuy — Payment (MAIN world)
 *
 * هدف شماره‌ی یک: از لحظه‌ی ورود به /esale/payment تا کلیک «تایید و پرداخت»
 * کمتر از ۲ ثانیه. برای این کار:
 *   • درگاه‌ها «داینامیک» کشف می‌شوند (کلید ثابت فرض نمی‌شود)
 *   • هیچ انتظار ۱۲ ثانیه‌ای برای Livewire وجود ندارد
 *   • اولین دکمه‌ی موجود و فعال بلافاصله کلیک می‌شود
 *   • تشخیص ریدایرکت از پاسخ شبکه انجام می‌شود، نه از تغییر DOM
 *   • هر اقدام با زمان‌سنج دقیق در Trace ثبت می‌شود
 */
(function (g) {
  'use strict';
  const K = g.__KVTB = g.__KVTB || {};
  const S = K.site;

  const TARGET_MS = 2000;      // هدف: زیر ۲ ثانیه
  const HARD_DEADLINE = 8000;  // سقف مطلق

  function toast() {
    const host = document.createElement('div');
    host.id = 'kvt-toast';
    host.style.cssText = 'all:initial;position:fixed;top:16px;left:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        .t{width:330px;direction:rtl;font-family:Vazirmatn,Tahoma,"Segoe UI",sans-serif;font-size:13px;color:#1f2937;background:#fff;
           border-radius:16px;box-shadow:0 12px 44px rgba(15,23,42,.28),0 0 0 1px rgba(15,23,42,.06);overflow:hidden}
        .h{display:flex;align-items:center;gap:8px;padding:11px 14px;color:#fff;font-weight:800;
           background:linear-gradient(135deg,#2563eb,#4f46e5)}
        .h .sp{flex:1}
        .x{width:22px;height:22px;border:0;border-radius:6px;background:rgba(255,255,255,.18);color:#fff;cursor:pointer;font-size:12px}
        .m{padding:12px 14px;line-height:1.8}
        .m.warn{background:#fef3c7;color:#92400e}.m.ok{background:#dcfce7;color:#166534}.m.bad{background:#fee2e2;color:#991b1b}
        .b{display:flex;gap:8px;padding:0 14px 12px}.b:empty{display:none}
        .b button{flex:1;height:38px;border:0;border-radius:10px;color:#fff;font:inherit;font-weight:700;cursor:pointer;background:#4f46e5}
        .b button.ok{background:#16a34a}.b button.bad{background:#dc2626}
        .b button:hover{filter:brightness(1.06)}
        .steps{display:flex;gap:4px;padding:0 14px 10px;flex-wrap:wrap}
        .st{font-size:10.5px;border-radius:999px;padding:2px 8px;background:#f1f5f9;color:#64748b}
        .st.done{background:#dcfce7;color:#15803d}.st.now{background:#eef2ff;color:#4338ca;font-weight:700}
        .st.fail{background:#fee2e2;color:#b91c1c}
        .tm{font-size:10px;color:#94a3b8;padding:0 14px 10px}
        .tm b{color:#4f46e5}
      </style>
      <div class="t">
        <div class="h"><span>⚡</span><span class="sp">پرداخت سریع</span><b id="t" style="font-size:12px;font-weight:800"></b><button class="x" id="x">✕</button></div>
        <div class="m" id="m"></div>
        <div class="steps" id="steps"></div>
        <div class="tm" id="tm"></div>
        <div class="b" id="b"></div>
      </div>`;
    document.documentElement.appendChild(host);
    const m = root.getElementById('m'), b = root.getElementById('b'), steps = root.getElementById('steps'),
      tm = root.getElementById('tm'), t = root.getElementById('t');
    root.getElementById('x').onclick = () => host.remove();
    const api = {
      set(text, cls = '') { m.textContent = text; m.className = 'm ' + cls; },
      buttons(list) {
        b.replaceChildren(...list.map(([label, fn, kind]) => {
          const x = document.createElement('button');
          x.textContent = label; x.className = kind || ''; x.onclick = fn; return x;
        }));
      },
      markStep(stepsList) {
        steps.replaceChildren(...stepsList.map((s) => {
          const d = document.createElement('span');
          d.className = 'st ' + (s.state || '');
          d.textContent = s.label;
          return d;
        }));
      },
      timer(ms) { t.textContent = (ms / 1000).toFixed(2) + 's'; t.style.color = ms < TARGET_MS ? '#86efac' : '#fca5a5'; },
      timing(html) { tm.innerHTML = html; },
      alive: () => host.isConnected,
      destroy() { host.remove(); }
    };
    return api;
  }

  function gatewayList() {
    const raw = (K.config.gateways || '').trim();
    if (raw) {
      const list = raw.split(',').map((s) => {
        const [k, ...rest] = s.split(':');
        return { key: (k || '').trim(), name: (rest.join(':') || k || '').trim() };
      }).filter((x) => x.key);
      if (list.length) return list;
    }
    return g.KVT_GATEWAYS || [];
  }

  K.gatewayList = gatewayList;

  function paymentPage() {
    const ui = toast();
    const T = K.trace;
    const st = { cancelled: false, running: false, handedOff: false, done: false, steps: [] };
    const t0 = performance.now();

    const armRaw = K.store.get('arm', null);
    const armAt = typeof armRaw === 'number' ? armRaw : Number(armRaw?.t) || 0;
    const armId = (armRaw && typeof armRaw === 'object') ? String(armRaw.id || '') : '';
    const tid = (armRaw && typeof armRaw === 'object' && armRaw.tid) ? armRaw.tid : null;
    const ttl = Math.max(Number(K.config.armTtl) || 180000, 15000);
    const armed = !!armAt && (Date.now() - armAt) < ttl;
    const cartIds = K.store.get('cartIds', []);
    const mismatch = !!(armId && cartIds.length && !cartIds.map(String).includes(armId));
    const consume = () => K.store.del('arm');

    const span = T.start('PAY', 'ورود به صفحه‌ی پرداخت', {
      tid, armed, armId, armAt, ttl, mismatch,
      autoPay: K.config.autoPay, gatewayPref: K.config.gateway,
      path: location.pathname, referrer: document.referrer
    });

    const setSteps = () => ui.markStep(st.steps);
    const step = (label, state) => {
      const found = st.steps.find((s) => s.label === label);
      if (found) found.state = state;
      else st.steps.push({ label, state });
      setSteps();
    };

    const finish = (code, msg, data) => {
      const ms = span.elapsed();
      ui.timer(ms);
      if (code) span.fail(code, msg, { ...data, totalMs: ms });
      else span.ok(msg, { ...data, totalMs: ms });
      T.info('PAY', `پایان پرداخت: ${msg} (${ms}ms)`, { tid, code, totalMs: ms });
    };

    K.store.del('navigating');
    K.log(`صفحه‌ی پرداخت | armed=${armed} | autoPay=${K.config.autoPay} | gateway=${K.config.gateway}`);

    const pageState = { destroy() { ui.destroy(); }, alive: () => ui.alive(), span };

    function lockRun(fn) {
      if (st.running) return null;
      st.running = true;
      const p = Promise.resolve().then(fn).catch((e) => {
        console.warn('[KVT payment]', e);
        span.fail(K.FAIL.UNKNOWN, 'خطای غیرمنتظره در پرداخت', { err: String(e && e.stack || e) });
        ui.set('خطا در پرداخت خودکار: ' + (e.message || e), 'bad');
        ui.buttons([]);
      }).finally(() => { st.running = false; });
      return p;
    }

    /**
     * هسته‌ی پرداخت — «موازی»، نه سری.
     *
     * برای رسیدن به هدف زیر ۲ ثانیه، کارها باید هم‌زمان اجرا شوند:
     *   A) آماده شدن سبد   B) تنظیم تعداد (۲ حلقه)   C) یافتن دکمه‌ی درگاه
     * سپس D) کلیک درگاه و E) کلیک پرداخت — هر کدام به محض آماده شدن.
     *
     * هیچ مرحله‌ای منتظر مرحله‌ی قبلی نمی‌ماند مگر واقعاً وابسته باشد.
     */
    async function run(auto) {
      const runT0 = performance.now();
      step('ورود', 'done');
      ui.buttons([['لغو', () => {
        st.cancelled = true; consume();
        ui.set('⏹ لغو شد؛ خودتان ادامه دهید.', 'warn'); ui.buttons([]);
        finish(null, 'کاربر لغو کرد');
      }, 'bad']]);

      const wantQty = Math.max(1, Number(K.config.quantity) || 2);
      const qtyOn = !!K.config.qtyEnabled;

      // ══ مرحله A+B+C — همه هم‌زمان ═══════════════════════════════════
      step('بررسی سبد', 'now');
      step('یافتن درگاه', 'now');
      if (qtyOn) step(`تعداد: ${wantQty}`, 'now');

      const pCart = K.waitFor(() => (S.cartCount() > 0 ? true : null), 1200, 25);
      const pGw = K.waitFor(() => {
        const l = S.gatewayButtons();
        return l.length ? l : null;
      }, 1600, 25);
      const pQty = (qtyOn && K.qty)
        ? K.qty.ensure(wantQty, { budget: Number(K.config.qtyWait) || 1200 })
        : Promise.resolve({ ok: true, how: 'disabled' });

      const [cartOk, gwRes, qtyRes] = await Promise.all([pCart, pGw, pQty]);

      span.diag('parallel', {
        cart: cartOk, gwCount: gwRes ? gwRes.length : 0,
        qty: qtyRes ? { ok: qtyRes.ok, how: qtyRes.how, ms: qtyRes.ms, from: qtyRes.from, to: qtyRes.to } : null,
        ms: Math.round(performance.now() - runT0)
      });

      // --- سبد ---
      if (!cartOk) {
        step('بررسی سبد', 'fail');
        consume(); K.beep('warn');
        ui.set('⚠️ سبد خرید خالی است؛ پرداخت انجام نشد.', 'bad');
        ui.buttons([]);
        finish(K.FAIL.PAY_NO_CART, 'سبد خالی', { cartCount: S.cartCount() });
        return;
      }
      step('بررسی سبد', 'done');

      // --- تعداد ---
      if (qtyOn) {
        if (qtyRes.ok) {
          step(`تعداد: ${wantQty}`, 'done');
          ui.set(`🧾 ${wantQty} حلقه ✓`);
        } else {
          step(`تعداد: ${wantQty}`, 'fail');
          finish(K.FAIL.PAY_QTY, 'تنظیم تعداد ناموفق بود', { wantQty, ...qtyRes });
          if (K.config.qtyRequired) {
            consume(); K.beep('warn');
            ui.set(`⚠️ تعداد روی ${wantQty} تنظیم نشد؛ پرداخت متوقف شد (به‌خاطر تنظیم شما).`, 'bad');
            ui.buttons([['تلاش دوباره', () => lockRun(() => run(false)), 'ok']]);
            return;
          }
        }
      }

      // --- درگاه ---
      if (!gwRes || !gwRes.length) {
        step('یافتن درگاه', 'fail');
        consume(); K.beep('warn');
        ui.set('⚠️ دکمه‌ی درگاه پیدا نشد؛ خودتان انتخاب و پرداخت کنید.', 'bad');
        ui.buttons([]);
        span.diag('gwDomSample', document.body?.innerText?.slice(0, 800) || null);
        finish(K.FAIL.PAY_NO_GWBTN, 'دکمه‌ی درگاه در DOM نبود', { path: location.pathname });
        return;
      }
      span.diag('gatewaysFound', gwRes.map((x) => ({ key: x.key, name: x.name })));

      const wantKey = (K.config.gateway || '').trim();
      const strategy = K.config.gatewayStrategy || 'first';
      const picked = wantKey ? (gwRes.find((x) => x.key === wantKey) || null) : null;
      const chosen = picked || (strategy === 'random'
        ? gwRes[Math.floor(Math.random() * gwRes.length)]
        : gwRes[0]);

      step('یافتن درگاه', 'done');
      step(`درگاه: ${chosen.name}`, 'now');
      K.log(`درگاه انتخاب‌شده: ${chosen.name} (${chosen.key})`);

      // ══ مرحله D — کلیک درگاه (بدون انتظار بلند) ════════════════════
      const wireHost = chosen.el.closest('[wire\\:id]') || document.querySelector('[wire\\:id]');
      const wire = S.wireOf(wireHost);
      const readGw = () => { try { return wire && wire.$get ? wire.$get('gateway') : undefined; } catch (e) { return undefined; } };

      const gwBefore = readGw();
      if (gwBefore !== chosen.key) {
        S.click(chosen.el);
        // فقط ۴۰۰ms صبر: یا state عوض شد یا شبکه پاسخ داد — نه بیشتر
        const ok = await K.waitFor(() => {
          if (readGw() === chosen.key) return 'state';
          const recent = g.__KVT_NET__?.recent(4) || [];
          for (const r of recent) {
            if (Date.now() - r.t > 900) continue;
            if ((r.kind === 'livewire' || r.kind === 'payment') && r.status === 200) return 'net';
          }
          return null;
        }, 400, 20);
        span.step('کلیک درگاه', { ok, gwBefore, gwAfter: readGw(), ms: span.elapsed() });
      } else {
        span.step('درگاه از قبل انتخاب بود', { gw: gwBefore });
      }
      step(`درگاه: ${chosen.name}`, 'done');

      // ══ مرحله E — پرداخت ═══════════════════════════════════════════
      step('دکمه‌ی پرداخت', 'now');
      const payBtn = await K.waitFor(() => {
        const b = S.payButton();
        return b && !b.disabled && !b.classList.contains('disabled') ? b : null;
      }, Math.max(800, Number(K.config.payBtnWait) || 1400), 20);

      if (!payBtn) {
        step('دکمه‌ی پرداخت', 'fail');
        consume(); K.beep('warn');
        const raw = S.payButton();
        span.diag('payBtnState', raw ? { text: S.norm(raw.textContent), disabled: raw.disabled, cls: raw.className } : null);
        ui.set('⚠️ دکمه‌ی «تایید و پرداخت» فعال نشد؛ خودتان بزنید.', 'warn');
        ui.buttons([['تلاش دوباره', () => lockRun(() => run(false)), 'ok']]);
        finish(K.FAIL.PAY_NO_PAYBTN, 'دکمه‌ی پرداخت آماده نشد', { elapsed: span.elapsed() });
        return;
      }
      step('دکمه‌ی پرداخت', 'done');

      const tries = K.clamp(Number(K.config.payRetries) || 3, 1, 5);
      for (let i = 1; i <= tries && !st.cancelled; i++) {
        consume();
        S.click(payBtn);
        span.step(`کلیک پرداخت ${i}/${tries}`, { atMs: span.elapsed() });
        ui.set(`💳 ارسال شد — انتقال به بانک...`);
        step('کلیک پرداخت', 'now');

        const left = await K.waitFor(() => {
          if (st.handedOff) return 'flag';
          if (K.store.get('navigating', false)) return 'navigating';
          const lr = g.__KVT_NET__?.lastRedirect();
          if (lr && Date.now() - lr.t < 3000) return 'livewire-redirect';
          if (!S.paymentPage()) return 'left-page';
          return null;
        }, Math.max(900, Number(K.config.payRedirectWait) || 1800), 25);

        if (left) {
          st.handedOff = true;
          step('کلیک پرداخت', 'done');
          const total = span.elapsed();
          const hitAt = Number(K.store.get('hitAt', 0)) || 0;
          const sinceHit = hitAt ? Date.now() - hitAt : total;
          const qtyNote = (qtyOn && qtyRes.ok) ? ` · ${wantQty} حلقه` : '';
          const okFast = sinceHit <= 2000;
          ui.timer(sinceHit);
          ui.set(`✅ درگاه بانک باز شد — ${(sinceHit / 1000).toFixed(2)} ثانیه${qtyNote}`
            + (okFast ? ' ⚡' : ' (هدف ۲ ثانیه)'), okFast ? 'ok' : 'warn');
          K.trace?.info('PAY', `⏱ موجود شدن → درگاه: ${sinceHit}ms`, {
            sinceHit, payMs: total, qty: wantQty, qtyOk: qtyRes?.ok, under2s: okFast
          });
          ui.buttons([]);
          finish(null, 'انتقال به درگاه انجام شد', {
            how: left, tries: i, totalMs: total, sinceHit, qty: wantQty, qtyOk: qtyRes?.ok
          });
          K.notify('درگاه بانک باز شد', `${wantQty} حلقه · ${(total / 1000).toFixed(2)}s`);
          return;
        }

        const again = await K.waitFor(() => {
          const b = S.payButton();
          return b && !b.disabled ? b : null;
        }, 500, 20);
        span.step('بازبینی دکمه بعد از کلیک', { found: !!again, elapsed: span.elapsed() });
        if (!again) break;
      }

      if (!st.cancelled && !st.handedOff) {
        step('کلیک پرداخت', 'fail');
        consume(); K.beep('warn');
        ui.set('⚠️ به درگاه منتقل نشدم؛ «تایید و پرداخت» را خودتان بزنید.', 'warn');
        ui.buttons([['تلاش دوباره', () => lockRun(() => run(false)), 'ok']]);
        finish(K.FAIL.PAY_NO_NAV, 'ریدایرکت به بانک انجام نشد', { tries, elapsed: span.elapsed() });
      }
    }

    // ---------- شروع ----------
    setSteps();
    ui.timer(0);

    if (armed && mismatch) {
      span.step('سبد ناهمخوان', { cartIds, armId });
      ui.set('⚠️ سبد شامل آیتم دیگری هم هست؛ برای جلوگیری از پرداخت اشتباه، دستی تایید کنید.', 'warn');
      ui.buttons([['انتخاب درگاه و پرداخت', () => lockRun(() => run(false)), 'ok']]);
      finish(K.FAIL.PAY_GW_UNSET, 'سبد ناهمخوان؛ پرداخت خودکار انجام نشد', { cartIds, armId });
    } else if (armed && K.config.autoPay) {
      ui.set('⚡ پرداخت خودکار...');
      // اجرای فوری، بدون انتظار برای چیز دیگری
      lockRun(() => run(true));
    } else {
      const gws = gatewayList();
      const name = gws.find((x) => x.key === K.config.gateway)?.name || K.config.gateway || '';
      ui.set(armed ? '🛒 سفارش ساخته شد؛ پرداخت خودکار خاموش است.' : 'برای انتخاب درگاه و پرداخت، دکمه را بزنید.', armed ? 'ok' : '');
      ui.buttons([[name ? `انتخاب «${name}» و پرداخت` : 'پرداخت', () => lockRun(() => run(false)), 'ok']]);
      if (armed) K.beep('tick');
    }

    return pageState;
  }

  K.paymentPage = paymentPage;
})(globalThis);
