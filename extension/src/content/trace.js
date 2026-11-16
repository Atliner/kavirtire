/*
 * Kavirtire FastBuy — Trace (MAIN world)
 *
 * موتور «لاگ حرفه‌ای» — کاملاً جدا از لاگ کاربر عادی.
 *
 * هر اقدام ربات به‌صورت یک «بازه» (span) با مرحله، کد، مدت‌زمان و داده‌ی
 * تشخیصی ثبت می‌شود تا وقتی خریدی ناموفق شد، دقیقاً معلوم شود کجای زنجیره
 * شکست خورده: تشخیص موجودی؟ ارسال add؟ پاسخ سرور؟ مورف Livewire؟
 * ریدایرکت؟ انتخاب درگاه؟ کلیک پرداخت؟
 *
 * مراحل (stage):
 *   BOOT  راه‌اندازی افزونه
 *   WATCH پایش موجودی (هر چرخه)
 *   DETECT تشخیص گذار ناموجود→موجود
 *   ADD   افزودن به سبد
 *   NAV   رفتن به صفحه‌ی پرداخت
 *   PAY   انتخاب درگاه و تایید پرداخت
 *   NET   مشاهده‌ی درخواست/پاسخ شبکه (Livewire)
 *   CFG   تغییر تنظیمات
 *
 * سطوح: debug | info | warn | error
 * کدها: ثابت‌های FAIL.* در ادامه
 */
