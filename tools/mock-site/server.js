/*
 * Mock Kavirtire site for local testing of the extension.
 * Mimics the DOM/API contract the extension expects.
 *
 *   /esale/products  — product grid with wire:snapshot / .product-add-button
 *   /esale/products/availability — JSON availability (can be forced to 429)
 *   /esale/payment   — cart + gateway selector + next() button
 *
 * Run:  node tools/mock-site/server.js   (then open http://localhost:8123/esale/products)
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT || 8123);

// --- state ---
const TIRES = [
  { id: '101', brand: 'کویر تایر', model: 'یارا 185/65R15', size: '185/65R15', price: '2,450,000' },
  { id: '102', brand: 'کویر تایر', model: 'یارا 195/65R15', size: '195/65R15', price: '2,650,000' },
  { id: '103', brand: 'کویر تایر', model: 'ماراتن 205/60R16', size: '205/60R16', price: '3,150,000' },
  { id: '104', brand: 'کویر تایر', model: 'ماراتن 215/65R16', size: '215/65R16', price: '3,450,000' },
  { id: '105', brand: 'کویر تایر', model: 'ویکتورا 225/45R17', size: '225/45R17', price: '4,250,000' },
  { id: '106', brand: 'کویر تایر', model: 'ویکتورا 235/55R18', size: '235/55R18', price: '5,150,000' }
];

let stock = { 101: 0, 102: 2, 103: 5, 104: 1, 105: 0, 106: 3 };
let exhausted = { 101: true };
let forceLimitedUntil = 0;
let requests = [];
let cart = [];
let gateway = '';
let counters = { api: 0, page: 0, limited: 0, payment: 0 };

function snapshotFor(t) {
  return JSON.stringify({ data: { available: stock[t.id] > 0, exhausted: !!exhausted[t.id], limit: 4 } });
}

function productsHtml() {
  const cards = TIRES.map((t) => {
    const isOut = stock[t.id] <= 0;
    return `
    <div class="product" data-tire-id="${t.id}" wire:id="lw-${t.id}" wire:snapshot="${snapshotFor(t).replace(/"/g, '&quot;')}">
      <div class="title">${t.brand} ${t.model}</div>
      <div class="size">${t.size}</div>
      <div class="price">${t.price} ریال</div>
      <button class="product-add-button ${isOut ? 'd-none' : ''}" wire:click="add">افزودن</button>
    </div>`;
  }).join('');
  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>محصولات — Mock Kavirtire</title>
<style>
 body{font-family:Tahoma,sans-serif;background:#f1f5f9;margin:0;padding:20px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
 .product{background:#fff;border-radius:12px;padding:14px;border:1px solid #e2e8f0;position:relative}
 .title{font-weight:700;margin-bottom:4px}.size{color:#64748b;font-size:12px;margin-bottom:8px}
 .product-add-button{background:#16a34a;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer}
 .d-none{display:none}
 .admin{position:fixed;bottom:10px;right:10px;background:#fff;padding:10px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.15);direction:rtl;font-size:12px;z-index:9999}
 .admin button{margin:2px}
</style></head><body>
<h2>محصولات (Mock)</h2>
<div class="grid">${cards}</div>
<div class="admin">
  <b>پنل تست</b><br>
  ${TIRES.map((t) => `<button onclick="setStock(${t.id},1)">+${t.id}</button>
  <button onclick="setStock(${t.id},0)">-${t.id}</button>`).join('')}
  <hr>
  <label>۴۲۹ به مدت: <input id="lim" type="number" value="0" style="width:50px"> ثانیه</label>
  <button onclick="limit('api')">۴۲۹ API</button>
  <button onclick="limit('page')">۴۲۹ صفحه</button>
  <hr><span id="stats"></span>
</div>
<script>
  const headers = { 'X-XSRF-TOKEN': 'mock' };
  async function setStock(id, v) {
    await fetch('/__test/stock?id=' + id + '&v=' + v, { method: 'POST' });
    location.reload();
  }
  async function limit(scope) {
    const s = Number(document.getElementById('lim').value) || 0;
    await fetch('/__test/limit?scope=' + scope + '&sec=' + s, { method: 'POST' });
    location.reload();
  }
  async function stat() {
    const r = await fetch('/__test/stats'); const j = await r.json();
    document.getElementById('stats').textContent =
      'API: ' + j.api + ' | page: ' + j.page + ' | 429: ' + j.limited + ' | cart: ' + j.cart;
  }
  stat(); setInterval(stat, 1000);
  // کلیک افزودن اگر افزونه نبود
  document.querySelectorAll('.product').forEach((card) => {
    card.querySelector('.product-add-button')?.addEventListener('click', () => {
      window.Livewire = window.Livewire || {};
      // شبیه‌سازی: ناوبری به پرداخت
      fetch('/__test/cart/add?id=' + card.dataset.tireId, { method: 'POST' })
        .then(() => { location.href = '/esale/payment'; });
    });
  });
</script>
</body></html>`;
}

function paymentHtml() {
  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>پرداخت — Mock</title>
<style>
 body{font-family:Tahoma;background:#f1f5f9;padding:24px}
 .card{background:#fff;border-radius:14px;padding:18px;max-width:560px;margin:auto;box-shadow:0 8px 26px rgba(0,0,0,.06)}
 .checkout-item{padding:10px;border-bottom:1px solid #eee}
 .gw{display:flex;gap:8px;margin:12px 0}
 .gw button{flex:1;padding:10px;border:2px solid #e2e8f0;border-radius:10px;background:#fff;cursor:pointer}
 .gw button.on{border-color:#4f46e5;background:#eef2ff}
 .pay{width:100%;padding:14px;border:0;border-radius:10px;background:#16a34a;color:#fff;font-size:15px;cursor:pointer}
 .pay:disabled{background:#94a3b8}
</style></head><body>
<div class="card" wire:id="lw-payment" wire:snapshot="{&quot;data&quot;:{&quot;gateway&quot;:&quot;&quot;}}">
  <h3>سبد خرید</h3>
  ${cart.map((c) => `<div class="checkout-item">${c}</div>`).join('') || '<div class="checkout-item">(خالی)</div>'}
  <h4>انتخاب درگاه</h4>
  <div class="gw">
    <button wire:click="setGateway('refahk')" data-gw="refahk">رفاه کارگران</button>
    <button wire:click="setGateway('saderat')" data-gw="saderat">صادرات</button>
    <button wire:click="setGateway('pnovin')" data-gw="pnovin">اقتصاد نوین</button>
  </div>
  <button class="pay" wire:click="next()" ${cart.length ? '' : 'disabled'}>تایید و پرداخت</button>
  <p id="msg" style="color:#64748b;font-size:12px"></p>
</div>
<script>
  let gateway = '';
  const titleMap = { refahk: 'رفاه', saderat: 'صادرات', pnovin: 'اقتصاد نوین' };
  document.querySelectorAll('.gw button').forEach((b) => {
    b.onclick = () => {
      gateway = b.dataset.gw;
      document.querySelectorAll('.gw button').forEach((x) => x.classList.toggle('on', x === b));
      document.getElementById('msg').textContent = 'درگاه انتخاب شد: ' + titleMap[gateway] + ' (سمت سرور ثبت شد)';
      fetch('/__test/gateway?k=' + gateway, { method: 'POST' });
    };
  });
  document.querySelector('.pay').onclick = () => {
    document.getElementById('msg').textContent = 'انتقال به درگاه بانک…';
    fetch('/__test/pay', { method: 'POST' }).then(() => { location.href = '/bank/gateway?gw=' + gateway; });
  };
</script>
</body></html>`;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const send = (code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };

  if (p === '/esale/products') {
    counters.page++;
    if (Date.now() < forceLimitedUntil && u.searchParams.get('__') !== 'ignore') {
      if (globalThis.limitScope === 'page' || globalThis.limitScope === 'all') {
        counters.limited++;
        return send(429, 'text/html', 'too many requests');
      }
    }
    return send(200, 'text/html; charset=utf-8', productsHtml());
  }

  if (p === '/esale/products/availability') {
    counters.api++;
    requests.push(Date.now());
    if (Date.now() < forceLimitedUntil && (globalThis.limitScope === 'api' || globalThis.limitScope === 'all')) {
      counters.limited++;
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '2' });
      return res.end(JSON.stringify({ message: 'Too Many Requests' }));
    }
    const products = {};
    TIRES.forEach((t) => { products[t.id] = { available: stock[t.id] > 0, exhausted: !!exhausted[t.id] }; });
    return send(200, 'application/json', JSON.stringify({ products }));
  }

  if (p === '/esale/payment') {
    counters.payment++;
    return send(200, 'text/html; charset=utf-8', paymentHtml());
  }

  if (p === '/bank/gateway') {
    return send(200, 'text/html; charset=utf-8',
      `<html lang="fa" dir="rtl"><body style="font-family:Tahoma;padding:40px;text-align:center">
       <h2>درگاه بانک (Mock)</h2><p>درگاه: ${u.searchParams.get('gw')}</p>
       <button onclick="location.href='/esale/products'">بازگشت به فروشگاه</button></body></html>`);
  }

  // test hooks
  if (p === '/__test/stock') {
    stock[u.searchParams.get('id')] = Number(u.searchParams.get('v'));
    return send(200, 'application/json', '{"ok":true}');
  }
  if (p === '/__test/limit') {
    globalThis.limitScope = u.searchParams.get('scope');
    forceLimitedUntil = Date.now() + Number(u.searchParams.get('sec') || 0) * 1000;
    return send(200, 'application/json', '{"ok":true}');
  }
  if (p === '/__test/cart/add') {
    cart.push('تایر ' + u.searchParams.get('id'));
    return send(200, 'application/json', '{"ok":true}');
  }
  if (p === '/__test/gateway') { gateway = u.searchParams.get('k'); return send(200, 'application/json', '{"ok":true}'); }
  if (p === '/__test/pay') { counters.payment++; return send(200, 'application/json', '{"ok":true}'); }
  if (p === '/__test/stats') {
    return send(200, 'application/json', JSON.stringify({ ...counters, cart: cart.length, gateway }));
  }

  if (p === '/') { res.writeHead(302, { Location: '/esale/products' }); return res.end(); }

  send(404, 'text/plain', 'not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Mock Kavirtire running on http://0.0.0.0:' + PORT + '/esale/products');
});
