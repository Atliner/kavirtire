/*
 * Kavirtire FastBuy — Guard (MAIN world)
 *
 * وظیفه‌ی این ماژول «بن نشدن» است. سه لایه دارد:
 *  ۱) بودجه‌ی سراسری درخواست (در همه‌ی تب‌ها/فریم‌ها؛ چون هر تب سهم دارد)
 *  ۲) احترام کامل به 429/403/503 و Retry-After، با Backoff نمایی و آستانه‌ی توقف
 *  ۳) مانیتور خطای Livewire 419/429 و شکست شبکه
 *
 * همه‌ی قوانین «محافظه‌کارانه» هستند: در تردید، صبر می‌کنیم.
 */
(function (g) {
  'use strict';
  const K = g.__KVTB = g.__KVTB || {};

  const TREMO = 3;                 // تعداد لرزش مجاز برای شناسه‌ی تب
  const BUDGET_WINDOW = 60000;

  function tabId() {
    const k = 'kvt:tabid';
    let v = Number(sessionStorage.getItem(k) || 0);
    if (!v) { v = Math.floor(Math.random() * 1e9); sessionStorage.setItem(k, String(v)); }
    return v;
  }

  function createGuard() {
    const self = tabId();
    const st = K.store.get('guard', null) || {
      windowStart: Date.now(), used: 0, q: [], cool: 0, fails: 0, blocked: 0, lastAt: 0
    };
    st.q = Array.isArray(st.q) ? st.q : [];

    const persist = () => {
      const now = Date.now();
      st.q = st.q.filter((t) => now - t < BUDGET_WINDOW);
      const merged = ([...(st.q)]).sort((a, b) => a - b);
      K.store.set('guard', { ...st, q: merged });
    };

    const readShared = () => K.store.get('guard', st) || st;
    const writeShared = (next) => { Object.assign(st, next); persist(); };

    const api = {
      tabId: self,
      state: st,

      /** پنجره‌ی فعلی بودجه را بررسی و اگر مجاز است یک درخواست ثبت می‌کند. */
      take() {
        const shared = readShared();
        const now = Date.now();
        shared.q = (shared.q || []).filter((t) => now - t < BUDGET_WINDOW);
        const cap = K.clamp(Number(K.config.maxPerMinute) || 45, 3, 240);
        if (shared.q.length >= cap) {
          const wait = shared.q[0] + BUDGET_WINDOW - now + 150;
          return { ok: false, wait };
        }
        const gap = K.clamp(Number(K.config.minGap) || 600, 150, 60000);
        const last = shared.q[shared.q.length - 1] || 0;
        if (last && now - last < gap) return { ok: false, wait: gap - (now - last) };
        shared.q.push(now);
        writeShared({ q: shared.q });
        return { ok: true };
      },

      /** اگر در کول‌داون هستیم، میلی‌ثانیه‌های باقی‌مانده را برمی‌گرداند. */
      cooldownLeft() {
        const left = (Number(readShared().cool) || 0) - Date.now();
        return left > 0 ? left : 0;
      },

      /** ثبت پاسخ موفق: آستانه و کول‌داون سبک را صفر می‌کند. */
      success() {
        const shared = readShared();
        // کول‌داون تب‌های دیگر را پاک نکن؛ فقط شمارنده‌ی خطای خودمان را صفر کن
        if (shared.fails) writeShared({ fails: 0 });
      },

      /** ثبت 429/403/503 و برگرداندن مقدار انتظار. */
      limited(retryAfterSec = 0, status = 429, scope = 'api') {
        const shared = readShared();
        const base = scope === 'page' ? Math.max(K.config.pageInterval || 6000, 2500) : Math.max(K.config.interval || 1200, 800);
        let wait;
        if (retryAfterSec > 0) {
          // Retry-After را جدي بگیر؛ کمی هم رویش سوار کن
          wait = retryAfterSec * 1000 + 500 + Math.random() * 1500;
        } else {
          const k = Math.min(shared.fails || 0, 6);
          wait = Math.min(base * Math.pow(2, k + 1), Math.max(K.config.maxCooldown || 120000, 15000));
          wait += Math.random() * 1000;
        }
        const fails = (shared.fails || 0) + 1;
        const breaker = Math.max(Number(K.config.breaker) || 5, 2);
        let next = wait;
        let tripped = false;
        if (fails >= breaker) {
          tripped = true;
          next = Math.max(Number(K.config.longCooldown) || 600000, wait);
        }
        writeShared({
          fails,
          cool: Date.now() + next,
          blocked: (shared.blocked || 0) + (tripped ? 1 : 0)
        });
        return { wait: next, tripped, fails, status, retryAfterSec };
      },

      /** ثبت خطای غیرمحدودیت (شبکه/5xx): انتظار کوتاه/متوسط */
      error(status) {
        const shared = readShared();
        const k = Math.min((shared.fails || 0) + 1, 5);
        const wait = Math.min(Math.max(K.config.interval || 1200, 800) * Math.pow(1.6, k), 20000);
        writeShared({ fails: k, cool: Date.now() + wait });
        return { wait, status };
      },

      /**
       * چک API واقعی برای موجودی + یک درخواست fetch با تایم‌اوت.
       * خروجی: { ok, status, data, limited, wait, error }
       */
      async fetchJson(url, { timeout = K.config.timeout || 8000 } = {}) {
        const w = this.cooldownLeft();
        if (w) return { ok: false, limited: true, wait: w, status: 429, reason: 'cooldown' };
        const t = this.take();
        if (!t.ok) return { ok: false, limited: true, wait: t.wait, status: 429, reason: 'budget' };

        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), Math.max(2000, timeout));
        let res;
        try {
          res = await fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: ctrl.signal,
            headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
          });
        } catch (e) {
          this.error(0);
          return { ok: false, error: /abort/i.test(e.name) ? 'تایم‌اوت' : 'شبکه', wait: K.config.interval, status: 0 };
        } finally { clearTimeout(to); }

        if (res.status === 429 || res.status === 503 || res.status === 403) {
          let ra = 0;
          try {
            const h = res.headers.get('Retry-After');
            if (h) ra = /^\d+$/.test(h.trim()) ? Number(h) : Math.max(0, Math.round((new Date(h) - Date.now()) / 1000));
          } catch (e) { ra = 0; }
          const lim = this.limited(ra, res.status, 'api');
          return { ok: false, limited: true, status: res.status, ...lim };
        }
        if (res.status === 401 || res.status === 419) {
          return { ok: false, status: res.status, auth: true, error: 'نشست منقضی شده' };
        }
        if (!res.ok) {
          this.error(res.status);
          return { ok: false, status: res.status, error: 'سرور ' + res.status };
        }
        let body;
        try { body = await res.json(); } catch (e) {
          this.error(0);
          return { ok: false, status: res.status, error: 'پاسخ نامعتبر' };
        }
        this.success();
        return { ok: true, status: res.status, data: body };
      },

      /** سلامت کلی برای نمایش در UI */
      snapshot() {
        const shared = readShared();
        const now = Date.now();
        const q = (shared.q || []).filter((t) => now - t < BUDGET_WINDOW);
        return {
          used: q.length,
          cap: K.clamp(Number(K.config.maxPerMinute) || 45, 3, 240),
          cool: Math.max(0, (shared.cool || 0) - now),
          fails: shared.fails || 0,
          blocked: shared.blocked || 0
        };
      }
    };

    // پاک‌سازی نبض‌های قدیمی وقتی تب باز می‌شود
    persist();
    return api;
  }

  K.createGuard = createGuard;

  /** مانیتور خطای Livewire/شبکه برای اصلاح سریع وضعیت */
  K.watchLivewireErrors = (onEvent) => {
    try {
      document.addEventListener('livewire:init', () => {
        try {
          const L = window.Livewire;
          if (L && L.hook) {
            L.hook('request', ({ fail }) => {
              if (!fail) return;
              const s = Number(fail.status) || 0;
              if (onEvent) onEvent({ type: 'lw-fail', status: s, detail: fail });
            });
            L.hook('morph.updated', () => { if (onEvent) onEvent({ type: 'lw-updated' }); });
          }
        } catch (e) { /* noop */ }
      });
      // تور آخر: هر fetch خطادار را خود اسکریپت هم می‌بیند، ولی خطای مودال را هم ببندیم
      const obs = new MutationObserver(() => {
        const dlg = document.querySelector('dialog#livewire-error');
        if (dlg) { try { dlg.close(); } catch (e) { /* noop */ } }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* noop */ }
  };
})(globalThis);