(function (g) {
  'use strict';
  const K = g.__KVTB = g.__KVTB || {};

  // ---------- کدهای خطا (برای گروه‌بندی و تحلیل خودکار) ----------
  const FAIL = {
    ADD_NO_ELEMENT: 'ADD_NO_ELEMENT',
    ADD_UNAVAILABLE: 'ADD_UNAVAILABLE',
    ADD_NO_METHOD: 'ADD_NO_METHOD',
    ADD_NO_RESPONSE: 'ADD_NO_RESPONSE',
    ADD_NOT_SELECTED: 'ADD_NOT_SELECTED',
    ADD_SERVER_429: 'ADD_SERVER_429',
    ADD_SERVER_5XX: 'ADD_SERVER_5XX',
    ADD_SERVER_419: 'ADD_SERVER_419',
    ADD_NET_ERROR: 'ADD_NET_ERROR',
    ADD_MODAL_BLOCK: 'ADD_MODAL_BLOCK',
    ADD_TIMEOUT: 'ADD_TIMEOUT',
    ADD_LEGACY: 'ADD_LEGACY',
    PAY_NO_CART: 'PAY_NO_CART',
    PAY_NO_GWBTN: 'PAY_NO_GWBTN',
    PAY_GW_UNSET: 'PAY_GW_UNSET',
    PAY_QTY: 'PAY_QTY_FAILED',
    PAY_NO_PAYBTN: 'PAY_NO_PAYBTN',
    PAY_BTN_DISABLED: 'PAY_BTN_DISABLED',
    PAY_NO_NAV: 'PAY_NO_NAV',
    PAY_TIMEOUT: 'PAY_TIMEOUT',
    PAY_NO_WIRE: 'PAY_NO_WIRE',
    NAV_FAILED: 'NAV_FAILED',
    DET_NO_BASELINE: 'DET_NO_BASELINE',
    WATCH_429: 'WATCH_429',
    WATCH_419: 'WATCH_419',
    WATCH_NET: 'WATCH_NET',
    CFG_INVALID: 'CFG_INVALID',
    UNKNOWN: 'UNKNOWN'
  };
  K.FAIL = FAIL;
  K.STAGES = ['BOOT', 'WATCH', 'DETECT', 'ADD', 'NAV', 'PAY', 'NET', 'CFG'];

  const MAX_MEM = 1200;          // نگه‌داری در حافظه (حلقه)
  const FLUSH_EVERY = 1500;      // ارسال دسته‌ای به پس‌زمینه (ms)
  const FLUSH_COUNT = 40;        // یا هر ۴۰ رکورد

  const mem = [];
  let seq = 0;
  let pending = [];
  let flushTimer = null;
  let session = null;
  let spans = new Map();         // spanId → span
  let current = null;            // span جاری (برای diag)
  let enabled = true;
  let listeners = new Set();

  function newSessionId() {
    const k = 'kvt:traceSession';
    let id = sessionStorage.getItem(k);
    if (!id) {
      id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      sessionStorage.setItem(k, id);
    }
    return id;
  }

  function safeJson(v, limit = 1200) {
    try {
      let s;
      if (typeof v === 'string') s = v;
      else s = JSON.stringify(v);
      if (s == null) return null;
      return s.length > limit ? s.slice(0, limit) + '…' : s;
    } catch (e) { return String(v).slice(0, limit); }
  }

  // ---------- ثبت رکورد ----------
  function push(rec) {
    if (!enabled) return;
    rec.i = ++seq;
    rec.t = Date.now();
    rec.sid = session;
    mem.push(rec);
    if (mem.length > MAX_MEM) mem.shift();
    pending.push(rec);
    if (pending.length >= FLUSH_COUNT) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_EVERY);
    for (const fn of listeners) { try { fn(rec); } catch (e) { /* noop */ } }
  }

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!pending.length) return;
    const batch = pending.splice(0, pending.length);
    try {
      K.bridge?.fire('trace:append', { session, entries: batch });
    } catch (e) { /* noop */ }
  }
  K.flushTrace = flush;

  // ---------- API ----------
  const T = {
    session: () => session,
    FAIL,

    setEnabled(v) { enabled = !!v; },

    onRecord(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** رکورد ساده */
    log(stage, level, msg, data, code) {
      push({ st: stage, lv: level || 'info', m: String(msg), d: safeJson(data), c: code || null });
    },

    debug: (st, m, d) => T.log(st, 'debug', m, d),
    info: (st, m, d) => T.log(st, 'info', m, d),
    warn: (st, m, d, c) => T.log(st, 'warn', m, d, c),
    error: (st, m, d, c) => T.log(st, 'error', m, d, c),

    /** شروع یک بازه (span) — برای اندازه‌گیری مدت‌زمان مراحل */
    start(stage, msg, data) {
      const id = 'sp' + (++seq);
      const span = {
        id, stage, msg,
        t0: performance.now(),
        wall0: Date.now(),
        steps: [],
        diags: {},
        closed: false,
        _lastMark: performance.now(),

        /** یک گام درون بازه */
        step(m, d) {
          if (span.closed) return span;
          const now = performance.now();
          const ms = Math.round(now - span._lastMark);
          span._lastMark = now;
          span.steps.push({ m: String(m), ms, d: safeJson(d) });
          push({ st: stage, lv: 'debug', m: String(m), d: safeJson(d), sp: id, ms });
          return span;
        },

        /** افزودن داده‌ی تشخیصی (مثلاً snapshot محصول) */
        diag(key, val) {
          span.diags[key] = safeJson(val, 2500);
          return span;
        },

        /** پایان موفق */
        ok(m, d) {
          if (span.closed) return span;
          span.closed = true;
          const ms = Math.round(performance.now() - span.t0);
          push({
            st: stage, lv: 'info', m: String(m || span.msg), d: safeJson(d),
            sp: id, ms, ok: 1, diag: Object.keys(span.diags).length ? span.diags : null
          });
          spans.delete(id);
          if (current === span) current = null;
          return span;
        },

        /** پایان با خطا */
        fail(code, m, d) {
          if (span.closed) return span;
          span.closed = true;
          const ms = Math.round(performance.now() - span.t0);
          push({
            st: stage, lv: 'error', m: String(m || span.msg), d: safeJson(d),
            sp: id, ms, ok: 0, c: code || FAIL.UNKNOWN,
            diag: Object.keys(span.diags).length ? span.diags : null,
            steps: span.steps.length ? span.steps : null
          });
          spans.delete(id);
          if (current === span) current = null;
          return span;
        },

        elapsed: () => Math.round(performance.now() - span.t0)
      };
      spans.set(id, span);
      current = span;
      push({ st: stage, lv: 'info', m: String(msg), d: safeJson(data), sp: id, begin: 1 });
      return span;
    },

    /** span جاری برای diag از راه دور */
    current: () => current,

    diag(key, val) { if (current) current.diag(key, val); },

    /** لیست رکوردهای حافظه (برای پنل) */
    dump() { return mem.slice(); },
    clear() { mem.length = 0; seq = 0; listeners.clear(); },

    /** خلاصه‌ی آماری برای نمایش در پنل */
    stats() {
      const byStage = {};
      const byLevel = { debug: 0, info: 0, warn: 0, error: 0 };
      const fails = {};
      for (const r of mem) {
        byStage[r.st] = (byStage[r.st] || 0) + 1;
        byLevel[r.lv] = (byLevel[r.lv] || 0) + 1;
        if (r.c) fails[r.c] = (fails[r.c] || 0) + 1;
      }
      return { total: mem.length, byStage, byLevel, fails, session };
    },

    /** خلاصه‌ی یک خرید (همه‌ی مراحل یک شناسه‌ی خرید) */
    purchase(tid) { return mem.filter((r) => r.tid === tid); }
  };

  // ---------- مقدارگذاری اولیه ----------
  session = newSessionId();

  // ---------- همگام‌سازی با تنظیمات ----------
  K.ready = K.ready || Promise.resolve(null);
  K.ready.then((cfg) => {
    if (cfg && typeof cfg.traceEnabled === 'boolean') enabled = cfg.traceEnabled;
    T.info('BOOT', 'موتور لاگ حرفه‌ای آماده شد', {
      session, url: location.href, v: K.version,
      ua: navigator.userAgent.slice(0, 180)
    });
  }).catch(() => {});

  K.on?.('config', (cfg) => {
    if (typeof cfg.traceEnabled === 'boolean') enabled = cfg.traceEnabled;
  });

  // فلاش نهایی هنگام ترک صفحه
  const bye = () => { try { flush(); } catch (e) { /* noop */ } };
  window.addEventListener('pagehide', bye);
  window.addEventListener('beforeunload', bye);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  K.trace = T;
  K.safeJson = safeJson;
})(globalThis);
