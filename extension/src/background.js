/*
 * Kavirtire FastBuy — Service worker
 * ذخیره‌ی تنظیمات، اعلان‌ها، فوکوس تب، و نگه‌داشتن service worker زنده وقتی
 * صفحه‌ای در حال پایش است (Port).
 */
importScripts('shared/defaults.js');

const DEFAULTS = self.KVT_DEFAULTS;
const KEY = self.KVT_STORAGE_KEY || 'config';
const merge = self.KVT_mergeConfig;

async function getConfig() {
  const obj = await chrome.storage.local.get(KEY);
  return merge(DEFAULTS, obj[KEY] || {});
}

async function setConfig(patch) {
  const cur = await getConfig();
  const next = merge(cur, patch);
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

async function broadcast(type, payload) {
  const tabs = await chrome.tabs.query({ url: ['*://kavirtire.ir/*', '*://*.kavirtire.ir/*'] });
  await Promise.all(tabs.map((t) =>
    chrome.tabs.sendMessage(t.id, { from: 'kvt-bg', type, payload }).catch(() => {})
  ));
}

// ---------- منوی کلیک راست ----------
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'kvt-open-panel',
        title: 'نمایش پنل خرید سریع',
        contexts: ['page'],
        documentUrlPatterns: ['*://kavirtire.ir/*', '*://*.kavirtire.ir/*']
      });
    });
  } catch (e) { /* noop */ }

  if (details.reason === 'install') {
    // پیش‌فرض‌ها را بنویس
    const cur = await getConfig();
    await chrome.storage.local.set({ [KEY]: cur });
    try {
      await chrome.tabs.create({ url: 'https://kavirtire.ir/esale/products' });
    } catch (e) { /* noop */ }
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'kvt-open-panel' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { from: 'kvt-bg', type: 'cmd', payload: { cmd: 'toggle-panel' } }).catch(() => {
      chrome.action.openPopup?.().catch(() => {});
    });
  }
});

// ---------- آیکون ----------
chrome.action.onClicked.addListener(async (tab) => {
  // اگر روی کویرتایر بودیم: پنل
  try {
    if (tab?.id && /kavirtire\.ir/.test(tab.url || '')) {
      await chrome.tabs.sendMessage(tab.id, { from: 'kvt-bg', type: 'cmd', payload: { cmd: 'toggle-panel' } });
      return;
    }
  } catch (e) { /* noop */ }
  await chrome.runtime.openOptionsPage();
});

// ---------- دستورهای صفحه‌کلید ----------
chrome.commands.onCommand.addListener(async (cmd) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const map = { 'toggle-monitor': 'toggle-monitor', 'toggle-panel': 'toggle-panel' };
  if (map[cmd]) {
    chrome.tabs.sendMessage(tab.id, { from: 'kvt-bg', type: 'cmd', payload: { cmd: map[cmd] } }).catch(() => {});
  }
});

