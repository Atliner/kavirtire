/*
 * Kavirtire FastBuy — Bridge (ISOLATED world)
 *
 * اسکریپت صفحه در دنیای MAIN اجرا می‌شود و به chrome.* دسترسی ندارد.
 * این پل، درخواست‌های صفحه را به service worker می‌رساند و رویدادهای
 * پس‌زمینه را به صفحه برمی‌گرداند. همچنین یک Port زنده نگه می‌دارد تا
 * وقتی پایش فعال است، service worker خواب نرود.
 */
(() => {
  'use strict';

  const TAG = '__kvt_fastbuy__';
  const VERSION = '1.0.0';
  let port = null;
  let heartbeat = null;

  function pageMsg(kind, data) {
    try { window.postMessage(Object.assign({ [TAG]: 1, kind }, data), location.origin); } catch (e) { /* noop */ }
  }

  // ---------- Port زنده (keep-alive) ----------
  function ensurePort() {
    if (disposed) return null;
    if (port) return port;
    try {
      port = chrome.runtime.connect({ name: 'kvt-page' });
      port.onMessage.addListener((m) => {
        if (m && m.type) pageMsg('evt', { type: m.type, payload: m.payload });
      });
      port.onDisconnect.addListener(() => {
        port = null;
        try { chrome.runtime.lastError; } catch (e) { /* noop */ }
      });
    } catch (e) { port = null; }
    return port;
  }

  let disposed = false;
  function startHeartbeat() {
    if (heartbeat) return;
    ensurePort();
    heartbeat = setInterval(() => {
      if (disposed) return;
      try { ensurePort()?.postMessage({ type: 'ping', t: Date.now() }); } catch (e) { /* noop */ }
    }, 20000);
    document.addEventListener('visibilitychange', () => { try { if (!disposed) ensurePort(); } catch (e) { /* noop */ } });
    const bye = () => {
      disposed = true;
      clearInterval(heartbeat); heartbeat = null;
      try { port?.disconnect(); } catch (e) { /* noop */ }
      port = null;
    };
    window.addEventListener('pagehide', bye, { once: true });
    window.addEventListener('beforeunload', bye, { once: true });
  }
  startHeartbeat();

  // ---------- درخواست‌های صفحه ----------
  const METHODS = new Set([
    'config:get', 'config:set', 'config:reset', 'config:open',
    'notify', 'log', 'tab:info', 'tab:focus', 'tab:gateway',
    'monitor:claim', 'monitor:release', 'monitor:state',
    'open:url', 'badge'
  ]);

  async function handle(method, payload) {
    if (!METHODS.has(method)) throw new Error('unknown method: ' + method);
    if (method === 'ping') return { ok: true, v: VERSION };
    return await chrome.runtime.sendMessage({ from: 'kvt-page', method, payload });
  }

  window.addEventListener('message', (ev) => {
    if (ev.source && ev.source !== window) return; // در برخی محیط‌ها source تهی است
    const d = ev.data;
    if (!d || d[TAG] !== 1 || d.kind !== 'req' || typeof d.id !== 'number') return;
    Promise.resolve()
      .then(() => handle(d.method, d.payload))
      .then((res) => pageMsg('res', { id: d.id, ok: true, data: res }))
      .catch((err) => pageMsg('res', { id: d.id, ok: false, error: String(err && err.message || err) }));
  });

  // ---------- دستورهای پس‌زمینه ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.from !== 'kvt-bg') return;
    pageMsg('evt', { type: msg.type, payload: msg.payload });
    sendResponse({ ok: true });
    return false;
  });

  // اعلام آمادگی
  pageMsg('evt', { type: 'bridge-ready', payload: { version: VERSION } });
})();
