/*
 * Kavirtire FastBuy — Engine (MAIN world)
 *
 * موتور پایش موجودی. جایگزین رفرش مکرر صفحه:
 *  - درخواست‌های سبک JSON از API موجودی
 *  - احترام کامل به 429 / Retry-After با backoff نمایی و بودجه‌ی سراسری
 *  - صف اولویت‌دار برای محصولات انتخاب‌شده (اولویت کاربر)
 *  - فالبک اختیاری «چک از طریق صفحه» فقط اگر کاربر روشن کند
 *  - هشدار پیش‌بینی‌شده‌ی افت/اتمام (detect transition)
 */
(function (g) {
  'use strict';
  const K = g.__KVTB = g.__KVTB || {};
  const S = K.site;

  function createEngine() {
    const guard = K.createGuard();
    const state = {
      running: false,
      armed: false,
      busy: false,
      cancel: false,
      timer: null,
      tickNo: 0,
      mode: 'idle',           // idle | api | page
      lastAt: 0,
      lastOkAt: 0,
      latency: null,
      products: {},           // آخرین وضعیت { [id]: {available, exhausted} }
      prev: {},
      hits: [],
      errors: 0,
      pageMul: 1,
      pageHits: [],
      pageBlockedUntil: 0,
      nextAt: 0,
      watching: [],           // id های انتخاب‌شده
      history: [],            // رویدادهای مهم
      startedAt: 0,
      checks: 0,
      hit: null
    };
    K.engineState = state;

    const E = { state, guard };
    const OWNER_TTL = 25000;

    // ---- مالکیت پایش (جلوگیری از دو تب که همزمان درخواست می‌فرستند) ----
    function readOwner() {
      const o = K.store.get('owner', null);
      if (!o || !o.id) return null;
      if (Date.now() - (o.at || 0) > OWNER_TTL) return null;
      return o;
    }
    function claimOwner() {
      const cur = readOwner();
      if (cur && cur.id !== guard.tabId) return false;
      K.store.set('owner', { id: guard.tabId, at: Date.now() });
      return true;
    }
    function releaseOwner() {
      const cur = readOwner();
      if (cur && cur.id === guard.tabId) K.store.del('owner');
    }
    function refreshOwner() {
      const cur = readOwner();
      if (cur && cur.id === guard.tabId) K.store.set('owner', { id: guard.tabId, at: Date.now() });
    }
    E.ownerId = () => readOwner()?.id || null;
    E.hasOwner = () => { const o = readOwner(); return !!o && o.id === guard.tabId; };

    const emit = (t, d) => K.emit(t, d);

    E.log = (msg, kind = 'info') => { K.log(msg, kind); };
    E.note = (msg, kind = 'info') => {
      state.history.push({ t: Date.now(), msg, kind });
      if (state.history.length > 40) state.history.shift();
      E.log(msg, kind);
    };

    // ---------- منابع ----------
    async function viaApi() {
      state.mode = 'api';
      const t0 = performance.now();
      const r = await S.fetchAvailability(guard);
      state.latency = Math.round(performance.now() - t0);
      if (r.ok) { state.lastOkAt = Date.now(); state.errors = 0; return { ok: true, products: r.products, via: 'api' }; }
      if (r.limited) return { ok: false, limited: true, wait: r.wait, reason: r.reason, status: r.status };
      if (r.auth) return { ok: false, auth: true, error: r.error };
      state.errors++;
      return { ok: false, error: r.error || 'خطا' };
    }

    async function viaPage() {
      const gate = pageGate();
      if (gate > 0) return { ok: false, wait: gate, reason: 'page-budget' };
      state.mode = 'page';
      state.pageHits.push(Date.now());
      const t0 = performance.now();
      const r = await S.fetchPageAvailability(guard);
      state.latency = Math.round(performance.now() - t0);
      if (r.ok) { state.lastOkAt = Date.now(); return { ok: true, products: r.products, via: 'page' }; }
      if (r.limited) {
        state.pageMul = Math.min(state.pageMul * 1.5, 5);
        state.pageBlockedUntil = Date.now() + (r.wait || 4000);
        return { ok: false, limited: true, wait: r.wait, reason: r.reason, status: r.status };
      }
      state.pageMul = Math.min(state.pageMul * 1.25, 4);
      return { ok: false, error: r.error || 'خطای صفحه' };
    }

    const pageGate = () => {
      const now = Date.now();
      if (now < state.pageBlockedUntil) return state.pageBlockedUntil - now;
      const cap = K.clamp(Number(K.config.pageMaxPerMinute) || 8, 1, 30);
      state.pageHits = state.pageHits.filter((t) => now - t < 60000);
      if (state.pageHits.length >= cap) return state.pageHits[0] + 60000 - now + 200;
      return 0;
    };
    const pageGap = () => Math.max(Number(K.config.pageInterval) || 6000, 2000) * state.pageMul;

    // ---------- منطق انتخاب و اولویت ----------
    function watching() {
      const sel = new Set((K.config.selected || []).map(String));
      const prio = (K.config.priority || []).map(String);
      const ids = [...sel];
      ids.sort((a, b) => {
        const ia = prio.indexOf(a), ib = prio.indexOf(b);
        return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
      });
      return ids;
    }

    function setWatching() {
      state.watching = watching();
      state.armed = state.watching.length > 0;
      emit('watch', { watching: state.watching });
    }
    E.setWatching = setWatching;

    // ---------- تشخیص «موجود شد» ----------
    // اصل: فقط گذارِ «ناموجود → موجود» خرید محسوب می‌شود، نه محصولی که
    // از قبل موجود بوده. اگر کاربر بخواهد فوراً موجود‌ها را هم بخرد،
    // buyIfAlreadyAvailable را روشن می‌کند.
    function detect(products) {
      const founded = [];
      for (const id of state.watching) {
        const cur = products[id];
        if (!cur || !cur.available) continue;
        const before = state.prev[id];
        const wasAvail = !!(before && before.available);
        if (wasAvail) continue;
        if (state.baselineDone) founded.push(id);               // گذار واقعی
        else if (K.config.buyIfAlreadyAvailable) founded.push(id); // اولین چرخه + اجازه‌ی کاربر
      }
      return founded;
    }

    /** ثبت وضعیت اولیه تا موجودیِ از قبل موجود، خرید تلقی نشود */
    function establishBaseline(products) {
      if (state.baselineDone) return;
      if (!state.watching.length) return;
      let known = 0;
      for (const id of state.watching) if (products[id]) known++;
      if (known < Math.max(1, Math.ceil(state.watching.length * 0.6))) return;
      state.prev = { ...state.prev, ...products };
      state.baselineDone = true;
      const availNow = state.watching.filter((id) => products[id]?.available).length;
      K.trace?.info('DETECT', 'خط مبنا ثبت شد', { availNow, watching: state.watching.length, products: Object.keys(products).length });
      E.note(availNow
        ? `خط مبنا ثبت شد؛ ${K.fa(availNow)} محصول همین حالا موجود است و منتظر تغییر بعدی می‌مانیم.`
        : 'خط مبنا ثبت شد؛ منتظر موجود شدن محصولات…', 'info');
      emit('baseline', { availNow });
    }

    // ---------- یک تیک ----------
    async function tick() {
      if (!state.running) return;
      state.tickNo++;
      refreshOwner();
      const started = performance.now();
      state.lastAt = Date.now();
      let next = Math.max(Number(K.config.interval) || 1200, 500);
      if (K.config.jitter) next = next * (0.82 + Math.random() * 0.36);

      let res;
      const T = K.trace;
      try {
        const cool = guard.cooldownLeft();
        if (cool > 0) {
          state.nextAt = Date.now() + cool;
          E.note(`⏳ استراحت محافظتی: ${Math.ceil(cool / 1000)} ثانیه (پاسخ محدودیت)`, 'warn');
          T.warn('WATCH', 'چرخه به دلیل استراحت محافظتی رد شد', { cool, tick: state.tickNo }, K.FAIL.WATCH_429);
          emit('guard', guard.snapshot());
          return schedule(cool);
        }
        res = await viaApi();
        if (!state.running) return;

        if (!res.ok && res.limited) {
          state.errors++;
          const w = Math.max(res.wait || 0, Number(K.config.interval) || 1200);
          E.note(`⚠️ محدودیت سرور (${res.reason === 'budget' ? 'بودجه‌ی نرخ' : (res.status || 429)}) — برگشت بعد از ${(w / 1000).toFixed(1)} ثانیه`, 'warn');
          T.debug('WATCH', 'محدودیت/بودجه', {
            reason: res.reason, status: res.status, wait: Math.round(w),
            guard: guard.snapshot(), tick: state.tickNo
          });
          emit('guard', guard.snapshot());
          if (!K.config.pageFallback) return schedule(w);
          // فالبک: صفحه
          res = await viaPage();
          if (!state.running) return;
          if (!res.ok) {
            const w2 = Math.max(res.wait || pageGap(), 2000);
            return schedule(Math.min(w2, Math.max(w, 2000)));
          }
        } else if (!res.ok && res.auth) {
          state.running = false;
          emit('run', { running: false });
          E.note('🔒 نشست منقضی شده؛ صفحه را یک‌بار نوسازی کنید و دوباره شروع کنید.', 'warn');
          K.notify('نشست منقضی شد', 'کویرتایر: برای ادامه‌ی پایش وارد حساب شوید.');
          return;
        } else if (!res.ok) {
          const w = Math.min(5000 * Math.pow(1.4, Math.min(state.errors, 5)), 30000);
          state.errors++;
          E.note(`⚠️ خطا: ${res.error || 'ناشناخته'} — تلاش بعدی ${Math.round(w / 1000)} ثانیه`, 'warn');
          return schedule(w);
        }

        // موفق
        const products = res.products || {};
        state.products = products;
        emit('data', { products, via: res.via, latency: state.latency });
        if (state.tickNo % 20 === 0) {
          T.debug('WATCH', 'چرخه‌ی موفق', {
            tick: state.tickNo, via: res.via, latency: state.latency,
            avail: Object.values(products).filter((x) => x && x.available).length
          });
        }

        // فقط محصولاتی که در همین چرخه تازه «موجود» شده‌اند (نه موجودهای قدیمی)
        const fresh = detect(products).filter((id) => !state.hits.includes(id));
        state.checks++;
        state.checksOk = (state.checksOk || 0) + 1;
        state.lastOkAt = Date.now();
        establishBaseline(products);
        state.prev = { ...state.prev, ...products };

        if (fresh.length) {
          // ⏱ شروع زمان‌سنج «موجود شد → درگاه باز شد»
          const hitAt = Date.now();
          K.store.set('hitAt', hitAt);
          K.store.set('purchaseId', String(fresh[0]));
          T.info('DETECT', 'گذار ناموجود → موجود', {
            fresh, prev: Object.fromEntries(fresh.map((id) => [id, state.prev[id] || null])),
            now: Object.fromEntries(fresh.map((id) => [id, products[id] || null])),
            baseline: state.baselineDone, tick: state.tickNo
          });
          state.hits.push(...fresh);
          const list = K.site.products();
          const first = list.find((p) => String(p.id) === String(fresh[0]))
            || state.watching.map((id) => list.find((p) => String(p.id) === String(id))).find(Boolean);
          state.hit = first ? first.id : fresh[0];
          // ⚠️ «موجود شد» یعنی فقط تشخیص داده شد — نه این‌که خرید موفق بوده.
          // هرگز پیام «خرید موفق» نده تا وقتی واقعاً در سبد درج نشده باشد.
          emit('hit', { ids: fresh, first: state.hit });
          return; // onHit جریان را می‌گیرد و در پایان خودش وضعیت را می‌بندد
        }

        const rem = Math.max(0, next - (performance.now() - started));
        return schedule(rem);
      } catch (e) {
        state.errors++;
        E.note('خطای غیرمنتظره: ' + (e.message || e), 'warn');
        return schedule(4000);
      }
    }

    function schedule(ms) {
      clearTimeout(state.timer);
      const wait = K.clamp(Number(ms) || 0, 0, 30 * 60000);
      state.nextAt = Date.now() + wait;
      emit('tick', { nextAt: state.nextAt });
      if (!state.running) return;
      state.timer = setTimeout(tick, wait);
    }

    // ---------- خرید ----------
    // درس گرفته‌شده از لاگ واقعی:
    //  • «⏹ خرید موفق» نباید قبل از موفقیت واقعی لاگ شود  → اینجا فقط بعد از درج در سبد
    //  • انتظار DOM (تا ۳.۵ ثانیه) تلف‌کننده بود          → تشخیص از پاسخ شبکه
    //  • بعد از شکست، خط مبنا ریست می‌شد                  → حالا حفظ می‌شود
    async function onHit(ids) {
      if (state.busy) return;
      state.busy = true;
      clearTimeout(state.timer);

      const tid = 'p' + Date.now().toString(36);
      state.lastPurchase = tid;
      const prods = K.site.products();
      const wanted = ids.map(String).map((id) => prods.find((p) => String(p.id) === id)).filter(Boolean);
      const target = wanted[0] || null;
      const T = K.trace;

      const span = T.start('ADD', `شروع خرید ${target?.full || ids[0]}`, {
        tid, id: target?.id || ids[0], gatewaysInConfig: K.config.gateway, tried: ids
      });
      span.diag('card', target ? {
        id: target.id, title: target.title, size: target.size,
        status: K.site.status(target.el),
        hasAddBtn: !!target.el?.querySelector('.product-add-button'),
        wireId: target.el?.getAttribute?.('wire:id') || null
      } : null);
      span.diag('netBefore', g.__KVT_NET__ ? g.__KVT_NET__.recent(6) : null);
      emit('purchase', { tid, phase: 'start', id: target?.id || ids[0] });
      emit('grab', { id: target?.id || ids[0], title: target?.full || '' });

      if (!K.config.autoAdd) {
        span.ok('خرید خودکار خاموش است');
        state.busy = false;
        emit('run', { running: false });
        return;
      }
      if (!target) {
        span.fail(K.FAIL.ADD_NO_ELEMENT, 'کارت محصول در صفحه پیدا نشد', { ids });
        E.note('کارت محصول پیدا نشد؛ صفحه را نوسازی کنید.', 'warn');
        state.busy = false;
        return;
      }

      // علامت خرید فقط برای صفحه‌ی پرداخت
      K.store.set('arm', { t: Date.now(), id: String(target.id), tid });
      emit('arm', { arm: true, id: String(target.id), tid });

      const tries = K.clamp(Number(K.config.payRetries) || 3, 1, 6);
      // مهلت درج در سبد: باید خیلی کوتاه باشد (هدف: زیر ۲ ثانیه)
      const perTryBudget = Math.max(600, Math.min(Number(K.config.addTimeout) || 1600, 4000));
      let lastFail = null;

      for (let i = 1; i <= tries && !state.cancel; i++) {
        const trySpan = span.step(`تلاش ${i}/${tries}`, { budget: perTryBudget });
        const r = await K.site.addToCart(target, {
          onEvent: (ev) => {
            span.diag('addEvent', ev);
            if (ev.type === 'add-rejected') span.diag('addRejected', ev);
          }
        });
        span.step('نتیجه addToCart', { sent: r.sent, method: r.method, reason: r.reason, code: r.code });

        if (!r.sent) {
          lastFail = { code: r.code || K.FAIL.ADD_NO_METHOD, reason: r.reason, status: r.status };
          span.diag('noSend', lastFail);
          // اگر هیچ روش افزودنی روی کارت نیست، تکرار بی‌فایده است
          if (r.code === 'ADD_NO_METHOD' || r.code === 'ADD_NO_ELEMENT') break;
          await K.sleep(100);
          continue;
        }

        // انتظار برای نتیجه — با بودجه‌ی کوتاه
        const res = await r.wait(perTryBudget);
        span.step('نتیجه انتظار', res);

        if (res.ok) {
          // ✅ درج در سبد قطعی شد
          const ms = span.elapsed();
          span.ok('درج در سبد موفق', { how: res.how, totalMs: ms, try: i });
          T.info('ADD', `✅ در سبد: ${target.full} (${ms}ms، روش ${res.how})`, { tid, how: res.how });

          state.running = false;
          releaseOwner();
          state.busy = false;
          emit('run', { running: false });
          const hitAt = Number(K.store.get('hitAt', 0)) || 0;
          const sinceHit = hitAt ? Date.now() - hitAt : ms;
          E.note(`✅ به سبد اضافه شد (${K.fa(ms)}ms)`, 'ok');
          T.info('ADD', `⏱ از موجود شدن تا سبد: ${K.fa(sinceHit)}ms`, {
            tid, sinceHit, addMs: ms, how: res.how
          });
          if (!K.config.stopAfterHit) {
            // کاربر می‌خواهد پایش ادامه یابد؛ بعد از هدایت به پرداخت از سر می‌گیریم
            K.store.set('resumeAfterPay', true);
          }
          emit('purchase', { tid, phase: 'added', how: res.how, ms });

          // هدایت فوری به پرداخت — موازی، بدون اتلاف
          await goToPayment(tid);
          return;
        }

        lastFail = {
          code: res.code || K.FAIL.ADD_NOT_SELECTED,
          how: res.how, status: res.status, body: res.body,
          err: res.err, ms: res.ms
        };
        span.step('تلاش ناموفق', lastFail);
        lastFail = null;

        // 419/429: توقف تلاش‌های بیشتر برای این محصول (بی‌فایده است)
        if (res.status === 419) {
          span.fail(K.FAIL.ADD_SERVER_419, 'نشست منقضی شد (۴۱۹)؛ صفحه را نوسازی کنید', res);
          K.notify('نشست منقضی شد', 'کویرتایر: صفحه را نوسازی و دوباره وارد شوید.');
          K.store.del('arm');
          emit('arm', { arm: false });
          state.busy = false;
          emit('run', { running: false });
          return;
        }
        if (res.status === 429) {
          span.fail(K.FAIL.ADD_SERVER_429, 'محدودیت نرخ هنگام افزودن (۴۲۹)', res);
          guard.limited(0, 429, 'api');
          break;
        }
        K.site.closePopups();
        await K.sleep(150);
      }

      // ❌ شکست کامل: خط مبنا را ریست نمی‌کنیم؛ فقط این محصول را دوباره تلاش‌پذیر می‌کنیم
      const code = lastFail?.code || K.FAIL.ADD_NOT_SELECTED;
      span.fail(code, 'افزودن خودکار به سبد ناموفق ماند', { tries, lastFail });
      T.warn('ADD', `❌ افزودن ناموفق: ${target.full}`, { code, tries });
      emit('purchase', { tid, phase: 'failed', code });

      // شبکه برای تشخیص بعدی: این محصول دوباره کاندید شود
      state.hits = state.hits.filter((x) => String(x) !== String(target.id));
      // وضعیت قبلی را پاک کن تا گذار بعدی دوباره تشخیص داده شود
      if (state.prev[target.id]) delete state.prev[target.id];

      K.store.del('arm');
      emit('arm', { arm: false });
      state.busy = false;
      if (state.cancel) return;

      E.note(`⚠️ افزودن نشد (${code})؛ پایش ادامه دارد — دوباره تلاش می‌شود.`, 'warn');
      if (state.running) schedule(Math.max(Number(K.config.interval) || 1200, 800));
      else E.start();
    }

    /** هدایت سریع به صفحه‌ی پرداخت با تشخیص پیش‌دستانه‌ی ریدایرکت Livewire */
    async function goToPayment(tid) {
      const T = K.trace;
      const span = T.start('NAV', 'رفتن به صفحه‌ی پرداخت');
      const t0 = performance.now();

      // Livewire خودش معمولاً ریدایرکت می‌کند؛ کوتاه صبر می‌کنیم
      const red = await K.waitFor(() => {
        if (K.store.get('navigating', false)) return { how: 'navigating' };
        if (K.site.isPaymentRendered()) return { how: 'rendered' };
        const lr = g.__KVT_NET__?.lastRedirect();
        if (lr && Date.now() - lr.t < 2500) return { how: 'livewire-redirect', url: lr.redirect };
        return null;
      }, Math.max(400, Number(K.config.navWait) || 900), 40);

      if (red) {
        span.ok('ریدایرکت خودکار انجام شد', { ...red, ms: span.elapsed() });
        return { ok: true, ...red };
      }

      // فالبک: خودمان می‌رویم
      const url = K.config.paymentUrl || '/esale/payment';
      span.step('فالبک: ناوبری دستی', { url });
      try {
        location.href = url;
        span.ok('ناوبری دستی به پرداخت', { url, ms: Math.round(performance.now() - t0) });
        return { ok: true, how: 'manual' };
      } catch (e) {
        span.fail(K.FAIL.NAV_FAILED, 'ناوبری به پرداخت شکست خورد', { url, err: String(e && e.message || e) });
        K.notify('خطای ناوبری', 'به‌صورت دستی به سبد خرید بروید.');
        return { ok: false };
      }
    }
    E.goToPayment = goToPayment;

    // ---------- کنترل ----------
    E.start = () => {
      setWatching();
      if (!state.watching.length) { E.note('اول یک محصول انتخاب کنید.', 'warn'); return false; }
      if (state.running) return true;
      if (guard.cooldownLeft() > 0) {
        E.note(`⏳ تا ${Math.ceil(guard.cooldownLeft() / 1000)} ثانیه‌ی دیگر در استراحت هستیم.`, 'warn');
      }
      if (!claimOwner()) {
        const o = readOwner();
        E.note('تب دیگری در حال پایش است؛ برای جلوگیری از محدودیت، همزمان پایش نمی‌کنیم.', 'warn');
        emit('owner', { owner: o?.id || null, mine: false });
        return false;
      }
      emit('owner', { owner: guard.tabId, mine: true });
      state.running = true; state.cancel = false; state.hits = []; state.errors = 0;
      state.baselineDone = false; state.prev = {};
      state.startedAt = Date.now(); state.checks = 0; state.pageMul = 1; state.pageHits = []; state.pageBlockedUntil = 0;
      try { K.bridge.fire('monitor:claim', { tab: guard.tabId }); } catch (e) { /* noop */ }
      emit('run', { running: true });
      K.trace?.info('WATCH', 'پایش شروع شد', {
        watching: state.watching, interval: K.config.interval, cap: K.config.maxPerMinute,
        guard: guard.snapshot(), preset: K.config.preset
      });
      E.note('▶ پایش شروع شد (' + K.fa(state.watching.length) + ' محصول)', 'ok');
      tick();
      return true;
    };

    E.stop = (reason) => {
      if (!state.running) return;
      state.running = false;
      clearTimeout(state.timer);
      releaseOwner();
      emit('owner', { owner: null, mine: false });
      try { K.bridge.fire('monitor:release', null); } catch (e) { /* noop */ }
      emit('run', { running: false });
      K.trace?.info('WATCH', 'پایش متوقف شد', {
        reason, checks: state.checks, checksOk: state.checksOk, hits: state.hits, errors: state.errors
      });
      E.note('⏹ پایش متوقف شد' + (reason ? ' — ' + reason : ''), 'info');
    };

    /** خرید فوری: بدون منتظر ماندن برای تغییر موجودی. */
    E.buyNow = (ids) => {
      const list = (ids && ids.length) ? ids.map(String) : state.watching.slice();
      if (!list.length) { E.note('محصولی انتخاب نشده است.', 'warn'); return false; }
      if (state.busy) return false;
      if (state.running) E.stop('خرید فوری');
      K.log('خرید فوری برای: ' + list.join(', '), 'ok');
      onHit(list);
      return true;
    };

    E.resetHits = () => {
      state.hits = [];
      state.baselineDone = false;
      state.prev = {};
      E.note('خط مبنا و سابقه‌ی موجودی پاک شد؛ آماده‌ی تشخیص مجدد.', 'info');
    };
    E.products = () => K.site.products();
    E.snapshot = () => ({
      ...state,
      timer: !!state.timer,
      guard: guard.snapshot(),
      watching: state.watching.slice()
    });

    K.on('hit', ({ ids }) => { onHit(ids); });
    // اگر تب دیگری محدود شد، ما هم عقب بکشیم
    window.addEventListener('storage', (ev) => {
      if (ev.key === 'kvt:guard') emit('guard', guard.snapshot());
      if (ev.key === 'kvt:owner') emit('owner', { owner: readOwner()?.id || null, mine: E.hasOwner() });
    });

    K.on('lw-fail', ({ status }) => {
      if (status === 419) {
        E.stop('نشست منقضی شد');
        K.notify('نشست منقضی شد', 'کویرتایر: صفحه را نوسازی کنید.');
      } else if (status === 429) {
        guard.limited(0, 429, 'api');
        emit('guard', guard.snapshot());
      }
    });

    // آزادسازی شنونده‌ها هنگام ترک صفحه (جلوگیری از نشت)
    const offs = [];
    offs.push(K.on('config', () => { setWatching(); if (state.running) schedule(Math.min(Number(K.config.interval) || 1200, 5000)); }));
    E.destroy = () => {
      E.stop('آزادسازی');
      offs.forEach((f) => { try { f(); } catch (e) { /* noop */ } });
      state.timer = null;
    };

    setWatching();
    return E;
  }

  K.createEngine = createEngine;
})(globalThis);
