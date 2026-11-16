/*
 * Kavirtire FastBuy — Core (MAIN world)
 * باس رویداد، ذخیره‌ی تنظیمات، ارتباط با bridge، ابزارهای عمومی.
 */
(function (g) {
  'use strict';

  const K = g.__KVTB = g.__KVTB || {};
  const TAG = '__kvt_fastbuy__';
  const cfgDefaults = g.KVT_DEFAULTS;
  const mergeConfig = g.KVT_mergeConfig;

  K.version = g.KVT_VERSION || '1.0.0';
  K.isTop = window.top === window;

  // ---------- باس رویداد ----------
  const handlers = new Map();
  K.on = (type, fn) => {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type)?.delete(fn);
  };
  K.emit = (type, data) => {
    const set = handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) { try { fn(data); } catch (e) { console.warn('[KVT] handler', type, e); } }
  };

  // ---------- ابزار ----------
  K.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  K.now = () => Date.now();
  K.clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  K.fa = (n) => {
    try { return Number(n).toLocaleString('fa-IR'); } catch (e) { return String(n); }
  };
  K.faTime = (d = new Date()) => {
    try { return d.toLocaleTimeString('fa-IR', { hour12: false }); } catch (e) { return d.toTimeString().slice(0, 8); }
  };
  K.uid = () => Math.random().toString(36).slice(2, 10);

  K.waitFor = (fn, timeout = 8000, step = 60) => new Promise((resolve) => {
    const t0 = Date.now();
    (function loop() {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return resolve(v);
      if (Date.now() - t0 > timeout) return resolve(null);
      setTimeout(loop, step);
    })();
  });

  // ---------- وضعیت ماندگار سریع (localStorage، همگام) ----------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('kvt:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('kvt:' + k, JSON.stringify(v)); } catch (e) { /* noop */ } },
    del(k) { try { localStorage.removeItem('kvt:' + k); } catch (e) { /* noop */ } }
  };
  K.store = LS;

  // ---------- پل ارتباطی با پس‌زمینه ----------
  let seq = 0;
  const pending = new Map();

  window.addEventListener('message', (ev) => {
    if (ev.source && ev.source !== window) return; // در برخی محیط‌ها source تهی است
    const d = ev.data;
    if (!d || d[TAG] !== 1) return;

    if (d.kind === 'res' && pending.has(d.id)) {
      const { resolve, reject, timer } = pending.get(d.id);
      clearTimeout(timer);
      pending.delete(d.id);
      d.ok ? resolve(d.data) : reject(new Error(d.error || 'bridge error'));
      return;
    }
    if (d.kind === 'evt' && d.type) {
      if (d.type === 'config' && d.payload) {
        const incoming = mergeConfig(K.config, d.payload);
        if (JSON.stringify(incoming) === JSON.stringify(K.config)) return;
        K.config = incoming;
        K.emit('config', incoming);
        return;
      }
      K.emit(d.type, d.payload);
    }
  });

  K.bridge = {
    call(method, payload, timeout = 4000) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('bridge timeout: ' + method));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        try {
          window.postMessage({ [TAG]: 1, kind: 'req', id, method, payload }, location.origin);
        } catch (e) {
          clearTimeout(timer); pending.delete(id); reject(e);
        }
      });
    },
    fire(method, payload) {
      return this.call(method, payload).catch(() => null);
    }
  };

  // ---------- تنظیمات ----------
  K.config = Object.assign({}, cfgDefaults);
  let saveTimer = null;

  K.applyConfig = (next, { persist = true } = {}) => {
    K.config = mergeConfig(K.config, next);
    K.emit('config', K.config);
    if (persist) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        K.bridge.fire('config:set', K.config);
        K.store.set('cfgSnap', K.config);   // شروع سریع دفعه‌ی بعد
      }, 120);
    }
    return K.config;
  };

  // ---------- راه‌اندازی سریع (بدون بلاک) ----------
  // ⚠️ درس سرعت: انتظار برای پیام پس‌زمینه، شروع پایش را چند صد میلی‌ثانیه
  // عقب می‌انداخت. Snapshot همگام localStorage بلافاصله در دسترس است و
  // تنظیمات معتبر پس‌زمینه بعداً اعمال می‌شود (hot-reload).
  try {
    const snap = K.store.get('cfgSnap', null);
    if (snap && typeof snap === 'object') K.config = mergeConfig(K.config, snap);
  } catch (e) { /* noop */ }

  K.configReady = false;
  K.ready = (async () => {
    for (let i = 0; i < 3; i++) {
      try {
        const stored = await K.bridge.call('config:get', null, 1500);
        if (stored && typeof stored === 'object') {
          K.config = mergeConfig(K.config, stored);
          K.configReady = true;
          K.store.set('cfgSnap', K.config);   // برای شروع سریع بار بعد
          break;
        }
      } catch (e) {
        if (i === 2) console.warn('[KVT] تنظیمات از پس‌زمینه خوانده نشد؛ پیش‌فرض‌ها استفاده می‌شوند.', e.message);
        await new Promise((r) => setTimeout(r, 120));
      }
    }
    K.emit('ready', K.config);
    return K.config;
  })();

  // اگر پل دیرتر آماده شد، یک‌بار دیگر تنظیمات را تازه کن
  K.on('bridge-ready', async () => {
    try {
      const stored = await K.bridge.call('config:get', null, 4000);
      if (stored) {
        const next = mergeConfig(K.config, stored);
        if (JSON.stringify(next) !== JSON.stringify(K.config)) { K.config = next; K.emit('config', next); }
      }
    } catch (e) { /* noop */ }
  });

  // ---------- لاگ ----------
  const logs = [];
  K.logs = logs;
  K.log = (msg, kind = 'info') => {
    const item = { t: Date.now(), msg: String(msg), kind };
    logs.push(item);
    if (logs.length > 200) logs.shift();
    K.emit('log', item);
  };

  // ---------- صدا و اعلان ----------
  let audioCtx = null;
  K.beep = (pattern = 'hit') => {
    if (!K.config.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const seqs = {
        hit: [[880, 0], [1180, 0.18], [1480, 0.36]],
        warn: [[520, 0], [380, 0.22]],
        tick: [[720, 0]]
      };
      const seq = seqs[pattern] || seqs.tick;
      for (const [freq, at] of seq) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + at);
        gain.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + at + 0.22);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + at);
        osc.stop(audioCtx.currentTime + at + 0.25);
      }
    } catch (e) { /* noop */ }
  };

  K.notify = (title, body) => {
    K.beep('hit');
    if (!K.config.notify) return;
    K.bridge.fire('notify', { title, body });
    // چشمک در عنوان تب
    try {
      const orig = document.title;
      let on = false, n = 0;
      const timer = setInterval(() => {
        document.title = on ? '🟢 ' + title : orig;
        on = !on;
        if (++n > 20) { clearInterval(timer); document.title = orig; }
      }, 700);
      window.addEventListener('focus', () => { clearInterval(timer); document.title = orig; }, { once: true });
    } catch (e) { /* noop */ }
  };

  K.focusTab = (kind = 'self') => {
    if (!K.config.focusOnHit) return;
    K.bridge.fire(kind === 'gateway' ? 'tab:gateway' : 'tab:focus', null);
  };
})(globalThis);
