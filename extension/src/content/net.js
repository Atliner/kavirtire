/*
 * Kavirtire FastBuy — Net observer (MAIN world, document_start)
 *
 * قبل از لود شدن Livewire، fetch و XHR را «تماشا» می‌کند (بدون تغییر رفتار)
 * تا معلوم شود:
 *   • درخواست add واقعاً ارسال شد؟
 *   • سرور چه کدی داد؟ (200 / 419 / 429 / 500)
 *   • پاسخ چه افکتی داشت؟ (redirect به درگاه؟)
 *   • چقدر طول کشید؟
 *
 * این داده‌ها بدون آن‌که به کاربر نشان داده شود، در صف مخصوص می‌نشینند و
 * trace.js بعداً آن‌ها را با کد حرفه‌ای ثبت می‌کند. هیچ درخواستی تغییر نمی‌کند.
 */
(function (g) {
  'use strict';
  if (g.__KVT_NET__) return; // یک‌ بار

  const MAX = 60;
  const queue = [];
  let seq = 0;
  const listeners = new Set();

  function classify(url) {
    const u = String(url || '');
    if (/livewire/i.test(u)) return 'livewire';
    if (/availability|stock|inventory/i.test(u)) return 'availability';
    if (/setGateway|gateway|pay/i.test(u)) return 'payment';
    return 'other';
  }

  function push(rec) {
    rec.i = ++seq;
    rec.t = Date.now();
    rec.kind = classify(rec.url);
    queue.push(rec);
    if (queue.length > MAX) queue.shift();
    for (const fn of listeners) { try { fn(rec); } catch (e) { /* noop */ } }
  }

  // ---------- fetch ----------
  const origFetch = g.fetch;
  if (typeof origFetch === 'function') {
    g.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = (init && init.method) || (input && input.method) || 'GET';
      const body = init && typeof init.body === 'string' ? init.body : null;
      const t0 = performance.now();
      let p;
      try { p = origFetch.apply(this, arguments); }
      catch (e) {
        push({ url, method, err: String(e && e.message || e), ms: Math.round(performance.now() - t0), phase: 'fetch-throw' });
        throw e;
      }
      return p.then((res) => {
        let clone = null;
        try { clone = res.clone(); } catch (e) { clone = null; }
        const base = {
          url, method,
          status: res.status,
          ms: Math.round(performance.now() - t0),
          body: body ? body.slice(0, 3000) : null,
          phase: 'fetch'
        };
        push(base);
        // فقط پاسخ‌های Livewire را می‌خوانیم (کوچک‌اند) تا افکت ریدایرکت را ببینیم
        if (clone && /livewire/i.test(url)) {
          clone.text().then((txt) => {
            let json = null;
            try { json = JSON.parse(txt); } catch (e) { json = null; }
            if (json) {
              const effects = json.effects || {};
              const redirect = effects.redirect || effects.redirectTo || effects.url || null;
              push({
                url, method, status: res.status, phase: 'livewire-body',
                redirect,
                effects: Object.keys(effects),
                calls: (json.components || []).map((c) => (c.calls || []).map((x) => x.method)).flat().slice(0, 12),
                json: JSON.stringify(json).slice(0, 4000)
              });
            }
          }).catch(() => {});
        }
        return res;
      }, (err) => {
        push({ url, method, err: String(err && err.message || err), ms: Math.round(performance.now() - t0), phase: 'fetch-reject' });
        throw err;
      });
    };
  }

  // ---------- XMLHttpRequest ----------
  const X = g.XMLHttpRequest;
  if (X && X.prototype) {
    const open = X.prototype.open;
    const send = X.prototype.send;
    X.prototype.open = function (method, url) {
      try { this.__kvt = { method, url: String(url), t0: 0 }; } catch (e) { /* noop */ }
      return open.apply(this, arguments);
    };
    X.prototype.send = function (body) {
      const meta = this.__kvt;
      if (meta) {
        meta.t0 = performance.now();
        meta.body = typeof body === 'string' ? body.slice(0, 3000) : null;
        this.addEventListener('loadend', () => {
          let json = null;
          let redirect = null;
          try {
            if (/livewire/i.test(meta.url) && typeof this.responseText === 'string') {
              json = JSON.parse(this.responseText);
              const ef = json.effects || {};
              redirect = ef.redirect || ef.redirectTo || ef.url || null;
            }
          } catch (e) { /* noop */ }
          push({
            url: meta.url, method: meta.method, status: this.status,
            ms: Math.round(performance.now() - meta.t0), phase: 'xhr',
            body: meta.body, redirect,
            calls: json ? (json.components || []).map((c) => (c.calls || []).map((x) => x.method)).flat().slice(0, 12) : null
          });
        });
      }
      return send.apply(this, arguments);
    };
  }

  g.__KVT_NET__ = {
    version: 1,
    queue,
    /** آخرین رکوردهای شبکه */
    recent: (n = 20) => queue.slice(-n),
    /** آخرین رکورد Livewire که ریدایرکت داشت */
    lastRedirect: () => {
      for (let i = queue.length - 1; i >= 0; i--) {
        const r = queue[i];
        if (r.redirect) return { redirect: r.redirect, t: r.t, url: r.url };
      }
      return null;
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** پاک کردن صف (بعد از مصرف) */
    drain() { const q = queue.slice(); queue.length = 0; return q; }
  };
})(globalThis);
