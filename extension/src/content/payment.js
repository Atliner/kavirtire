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
     * هسته‌ی پرداخت — بدون انتظارهای طولانی.
     * ۱) سبد را چک کن  ۲) دکمه‌ی درگاه را پیدا/انتخاب کن
     * ۳) دکمه‌ی پرداخت را بزن  ۴) منتظر ریدایرکت بمان
     */
    async function run(auto) {
      step('ورود', 'done');
      ui.buttons([['لغو', () => { st.cancelled = true; consume(); ui.set('⏹ لغو شد؛ خودتان ادامه دهید.', 'warn'); ui.buttons([]); finish(null, 'کاربر لغو کرد'); }, 'bad']]);

      // ---------- ۱) سبد ----------
      step('بررسی سبد', 'now');
      const cartOk = await K.waitFor(() => S.cartCount() > 0, 1200, 40);
      if (!cartOk) {
        step('بررسی سبد', 'fail');
        consume(); K.beep('warn');
        ui.set('⚠️ سبد خرید خالی است؛ پرداخت انجام نشد.', 'bad');
        ui.buttons([]);
        finish(K.FAIL.PAY_NO_CART, 'سبد خالی', { cartCount: S.cartCount() });
        return;
      }
      step('بررسی سبد', 'done');

      // ---------- ۲) دکمه‌ی درگاه -------------------------------------------------
      step('یافتن درگاه', 'now');
      // حداکثر ۳ ثانیه؛ اولین بار معمولاً زیر ۱۰۰ms است
      const gwList = await K.waitFor(() => {
        const l = S.gatewayButtons();
        return l.length ? l : null;
      }, 3000, 30);

      if (!gwList || !gwList.length) {
        step('یافتن درگاه', 'fail');
        consume(); K.beep('warn');
        ui.set('⚠️ دکمه‌ی درگاه پیدا نشد؛ خودتان انتخاب و پرداخت کنید.', 'bad');
        ui.buttons([]);
        span.diag('gwDomSample', document.body?.innerText?.slice(0, 800) || null);
        finish(K.FAIL.PAY_NO_GWBTN, 'دکمه‌ی درگاه در DOM نبود', { path: location.pathname });
        return;
      }
      span.diag('gatewaysFound', gwList.map((x) => ({ key: x.key, name: x.name })));

      // انتخاب: اولویت با درگاه تنظیم‌شده، بعد «اولی» یا «تصادفی»
      const wantKey = (K.config.gateway || '').trim();
      const strategy = K.config.gatewayStrategy || 'first';
      const picked = wantKey ? (gwList.find((x) => x.key === wantKey) || null) : null;
      const chosen = picked || (strategy === 'random'
        ? gwList[Math.floor(Math.random() * gwList.length)]
        : gwList[0]);

      step('یافتن درگاه', 'done');
      step(`درگاه: ${chosen.name}`, 'now');
      ui.set(`⚡ ${chosen.name}`);

      K.log(`درگاه انتخاب‌شده: ${chosen.name} (${chosen.key})`);

      // ---------- ۳) کلیک روی درگاه ------------------------------------------------
      const wireHost = chosen.el.closest('[wire\\:id]') || document.querySelector('[wire\\:id]');
      const wire = S.wireOf(wireHost);
      const readGw = () => { try { return wire && wire.$get ? wire.$get('gateway') : undefined; } catch (e) { return undefined; } };

      const gwBefore = readGw();
      if (gwBefore !== chosen.key) {
        S.click(chosen.el);
        // انتظار کوتاه و هوشمند: یا state عوض شود، یا شبکه پاسخ دهد (حداکثر ۱.۲ ثانیه)
        const ok = await K.waitFor(() => {
          const now = readGw();
          if (now === chosen.key) return 'state';
          const recent = g.__KVT_NET__?.recent(5) || [];
          for (const r of recent) {
            if (Date.now() - r.t > 1500) continue;
            if (r.kind === 'livewire' && r.status === 200) return 'net';
          }
          return null;
        }, 1200, 30);
        span.step('کلیک درگاه', { ok, gwBefore, gwAfter: readGw(), ms: span.elapsed() });
        if (!ok && readGw() !== undefined && readGw() !== chosen.key) {
          // آخرین سعی مستقیم با API کامپوننت
          try { await wire?.$call?.('setGateway', chosen.key); } catch (e) { /* noop */ }
        }
      } else {
        span.step('درگاه از قبل انتخاب بود', { gw: gwBefore });
      }
      step(`درگاه: ${chosen.name}`, 'done');

      // ---------- ۴) دکمه‌ی پرداخت -------------------------------------------------
      step('دکمه‌ی پرداخت', 'now');
      const payBtn = await K.waitFor(() => {
        const b = S.payButton();
        return b && !b.disabled && !b.classList.contains('disabled') ? b : null;
      }, Math.max(1200, Number(K.config.payBtnWait) || 2500), 25);

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

      // ---------- ۵) کلیک پرداخت ---------------------------------------------------
      const tries = K.clamp(Number(K.config.payRetries) || 3, 1, 5);
      for (let i = 1; i <= tries && !st.cancelled; i++) {
        consume();
        const clickMs = span.elapsed();
        S.click(payBtn);
        span.step(`کلیک پرداخت ${i}/${tries}`, { clickMs });
        ui.set(`💳 ارسال شد (${K.fa(i)}/${K.fa(tries)}) — انتقال به بانک...`);
        step('کلیک پرداخت', 'now');

        // ریدایرکت را از شبکه بگیر (سریع‌تر از DOM)
        const left = await K.waitFor(() => {
          if (st.handedOff) return 'flag';
          if (K.store.get('navigating', false)) return 'navigating';
          const lr = g.__KVT_NET__?.lastRedirect();
          if (lr && Date.now() - lr.t < 4000) return 'livewire-redirect';
          if (!S.paymentPage()) return 'left-page';
          return null;
        }, Math.max(1500, Number(K.config.payRedirectWait) || 3000), 40);

        if (left) {
          st.handedOff = true;
          step('کلیک پرداخت', 'done');
          const total = span.elapsed();
          ui.timer(total);
          ui.set(total <= TARGET_MS
            ? `✅ درگاه بانک باز شد (${(total / 1000).toFixed(2)} ثانیه)`
            : `✅ درگاه بانک باز شد (${(total / 1000).toFixed(2)} ثانیه)`, 'ok');
          ui.buttons([]);
          finish(null, 'انتقال به درگاه انجام شد', { how: left, tries: i, totalMs: total });
          K.notify('درگاه بانک باز شد', `پرداخت را سریع تکمیل کنید (${(total / 1000).toFixed(2)}s)`);
          return;
        }

        // دکمه را دوباره پیدا کن (ممکن است Livewire دوباره رندر کرده باشد)
        const again = await K.waitFor(() => {
          const b = S.payButton();
          return b && !b.disabled ? b : null;
        }, 800, 30);
        span.step('بازبینی دکمه بعد از کلیک', { found: !!again, elapsed: span.elapsed() });
        if (!again) break;
      }

      if (!st.cancelled && !st.handedOff) {
        step('کلیک پرداخت', 'fail');
        consume(); K.beep('warn');
        ui.set('⚠️ به درگاه منتقل نشدم؛ «تایید و پرداخت» را خودتان بزنید.', 'warn');
        ui.buttons([['تلاش دوباره', () => lockRun(() => run(false)), 'ok']]);
        finish(K.FAIL.PAY_NO_NAV, 'ریدایرکت به بانک انجام نشد', {
          tries, elapsed: span.elapsed(),
          net: g.__KVT_NET__?.recent(8) || null
        });
      }
    }

    // ---------- شروع ----------
    // انتظار گذرا: صفحه ممکن است هنوز کامل رندر نشده باشد
    setSteps();
    ui.timer(0);

    if (armed && mismatch) {
      span.warn = span.warn || (() => {});
      span.step('سبد ناهمخوان', { cartIds, armId });
      ui.set('⚠️ سبد شامل آیتم دیگری هم هست؛ برای جلوگیری از پرداخت اشتباه، دستی تایید کنید.', 'warn');
      ui.buttons([[`انتخاب درگاه و پرداخت`, () => lockRun(() => run(false)), 'ok']]);
      finish(K.FAIL.PAY_GW_UNSET, 'سبد ناهمخوان؛ پرداخت خودکار انجام نشد', { cartIds, armId });
    } else if (armed && K.config.autoPay) {
      ui.set('⚡ پرداخت خودکار...');
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
