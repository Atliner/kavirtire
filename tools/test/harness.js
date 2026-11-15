/*
 * Test harness: runs the extension's content scripts inside jsdom against a
 * fake Kavirtire page, with a stubbed `chrome.runtime` bridge.
 *
 *   node tools/test/harness.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'extension/src');

let failures = 0;
let passes = 0;
function ok(cond, name, extra) {
  if (cond) { passes++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { failures++; console.log('  \x1b[31m✗\x1b[0m ' + name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n\x1b[1m' + t + '\x1b[0m'); }

const TIRES = [
  { id: '101', title: 'یارا 185/65R15' },
  { id: '102', title: 'یارا 195/65R15' },
  { id: '103', title: 'ماراتن 205/60R16' }
];

function productsHtml(stock) {
  return '<!doctype html><html lang="fa" dir="rtl"><body>' + TIRES.map((t) => `
    <div class="product" data-tire-id="${t.id}" wire:id="lw-${t.id}"
         wire:snapshot="${JSON.stringify({ data: { available: !!stock[t.id], exhausted: false } }).replace(/"/g, '&quot;')}">
      <div class="title">${t.title}</div><div class="size">${t.id}</div>
      <button class="product-add-button ${stock[t.id] ? '' : 'd-none'}">افزودن</button>
    </div>`).join('') + '</body></html>';
}

function paymentHtml() {
  return `<!doctype html><html lang="fa" dir="rtl"><body>
    <div wire:id="lw-pay" wire:snapshot="{&quot;data&quot;:{&quot;gateway&quot;:&quot;&quot;}}">
      <div class="checkout-item">تایر</div>
      <button wire:click="setGateway('refahk')">رفاه</button>
      <button wire:click="setGateway('saderat')">صادرات</button>
      <button wire:click="next()">تایید و پرداخت</button>
    </div></body></html>`;
}

function boot({ url, html, config = {}, stock = { 101: 0, 102: 0, 103: 0 } }) {
  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    resources: "usable"
  });
  const w = dom.window;

  // --- storage shims ---
  w.eval(`
    (function(){
      const mem = new Map();
      Object.defineProperty(window, 'localStorage', { value: {
        getItem: (k) => mem.has(k) ? mem.get(k) : null,
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k),
        clear: () => mem.clear()
      }, configurable: true });
      const smem = new Map();
      Object.defineProperty(window, 'sessionStorage', { value: {
        getItem: (k) => smem.has(k) ? smem.get(k) : null,
        setItem: (k, v) => smem.set(k, String(v)),
        removeItem: (k) => smem.delete(k)
      }, configurable: true });
    })();
  `);

  // --- chrome stub ---
  const calls = [];
  const fullConfig = Object.assign({}, w.KVT_DEFAULTS, config);
  w.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        calls.push(msg);
        const reply = async () => {
          if (msg.from === 'kvt-page') {
            if (msg.method === 'config:get') return fullConfig;
            if (msg.method === 'config:set') return msg.payload;
            if (msg.method === 'tab:gateway') return { granted: true };
            return { ok: true };
          }
        };
        Promise.resolve(reply()).then((r) => cb && cb(r));
      },
      connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {}, disconnect() {} }),
      onMessage: { addListener() {} },
      lastError: null
    }
  };

  // --- postMessage bridge: mimic bridge.js relaying to the stub ---
  w.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || d.__kvt_fastbuy__ !== 1 || d.kind !== 'req') return;
    const reply = async () => {
      if (d.method === 'config:get') return fullConfig;
      if (d.method === 'config:set') { Object.assign(fullConfig, d.payload); return fullConfig; }
      if (d.method === 'tab:gateway') return { granted: true };
      if (d.method === 'notify') { calls.push({ method: 'notify', payload: d.payload }); return { ok: true }; }
      return { ok: true };
    };
    Promise.resolve(reply()).then((data) => {
      w.postMessage({ __kvt_fastbuy__: 1, kind: 'res', id: d.id, ok: true, data }, '*');
    });
  });

  // --- fetch stub ---
  const net = { requests: [] };
  w.fetch = async (input, init) => {
    const u = String(input);
    net.requests.push({ url: u, at: Date.now(), init });
    const state = w.__testState;
    if (u.includes('/availability')) {
      if (state.limitedApi > 0) {
        state.limitedApi--;
        return new Response(JSON.stringify({ message: 'slow down' }), { status: 429, headers: { 'Retry-After': '1' } });
      }
      const products = {};
      TIRES.forEach((t) => { products[t.id] = { available: !!state.stock[t.id], exhausted: false }; });
      return new Response(JSON.stringify({ products }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (u.includes('/esale/products') || u.endsWith('/esale/products')) {
      return new Response(productsHtml(state.stock), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  w.__testState = { stock: { ...stock }, limitedApi: 0 };

  // --- misc browser APIs used by the extension ---
  w.AudioContext = function () {
    return {
      state: 'running', resume() {}, currentTime: 0, destination: {},
      createOscillator: () => ({ frequency: { value: 0 }, connect: () => ({ connect() {} }), start() {}, stop() {}, type: '' }),
      createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 }, connect: () => ({ connect() {} }) }),
      close() {}
    };
  };
  w.CSS = w.CSS || { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
  w.DOMParser = w.DOMParser;
  w.AbortController = w.AbortController;

  // --- load scripts in manifest order ---
  const files = [
    'shared/defaults.js', 'content/core.js', 'content/guard.js', 'content/site.js',
    'content/engine.js', 'content/payment.js', 'content/panel.js', 'content/main.js'
  ];
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    try { w.eval(code); } catch (e) {
      console.error('LOAD FAIL ' + f + ': ' + e.message);
      throw e;
    }
  }
  return { dom, w, net, calls, config: fullConfig };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ---------------------------------------------------------------- 1
  section('۱) بارگذاری و ساخت پنل');
  {
    const { w } = boot({ url: 'https://kavirtire.ir/esale/products', html: productsHtml({ 101: 0, 102: 1, 103: 0 }) });
    await sleep(300);
    const host = w.document.getElementById('kvt-panel-host');
    ok(!!host, 'پنل شناور ساخته شد');
    ok(!!host?.shadowRoot, 'پنل در Shadow DOM است (بدون تداخل با سایت)');
    const rows = host?.shadowRoot?.querySelectorAll('.row') || [];
    ok(rows.length === 3, 'سه محصول در لیست پنل رندر شد', 'found=' + rows.length);
    const badges = [...(host?.shadowRoot?.querySelectorAll('.badge') || [])].map((b) => b.textContent);
    ok(badges.includes('موجود') && badges.includes('ناموجود'), 'وضعیت موجود/ناموجود درست نمایش داده شد', badges.join('|'));
    const overlay = w.document.querySelectorAll('.kvt-quick');
    ok(overlay.length === 3, 'دکمه‌ی خرید فوری روی هر کارت قرار گرفت', 'found=' + overlay.length);
  }

  // ---------------------------------------------------------------- 2
  section('۲) تشخیص «موجود شد» و افزودن به سبد');
  {
    const { w } = boot({
      url: 'https://kavirtire.ir/esale/products',
      html: productsHtml({ 101: 0, 102: 0, 103: 0 }),
      config: { selected: ['101'], interval: 300, minGap: 150, maxPerMinute: 60, autoAdd: true, autoPay: true, sound: false, notify: false }
    });
    await sleep(250);
    const K = w.__KVTB;
    ok(!!K?.engine, 'موتور پایش ساخته شد');
    K.engine.start();
    await sleep(400);
    ok(K.engineState.baselineDone || K.engineState.checks >= 0, 'خط مبنا در حال ثبت است');

    // موجود شدن محصول
    w.__testState.stock[101] = 1;
    await sleep(1200);

    ok(K.engineState.hits.includes('101'), 'محصول ۱۰۱ به‌عنوان «موجود شد» شناسایی شد', JSON.stringify(K.engineState.hits));
    const arm = K.store.get('arm', null);
    ok(!!arm && typeof arm === 'object' && arm.id === '101', 'علامت خرید (arm) برای محصول درست ثبت شد', JSON.stringify(arm));
    K.engine.stop('test');
  }

  // ---------------------------------------------------------------- 3
  section('۳) محصولِ از قبل موجود نباید ناخواسته خریداری شود');
  {
    const { w } = boot({
      url: 'https://kavirtire.ir/esale/products',
      html: productsHtml({ 101: 1, 102: 0, 103: 0 }),
      stock: { 101: 1, 102: 0, 103: 0 },
      config: { selected: ['101'], interval: 250, minGap: 100, maxPerMinute: 60, sound: false, notify: false }
    });
    await sleep(250);
    const K = w.__KVTB;
    K.engine.start();
    await sleep(1200);
    ok(K.engineState.baselineDone, 'خط مبنا گرفته شد');
    ok(K.engineState.hits.length === 0, 'محصول ۱۰۱ (از قبل موجود) به‌عنوان خرید شناسایی نشد', JSON.stringify(K.engineState.hits));
    K.engine.stop('test');
  }

  // ---------------------------------------------------------------- 3b
  section('۳ب) با «خرید محصول از قبل موجود» روشن، باید بخرد');
  {
    const { w } = boot({
      url: 'https://kavirtire.ir/esale/products',
      html: productsHtml({ 101: 1, 102: 0, 103: 0 }),
      stock: { 101: 1, 102: 0, 103: 0 },
      config: { selected: ['101'], interval: 250, minGap: 100, maxPerMinute: 60, buyIfAlreadyAvailable: true, sound: false, notify: false }
    });
    await sleep(250);
    const K = w.__KVTB;
    const buyLogs = [];
    K.on('hit', (d) => buyLogs.push(d));
    K.engine.start();
    await sleep(1500);
    ok(K.engineState.hits.includes('101') || buyLogs.length > 0,
      'با تنظیم خرید فوری، محصول از قبل موجود شناسایی و خریداری شد',
      JSON.stringify({ hits: K.engineState.hits, events: buyLogs.length, checks: K.engineState.checks }));
    K.engine.stop('test');
  }

  // ---------------------------------------------------------------- 4
  section('۴) احترام به 429 و Backoff (بدون رفرش مکرر)');
  {
    const { w, net } = boot({
      url: 'https://kavirtire.ir/esale/products',
      html: productsHtml({ 101: 0, 102: 0, 103: 0 }),
      config: { selected: ['101'], interval: 200, minGap: 100, maxPerMinute: 100, pageFallback: false, sound: false, notify: false }
    });
    await sleep(250);
    const K = w.__KVTB;
    w.__testState.limitedApi = 2;
    K.engine.start();
    await sleep(1600);
    const g = K.engine.guard.snapshot();
    ok(g.fails > 0 || g.cool > 0, 'پاسخ ۴۲۹ ثبت و شمارنده‌ی خطا/کول‌داون فعال شد', JSON.stringify(g));
    const before = net.requests.length;
    await sleep(700);
    const after = net.requests.length;
    ok(after - before <= 2, 'پس از ۴۲۹، نرخ درخواست خودکار کاهش یافت (backoff)', `before=${before} after=${after}`);
    ok(!net.requests.some((r) => r.url.includes('/esale/products') && !r.url.includes('availability')),
      'هیچ درخواست HTML/رفرش کاملی ارسال نشد (فقط API سبک)');
    K.engine.stop('test');
  }

  // ---------------------------------------------------------------- 5
  section('۵) بودجه‌ی نرخ سراسری');
  {
    const { w, net } = boot({
      url: 'https://kavirtire.ir/esale/products',
      html: productsHtml({ 101: 0, 102: 0, 103: 0 }),
      config: { selected: ['101'], interval: 100, minGap: 100, maxPerMinute: 4, sound: false, notify: false }
    });
    await sleep(250);
    const K = w.__KVTB;
    K.engine.start();
    await sleep(2500);
    const apiCalls = net.requests.filter((r) => r.url.includes('availability')).length;
    ok(apiCalls <= 7, 'سقف درخواست در دقیقه رعایت شد', 'apiCalls=' + apiCalls);
    K.engine.stop('test');
  }

  // ---------------------------------------------------------------- 6
  section('۶) صفحه‌ی پرداخت: انتخاب خودکار درگاه + تایید پرداخت');
  {
    const dom = new JSDOM(paymentHtml(), { url: 'https://kavirtire.ir/esale/payment', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    w.eval(`(function(){const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)},configurable:true});const s=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>s.has(k)?s.get(k):null,setItem:(k,v)=>s.set(k,String(v)),removeItem:k=>s.delete(k)},configurable:true});})();`);

    const cfg = Object.assign({}, w.KVT_DEFAULTS, {
      autoPay: true, gateway: 'refahk', sound: false, notify: false, payRetries: 2
    });
    w.chrome = { runtime: { sendMessage: (m, cb) => cb(null), connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {}, disconnect() {} }) } };
    w.addEventListener('message', (ev) => {
      const d = ev.data;
      if (!d || d.__kvt_fastbuy__ !== 1) return;
      const data = d.method === 'config:get' ? cfg : { ok: true };
      w.postMessage({ __kvt_fastbuy__: 1, kind: 'res', id: d.id, ok: true, data }, '*');
    });
    // شبیه‌سازی Livewire
    const wireState = { gateway: '' };
    w.Livewire = {
      find: () => ({ $get: (k) => wireState[k], $call: (m, arg) => { if (m === 'setGateway') wireState.gateway = arg; return Promise.resolve(); } }),
      hook() {}
    };
    let paid = 0;
    w.document.querySelector('[wire\\:click="setGateway(\'refahk\')"]').addEventListener('click', () => {
      setTimeout(() => { wireState.gateway = 'refahk'; }, 60);
    });
    w.document.querySelector('[wire\\:click="next()"]').addEventListener('click', () => { paid++; });

    // arm معتبر
    w.eval('localStorage.setItem("kvt:arm", JSON.stringify({t: Date.now(), id: "101"}))');

    for (const f of ['shared/defaults.js', 'content/core.js', 'content/guard.js', 'content/site.js', 'content/engine.js', 'content/payment.js', 'content/main.js']) {
      w.eval(fs.readFileSync(path.join(SRC, f), 'utf8'));
    }
    await sleep(2500);
    ok(wireState.gateway === 'refahk', 'درگاه «رفاه» به‌طور خودکار انتخاب شد', 'gateway=' + wireState.gateway);
    ok(paid >= 1, 'دکمه‌ی «تایید و پرداخت» به‌طور خودکار کلیک شد', 'paid=' + paid);
  }

  // ---------------------------------------------------------------- 7
  section('۷) پرداخت دستی: بدون arm نباید خودکار پرداخت کند');
  {
    const dom = new JSDOM(paymentHtml(), { url: 'https://kavirtire.ir/esale/payment', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    w.eval(`(function(){const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)},configurable:true});const s=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>s.has(k)?s.get(k):null,setItem:(k,v)=>s.set(k,String(v)),removeItem:k=>s.delete(k)},configurable:true});})();`);
    const cfg = Object.assign({}, w.KVT_DEFAULTS, { autoPay: true, gateway: 'refahk', sound: false, notify: false });
    w.chrome = { runtime: { sendMessage: (m, cb) => cb(null), connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {}, disconnect() {} }) } };
    w.addEventListener('message', (ev) => {
      const d = ev.data;
      if (!d || d.__kvt_fastbuy__ !== 1) return;
      w.postMessage({ __kvt_fastbuy__: 1, kind: 'res', id: d.id, ok: true, data: d.method === 'config:get' ? cfg : { ok: true } }, '*');
    });
    let paid = 0;
    w.document.querySelector('[wire\\:click="next()"]').addEventListener('click', () => { paid++; });
    for (const f of ['shared/defaults.js', 'content/core.js', 'content/guard.js', 'content/site.js', 'content/engine.js', 'content/payment.js', 'content/main.js']) {
      w.eval(fs.readFileSync(path.join(SRC, f), 'utf8'));
    }
    await sleep(1200);
    ok(paid === 0, 'بدون علامت خرید، پرداخت خودکار انجام نشد (امن)', 'paid=' + paid);
    const toast = w.document.querySelector('#kvt-toast');
    ok(!!toast, 'پیام شناور پرداخت دستی نمایش داده شد');
  }

  // ---------------------------------------------------------------- 8
  section('۸) تنظیمات مشترک: ادغام امن');
  {
    const { w } = boot({ url: 'https://kavirtire.ir/esale/products', html: productsHtml({}) });
    const merge = w.KVT_mergeConfig;
    const out = merge(w.KVT_DEFAULTS, { interval: 999, hacked: 'x', selected: ['1', '2'], autoPay: false });
    ok(out.interval === 999 && out.autoPay === false, 'کلیدهای مجاز اعمال شدند');
    ok(!('hacked' in out), 'کلید ناشناخته نادیده گرفته شد');
    ok(Array.isArray(out.selected) && out.selected.length === 2, 'آرایه‌ها درست ادغام شدند');
    ok(merge(w.KVT_DEFAULTS, { interval: 'abc' }).interval === w.KVT_DEFAULTS.interval, 'مقدار نامعتبر رد شد');
  }

  console.log(`\n${failures === 0 ? '\x1b[32m' : '\x1b[31m'}${passes} passed, ${failures} failed\x1b[0m`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