// ---------- پیام‌ها ----------
const monitorTabs = new Set();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  // از پل صفحه
  if (msg.from === 'kvt-page') {
    (async () => {
      try {
        switch (msg.method) {
          case 'config:get':
            return sendResponse(await getConfig());

          case 'config:set': {
            const next = await setConfig(msg.payload || {});
            sendResponse(next);
            broadcast('config', next);
            return;
          }

          case 'config:open':
            await chrome.runtime.openOptionsPage();
            return sendResponse({ ok: true });

          case 'config:reset':
            await chrome.storage.local.set({ [KEY]: DEFAULTS });
            sendResponse(DEFAULTS);
            broadcast('config', DEFAULTS);
            return;

          case 'notify': {
            const { title = 'کویرتایر', body = '' } = msg.payload || {};
            try {
              await chrome.notifications.create('kvt-share', {
                type: 'basic',
                iconUrl: chrome.runtime.getURL('icons/icon128.png'),
                title,
                message: body || 'محصول مورد نظر موجود شد!',
                priority: 2,
                requireInteraction: true,
                buttons: [{ title: 'باز کردن تب' }, { title: 'نمایش پنل' }]
              });
            } catch (e) { /* noop */ }
            return sendResponse({ ok: true });
          }

          case 'log':
            console.log('[kvt page]', msg.payload);
            return sendResponse({ ok: true });

          case 'tab:info':
            return sendResponse({ id: sender?.tab?.id ?? null, url: sender?.tab?.url ?? null });

          case 'tab:focus':
            try {
              if (sender?.tab?.id != null) {
                await chrome.tabs.update(sender.tab.id, { active: true });
                await chrome.windows.update(sender.tab.windowId, { focused: true });
              }
            } catch (e) { /* noop */ }
            return sendResponse({ ok: true });

          case 'tab:gateway': {
            const cfg = await getConfig();
            const needsPerm = !(await hasAllSites());
            // اگر درخواست دسترسی است، از همین کلیک کاربر استفاده کن
            if (msg.payload && msg.payload.request === true && needsPerm) {
              return sendResponse({ ok: false, granted: false, needsPermission: true });
            }
            if (needsPerm) return sendResponse({ ok: false, granted: true, needsPermission: true });
            if (!cfg.focusGatewayTab) return sendResponse({ ok: false, granted: true });
            const tabs = await chrome.tabs.query({});
            const psp = self.KVT_PSP_HOST_PATTERNS || [];
            const hit = tabs.find((t) => {
              try {
                const h = new URL(t.url).hostname;
                return psp.some((p) => h === p || h.endsWith('.' + p));
              } catch (e) { return false; }
            });
            if (hit) {
              await chrome.tabs.update(hit.id, { active: true });
              await chrome.windows.update(hit.windowId, { focused: true });
              return sendResponse({ ok: true, tab: hit.id });
            }
            return sendResponse({ ok: false });
          }

          case 'monitor:claim':
            templateKeepAlive(true);
            return sendResponse({ ok: true });

          case 'monitor:release':
            templateKeepAlive(false);
            return sendResponse({ ok: true });

          case 'open:url':
            if (msg.payload?.url) await chrome.tabs.create({ url: msg.payload.url, active: !!msg.payload.active });
            return sendResponse({ ok: true });

          default:
            return sendResponse({ ok: false, error: 'unknown' });
        }
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  // از صفحه‌ی تنظیمات
  if (msg.from === 'kvt-options') {
    (async () => {
      if (msg.method === 'get') sendResponse(await getConfig());
      else if (msg.method === 'set') {
        const next = await setConfig(msg.payload || {});
        sendResponse(next);
        broadcast('config', next);
      } else if (msg.method === 'reset') {
        await chrome.storage.local.set({ [KEY]: DEFAULTS });
        sendResponse(DEFAULTS);
        broadcast('config', DEFAULTS);
      } else if (msg.method === 'perm-all-sites') {
        sendResponse({ granted: await hasAllSites() });
      } else sendResponse(null);
    })();
    return true;
  }
});

async function hasAllSites() {
  try { return await chrome.permissions.contains({ origins: ['*://*/*'] }); }
  catch (e) { return false; }
}

// ---------- اعلان‌ها: دکمه‌ها ----------
chrome.notifications.onButtonClicked.addListener(async (id, idx) => {
  if (!id.startsWith('kvt-')) return;
  const tabs = await chrome.tabs.query({ url: ['*://kavirtire.ir/*', '*://*.kavirtire.ir/*'] });
  const tab = tabs.find((t) => t.active) || tabs[0];
  if (!tab) return chrome.tabs.create({ url: 'https://kavirtire.ir/esale/products' });
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  if (idx === 1) {
    chrome.tabs.sendMessage(tab.id, { from: 'kvt-bg', type: 'cmd', payload: { cmd: 'toggle-panel' } }).catch(() => {});
  }
  chrome.notifications.clear(id).catch(() => {});
});

chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith('kvt-')) chrome.notifications.clear(id).catch(() => {});
});

// ---------- نشانگر تعداد (badge) ----------
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.from === 'kvt-page' && msg.method === 'badge' && msg.payload) {
    const n = Number(msg.payload.count) || 0;
    chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' }).catch(() => {});
  }
});

// ---------- Port ها (keep-alive) ----------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'kvt-page') return;
  let alive = true;
  port.onDisconnect.addListener(() => { alive = false; });
  port.onMessage.addListener((m) => { if (m?.type === 'ping') port.postMessage({ type: 'pong', t: Date.now() }); });
  // پورت باز مانده، سرویس‌ورکر را بیدار نگه می‌دارد
  setTimeout(() => { try { if (alive) port.postMessage({ type: 'tick' }); } catch (e) { /* noop */ } }, 15000);
});

let keepTimer = null;
function templateKeepAlive(on) {
  if (on) {
    if (keepTimer) return;
    keepTimer = setInterval(async () => {
      // فراخوانی سبک برای تازه‌ماندن سرویس‌ورکر
      try { await chrome.storage.local.get(KEY); } catch (e) { /* noop */ }
    }, 25000);
  } else {
    clearInterval(keepTimer);
    keepTimer = null;
  }
}

// با نصب/بروزرسانی، تنظیمات پیش‌فرض را کامل کن
self.addEventListener('install', () => { self.skipWaiting?.(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients?.claim?.()); });

// هنگام بسته شدن تب‌ها: اگر تب درگاه بانک باز شد، به کاربر خبر بده
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab?.url) return;
  try {
    const cfg = await getConfig();
    if (!cfg.notify) return;
    const h = new URL(tab.url).hostname;
    const psp = self.KVT_PSP_HOST_PATTERNS || [];
    if (psp.some((p) => h === p || h.endsWith('.' + p))) {
      chrome.notifications.create('kvt-gw-' + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'درگاه بانک باز شد ✅',
        message: 'پرداخت را سریع تکمیل کنید.',
        priority: 2
      }).catch(() => {});
    }
  } catch (e) { /* noop */ }
});
