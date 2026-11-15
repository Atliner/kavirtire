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
      try {
        const cool = guard.cooldownLeft();
        if (cool > 0) {
          state.nextAt = Date.now() + cool;
          E.note(`⏳ استراحت محافظتی: ${Math.ceil(cool / 1000)} ثانیه (پاسخ محدودیت)`, 'warn');
          emit('guard', guard.snapshot());
          return schedule(cool);
        }
        res = await viaApi();
        if (!state.running) return;

        if (!res.ok && res.limited) {
          state.errors++;
          const w = Math.max(res.wait || 0, Number(K.config.interval) || 1200);
          E.note(`⚠️ محدودیت سرور (${res.reason === 'budget' ? 'بودجه‌ی نرخ' : (res.status || 429)}) — برگشت بعد از ${(w / 1000).toFixed(1)} ثانیه`, 'warn');
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

        // فقط محصولاتی که در همین چرخه تازه «موجود» شده‌اند (نه موجودهای قدیمی)
        const fresh = detect(products).filter((id) => !state.hits.includes(id));
        state.checks++;
        state.checksOk = (state.checksOk || 0) + 1;
        state.lastOkAt = Date.now();
        establishBaseline(products);
        state.prev = { ...state.prev, ...products };

        if (fresh.length) {
          state.hits.push(...fresh);
          const list = K.site.products();
          const first = list.find((p) => String(p.id) === String(fresh[0]))
            || state.watching.map((id) => list.find((p) => String(p.id) === String(id))).find(Boolean);
          state.hit = first ? first.id : fresh[0];
          emit('hit', { ids: fresh, first: state.hit });
          K.notify('موجود شد! 🛞', first ? first.full : `محصول ${fresh[0]}`);
          if (K.config.stopAfterHit) E.stop('خرید موفق');
          return; // onHit جریان را می‌گیرد
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
    async function onHit(ids) {
      if (state.busy) return;
      state.busy = true;
      clearTimeout(state.timer);

      const prods = K.site.products();
      const wanted = ids.map(String).map((id) => prods.find((p) => String(p.id) === id)).filter(Boolean);
      const target = wanted[0] || null;

      emit('grab', { id: target?.id || ids[0], title: target?.full || '' });
      E.note(`🎯 موجود شد: ${target?.full || ids[0]}`, 'ok');

      if (!K.config.autoAdd) {
        state.busy = false;
        emit('run', { running: false });
        return;
      }
      if (!target) {
        E.note('کارت محصول در صفحه پیدا نشد؛ صفحه را نوسازی کنید.', 'warn');
        state.busy = false;
        return;
      }

      // علامت خرید را قبل از ریدایرکت ذخیره می‌کنیم (فقط کارت خودمان)
      K.store.set('arm', { t: Date.now(), id: String(target.id) });
      emit('arm', { arm: true, id: String(target.id) });

      const tries = K.clamp(Number(K.config.payRetries) || 3, 1, 6);
      for (let i = 1; i <= tries && !state.cancel; i++) {
        if (i > 1) E.note(`تلاش ${K.fa(i)}/${K.fa(tries)} برای افزودن`, 'warn');
        const r = await S.addToCart(target, { guard });
        if (!r.ok) { E.note('⚠️ ' + r.reason, 'warn'); break; }

        // منتظر علامت موفقیت یا ریدایرکت
        const el = S.cardById(target.id) || target.el;
        const done = await K.waitFor(() => S.addedSignals(el), 3500, 60);
        if (done) {
          E.note('✅ به سبد اضافه شد؛ رفتن به درگاه...', 'ok');
          state.running = false;
          releaseOwner();
          emit('run', { running: false });
          state.busy = false;
          if (!S.paymentPage()) {
            // ریدایرکت ممکن است خودش انجام شده باشد؛ کمی صبر بعد فالبک
            await K.sleep(600);
            if (!K.store.get('navigating', false) && !S.paymentPage()) {
              location.href = K.config.paymentUrl || '/esale/payment';
            }
          }
          return;
        }
        S.closePopups();
        await K.sleep(500);
      }

      K.store.del('arm');
      emit('arm', { arm: false });
      state.busy = false;
      if (state.cancel) return;
      E.note('⚠️ افزودن خودکار نشد؛ پایش ادامه دارد.', 'warn');
      if (state.running) schedule(Math.max(Number(K.config.interval) || 1200, 800));
    }
    E.onHit = onHit;

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
