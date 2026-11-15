/*
 * Kavirtire FastBuy — Main (MAIN world)
 * مسیریابی بر اساس مسیر صفحه، هماهنگ‌سازی با SPA/Livewire، میان‌بر صفحه‌کلید،
 * نگه‌داشتن تایمر در تب پنهان و «دکمه‌ی شناور خرید فوری» روی کارت‌ها.
 */
(function (g) {
  'use strict';
  const K = g.__KVTB = g.__KVTB || {};
  if (!K.isTop) return; // فقط در فریم اصلی

  const S = K.site;
  let panel = null;
  let engine = null;
  let payment = null;
  let currentPath = null;
  let wakeLock = null;
  let silentAudio = null;

  // ---------- نگه‌داشتن تایمر در تب پنهان ----------
  // کروم تایمرهای تب پنهان را throttle می‌کند؛ یک AudioContext صامت فعال
  // تایمر را دقیق نگه می‌دارد. (در صورت پشتیبانی WebLock هم تلاش می‌شود.)
  async function keepAwake(on) {
    try {
      if (on) {
        if (K.config.keepAwake && !silentAudio) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (Ctx) {
            silentAudio = new Ctx();
            const osc = silentAudio.createOscillator();
            const gain = silentAudio.createGain();
            gain.gain.value = 0.0001;
            osc.frequency.value = 30;
            osc.connect(gain).connect(silentAudio.destination);
            osc.start();
            silentAudio._osc = osc;
          }
        }
        if (navigator.wakeLock && !wakeLock) {
          try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { wakeLock = null; }
        }
      } else {
        try { silentAudio?._osc?.stop(); silentAudio?.close(); } catch (e) { /* noop */ }
        silentAudio = null;
        try { await wakeLock?.release(); } catch (e) { /* noop */ }
        wakeLock = null;
      }
    } catch (e) { /* noop */ }
  }

  // ---------- دکمه‌های شناور «خرید فوری» ----------
  const overlay = {
    els: new Map(),
    sync() {
      if (!K.config.overlays || !S.productsPage()) { this.clear(); return; }
      const cards = S.cards();
      const seen = new Set();
      cards.forEach((card) => {
        const id = S.idOf(card);
        if (!id) return;
        seen.add(id);
        let el = this.els.get(id);
        if (!el || !el.isConnected || el.parentElement !== card) {
          el = this.make(card, id);
          this.els.set(id, el);
        }
        const st = S.status(card);
        el.dataset.avail = st.available ? '1' : '0';
        el.textContent = st.available ? '⚡ خرید فوری' : '⏱ پایش';
        el.title = st.available
          ? 'همین حالا به سبد اضافه کن و به درگاه برو'
          : 'این محصول ناموجود است؛ با کلیک، به لیست پایش اضافه می‌شود';
      });
      [...this.els.keys()].forEach((id) => { if (!seen.has(id)) { this.els.get(id)?.remove(); this.els.delete(id); } });
    },
    make(card, id) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'kvt-quick';
      el.dataset.id = id;
      el.style.cssText = 'position:absolute;top:6px;left:6px;z-index:20;border:0;border-radius:8px;padding:4px 8px;' +
        'font:700 11px Vazirmatn,Tahoma,sans-serif;color:#fff;background:#4f46e5;cursor:pointer;box-shadow:0 2px 8px rgba(79,70,229,.4);' +
        'direction:rtl;line-height:1.5';
      el.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const avail = el.dataset.avail === '1';
        if (avail) K.emit('quick-buy', { id });
        else {
          const set = new Set((K.config.selected || []).map(String));
          set.add(id);
          K.applyConfig({ selected: [...set] });
          K.log('به لیست پایش اضافه شد: ' + id, 'ok');
          showPanel('products');
        }
      });
      try { if (getComputedStyle(card).position === 'static') card.style.position = 'relative'; } catch (e) { /* noop */ }
      card.appendChild(el);
      return el;
    },
    clear() { this.els.forEach((el) => el.remove()); this.els.clear(); }
  };

  // ---------- پنل ----------
  function ensurePanel() {
    if (panel?.alive()) return panel;
    panel = K.createPanel();
    panel.alive = panel.alive;
    return panel;
  }
  function showPanel(tab) {
    const p = ensurePanel();
    p.show?.();
    document.getElementById('kvt-restore')?.remove();
    if (K.config.panelHidden) K.applyConfig({ panelHidden: false });
    if (tab) p.openTab?.(tab);
  }

  function hidePanel() {
    K.applyConfig({ panelHidden: true });
    K.emit('panel-hidden');
  }

  // ---------- خطاهای شبکه در سطح ریسک ----------
  function watchPageRisks() {
    // 429/403/503 را از طریق PerformanceObserver نمی‌بینیم؛ ولی Livewire hook کافی است.
    window.addEventListener('offline', () => K.log('اتصال اینترنت قطع شد.', 'warn'));
    window.addEventListener('online', () => K.log('اتصال برگشت.', 'ok'));
  }

  // ---------- مسیریابی ----------
  function mount() {
    const path = location.pathname;

    // هر صفحه: پنل فقط در صفحه‌ی محصولات
    if (S.productsPage()) {
      if (!engine) engine = K.createEngine();
      K.engine = engine;
      // اگر قبل از ناوبریِ داخل سایت در حال پایش بودیم، خودکار ادامه بده
      if (K.store.get('resume', false) && !engine.state.running && (K.config.selected || []).length) {
        K.store.del('resume');
        setTimeout(() => engine.start(), 900);
        K.log('ادامه‌ی پایش پس از بازگشت به صفحه‌ی محصولات…', 'ok');
      }
      ensurePanel();
      overlay.sync();
    } else {
      overlay.clear();
      panel?.destroy?.();
      panel = null;
      engine?.destroy?.();
      engine = null;
      K.engine = null;
    }

    if (S.paymentPage()) {
      payment?.destroy?.();
      payment = K.paymentPage();
      // دیگر پایشی لازم نیست؛ خرید در جریان است
      engine?.destroy?.();
      engine = null;
      K.engine = null;
      K.store.del('resume');
    }

    currentPath = path;

    // پس از ورود به صفحه‌ی محصولات، بعد از رندر کامل لیست را تازه کن
    if (S.productsPage()) {
      K.waitFor(() => S.cards().length > 0, 8000, 150).then((ok) => {
        if (!ok) return;
        if (K.engine?.state?.running) K.engine.products();
        overlay.sync();
        K.emit('products-changed');
      });
    }
  }

  function route() {
    const path = location.pathname;
    if (path === currentPath) return;
    // صفحه‌ی پرداخت را ترک کردیم
    if (payment && !S.paymentPage()) { payment.destroy?.(); payment = null; }
    mount();
  }

  // ---------- رویدادها ----------
  K.on('arm', ({ id }) => { K.store.set('cartIds', id ? [String(id)] : []); });

  K.on('run', ({ running }) => {
    keepAwake(running);
    if (running) K.log('پایش روشن شد؛ درخواست‌ها با بودجه‌ی ایمن ارسال می‌شوند.', 'ok');
  });

  K.on('hit', () => {
    if (K.config.autoAdd) K.focusTab('self');
  });

  K.on('quick-buy', async ({ id }) => {
    const products = S.products();
    const p = products.find((x) => String(x.id) === String(id));
    if (!p) return;
    const eng = K.engine;
    if (!eng) return;
    if (!(K.config.selected || []).map(String).includes(String(id))) {
      K.applyConfig({ selected: [...new Set([...((K.config.selected || []).map(String)), String(id)])] });
    }
    eng.buyNow([String(id)]);
  });

  K.on('panel-hidden', () => {
    document.getElementById('kvt-panel-host')?.classList.add('hidden');
    // دکمه‌ی کوچک برای بازگرداندن پنل
    if (document.getElementById('kvt-restore')) return;
    const b = document.createElement('button');
    b.id = 'kvt-restore';
    b.textContent = '⚡';
    b.title = 'نمایش پنل خرید سریع (Alt+Shift+P)';
    b.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:2147483645;width:44px;height:44px;border:0;border-radius:50%;' +
      'font-size:20px;color:#fff;background:linear-gradient(135deg,#2563eb,#4f46e5);cursor:pointer;box-shadow:0 8px 22px rgba(37,99,235,.45)';
    b.onclick = () => { b.remove(); showPanel(); };
    document.documentElement.appendChild(b);
  });

  K.on('config', () => { overlay.sync(); });

  // Livewire navigation برای SPA
  document.addEventListener('livewire:navigated', () => {
    setTimeout(() => { route(); overlay.sync(); K.emit('products-changed'); }, 120);
  });
  window.addEventListener('popstate', () => setTimeout(route, 60));

  // تغییر DOM → همگام‌سازی overlay
  let moT = null;
  const mo = new MutationObserver(() => {
    clearTimeout(moT);
    moT = setTimeout(() => { if (S.productsPage()) overlay.sync(); }, 400);
  });

  // میان‌بر صفحه‌کلید
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || !e.shiftKey) return;
    if (e.code === 'KeyP') {
      e.preventDefault();
      const hostEl = document.getElementById('kvt-panel-host');
      if (!panel?.alive() || !hostEl) return showPanel();
      if (hostEl.classList.contains('hidden') || K.config.panelHidden) return showPanel();
      hidePanel();
    }
    if (e.code === 'KeyK') {
      e.preventDefault();
      if (K.engine) {
        if (K.engineState?.running) K.engine.stop('میان‌بر');
        else K.engine.start();
      }
    }
  });

  // دستورهای پس‌زمینه
  K.on('cmd', (payload) => {
    const cmd = payload?.cmd;
    if (cmd === 'toggle-monitor') {
      if (!K.engine) { K.log('پایش فقط در صفحه‌ی محصولات در دسترس است.', 'warn'); return; }
      if (K.engineState?.running) K.engine.stop('دستور پس‌زمینه');
      else K.engine.start();
    } else if (cmd === 'toggle-panel') {
      showPanel();
    }
  });

  // Wake Lock را بعد از بازگشت به تب دوباره بگیر
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && K.engineState?.running && K.config.keepAwake) {
      await keepAwake(false);
      await keepAwake(true);
    }
  });

  // ---------- شروع ----------
  K.ready.then(() => {
    K.log('افزونه‌ی خرید سریع کویرتایر فعال شد (v' + K.version + ')', 'ok');
    mount();
    watchPageRisks();
    try { mo.observe(document.body || document.documentElement, { childList: true, subtree: true }); } catch (e) { /* noop */ }
  });

  window.addEventListener('beforeunload', () => {
    K.store.set('navigating', true);
    K.store.set('resume', !!(K.engineState && K.engineState.running && !K.engineState.busy));
  });
  window.addEventListener('pagehide', () => {
    K.store.set('navigating', true);
    K.store.set('resume', !!(K.engineState && K.engineState.running && !K.engineState.busy));
  });
  window.addEventListener('pageshow', () => { setTimeout(() => K.store.del('navigating'), 300); });
})(globalThis);
