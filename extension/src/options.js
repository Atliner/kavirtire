/*
 * Kavirtire FastBuy — Options
 * صفحه‌ی تنظیمات: پیش‌تنظیم‌ها، دسترسی اختیاری، صادرات/واردات و بازنشانی.
 */
const $ = (s) => document.querySelector(s);
const D = self.KVT_DEFAULTS;
const PRESETS = self.KVT_PRESETS;

let cfg = { ...D };

function send(method, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ from: 'kvt-options', method, payload }, (res) => resolve(res));
  });
}

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

function applyToForm() {
  document.querySelectorAll('[data-key]').forEach((el) => {
    const key = el.dataset.key;
    const v = cfg[key];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (key === 'armTtl') el.value = Math.round((Number(v) || 180000) / 1000);
    else el.value = v ?? '';
  });
  document.querySelectorAll('.preset').forEach((b) => {
    b.classList.toggle('on', cfg.preset === b.dataset.preset);
  });
  document.querySelector('#ver').textContent = self.KVT_VERSION || '';
}

function collect() {
  const patch = {};
  document.querySelectorAll('[data-key]').forEach((el) => {
    const key = el.dataset.key;
    if (!(key in D)) return;
    if (el.type === 'checkbox') patch[key] = el.checked;
    else if (key === 'armTtl') patch[key] = Math.round(Number(el.value) * 1000);
    else if (typeof D[key] === 'number') patch[key] = Number(el.value);
    else patch[key] = el.value;
  });
  return patch;
}

async function save(patch) {
  cfg = { ...cfg, ...(patch || collect()) };
  await send('set', cfg);
  applyToForm();
}

// ---------- رویدادها ----------
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.dataset?.key) return;
  clearTimeout(el._t);
  el._t = setTimeout(() => save(), 350);
});

document.querySelectorAll('.preset').forEach((b) => {
  b.onclick = async () => {
    const patch = { ...PRESETS[b.dataset.preset].patch, preset: b.dataset.preset };
    toast('پیش‌تنظیم «' + PRESETS[b.dataset.preset].label + '» اعمال شد', 'ok');
    await save(patch);
  };
});

$('#reset').onclick = async () => {
  if (!confirm('همه‌ی تنظیمات به حالت پیش‌فرض برگردد؟')) return;
  cfg = await send('reset');
  applyToForm();
  toast('تنظیمات بازنشانی شد', 'ok');
};

$('#export').onclick = () => {
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kavirtire-fastbuy-config.json';
  a.click();
  URL.revokeObjectURL(a.href);
};

$('#import').onclick = () => $('#importFile').click();
$('#importFile').onchange = async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    await save(data);
    toast('تنظیمات وارد شد', 'ok');
  } catch (err) {
    toast('فایل معتبر نیست', 'bad');
  }
  e.target.value = '';
};

$('#perm').onclick = async () => {
  const granted = await chrome.permissions.request({ origins: ['*://*/*'] });
  toast(granted ? 'دسترسی داده شد' : 'دسترسی داده نشد', granted ? 'ok' : 'bad');
  refreshPerm();
};

$('#revoke').onclick = async () => {
  await chrome.permissions.remove({ origins: ['*://*/*'] });
  toast('دسترسی «همه سایت‌ها» برداشته شد', 'ok');
  refreshPerm();
};

async function refreshPerm() {
  const has = await chrome.permissions.contains({ origins: ['*://*/*'] });
  $('#permState').textContent = has ? 'فعال' : 'غیرفعال';
  $('#permState').className = 'pill ' + (has ? 'good' : '');
  $('#perm').disabled = has;
  $('#revoke').disabled = !has;
}

$('#openSite').onclick = () => chrome.tabs.create({ url: 'https://kavirtire.ir/esale/products' });

// ---------- شروع ----------
(async () => {
  cfg = (await send('get')) || { ...D };
  applyToForm();
  await refreshPerm();
})();
