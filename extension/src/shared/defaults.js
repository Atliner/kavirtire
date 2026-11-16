/*
 * Kavirtire FastBuy — مقادیر مشترک
 * این فایل به‌صورت اسکریپت کلاسیک (نه ماژول) لود می‌شود تا هم در
 * content script ها (دنیای MAIN)، هم در service worker و هم در صفحه‌ی تنظیمات
 * بدون build در دسترس باشد.
 */
(function (g) {
  'use strict';

  // درگاه‌های شناخته‌شده‌ی سایت (کلید همان مقداری است که سایت به setGateway می‌دهد)
  var GATEWAYS = [
    { key: 'refahk', name: 'رفاه کارگران' },
    { key: 'saderat', name: 'صادرات' },
    { key: 'pnovin', name: 'اقتصاد نوین' }
  ];

  // پیکربندی پیش‌فرض. هر کلیدی را می‌توان از پنل/صفحه‌ی تنظیمات تغییر داد.
  var DEFAULTS = {
    schema: 1,

    // --- پایش موجودی ---
    interval: 800,          // فاصله‌ی پایه‌ی چک API (میلی‌ثانیه)
    jitter: true,            // فاصله‌ی تصادفی برای شبیه شدن به رفتار انسانی
    minGap: 450,             // حداقل فاصله بین دو درخواست (ms)
    maxPerMinute: 60,        // سقف درخواست در دقیقه (بودجه‌ی سراسری)
    timeout: 8000,           // تایم‌اوت هر درخواست (ms)

    // --- چک از طریق صفحه (وقتی API محدود شده) ---
    pageFallback: false,     // پیش‌فرض خاموش: کمترین ریسک بلاک شدن
    pageInterval: 6000,
    pageMaxPerMinute: 8,

    // --- محافظت در برابر بلاک شدن ---
    maxCooldown: 120000,     // سقف انتظار خودکار بعد از 429 (ms)
    breaker: 6,              // تعداد خطای پشت‌سرهم 429/403 تا استراحت طولانی
    longCooldown: 600000,    // استراحت طولانی (ms)

    // --- خرید ---
    autoAdd: true,           // افزودن خودکار به سبد وقتی موجود شد
    buyIfAlreadyAvailable: false, // اگر محصول از قبل موجود بود هم بخرد (نه فقط لحظه‌ی موجود شدن)
    autoPay: true,           // انتخاب درگاه و تایید پرداخت به‌صورت خودکار
    armTtl: 180000,          // اعتبار «علامت خرید» روی صفحه‌ی پرداخت (ms)
    gateways: '',            // بازنویسی لیست درگاه‌ها: "key:نام, key:نام"
    payRetries: 3,
    paymentUrl: '/esale/payment',
    cartItemSelector: '.checkout-item',
    // --- تعداد حلقه (در صفحه‌ی پیش از درگاه) ---
    quantity: 2,                 // تعداد حلقه‌ی هدف (۱..۱۰) — پیش‌فرض ۲
    qtyEnabled: true,            // تنظیم خودکار تعداد
    qtyWait: 1200,               // بودجه‌ی زمانی تعیین تعداد (ms)
    qtyRequired: false,          // اگر تعداد ست نشد، جلوی پرداخت را بگیر

    addTimeout: 900,             // بودجه‌ی هر تلاش افزودن به سبد (ms)
    navWait: 500,                // صبر برای ریدایرکت خودکار Livewire (ms)
    payBtnWait: 1400,            // سقف انتظار برای فعال شدن دکمه‌ی پرداخت (ms)
    payRedirectWait: 1800,       // سقف انتظار برای ریدایرکت به بانک (ms)
    gatewayStrategy: 'first',    // اگر درگاه تنظیم‌شده در صفحه نبود: first | random
    gateway: 'refahk',

    // --- رفتار ---
    sound: true,
    notify: true,
    keepAwake: true,         // جلوگیری از خوابیدن تایمر تب پنهان با پخش صامت
    focusOnHit: true,        // آوردن تب به جلو هنگام موجود شدن
    focusGatewayTab: false,  // فوکوس تب درگاه بانک (نیازمند دسترسی اختیاری)
    overlays: true,          // برچسب/دکمه‌ی خرید فوری روی کارت محصولات
    stopAfterHit: true,      // توقف پایش بعد از خرید موفق

    // --- انتخاب محصول ---
    selected: [],            // شناسه‌های انتخاب‌شده
    priority: [],            // ترتیب اولویت (شناسه‌ها)

    // --- پیشرفته ---
    apiUrl: '/esale/products/availability',
    pageUrl: '/esale/products',
    cardSelector: '.product[data-tire-id]',
    addMethod: 'auto',       // auto | wire | click

    // --- لاگ حرفه‌ای (Trace) ---
    traceEnabled: true,          // ثبت لاگ تخصصی
    traceMax: 5000,              // حداکثر رکورد نگه‌داری‌شده
    traceNet: true,              // ضبط درخواست/پاسخ‌های شبکه‌ی مرتبط

    // --- رابط کاربری ---
    panelPos: null,
    collapsed: false,
    panelHidden: false,
    preset: 'balanced',
    firstRun: true
  };

  // پیش‌تنظیم‌ها
  var PRESETS = {
    safe: {
      label: 'امن (کمترین ریسک)',
      hint: 'دو برابر کندتر، بدون چک صفحه، استراحت طولانی‌تر',
      patch: {
        interval: 1800, jitter: true, minGap: 1000, maxPerMinute: 30,
        pageFallback: false, breaker: 4, longCooldown: 900000, maxCooldown: 180000
      }
    },
    balanced: {
      label: 'متعادل (پیشنهادی)',
      hint: 'تعادل سرعت و ایمنی',
      patch: {
        interval: 800, jitter: true, minGap: 700, maxPerMinute: 45,
        pageFallback: false, breaker: 6, longCooldown: 600000, maxCooldown: 120000
      }
    },
    aggressive: {
      label: 'تهاجمی (پرریسک)',
      hint: 'سریع‌تر، احتمال محدودیت بیشتر — با مسئولیت خودتان',
      patch: {
        interval: 500, jitter: true, minGap: 300, maxPerMinute: 110,
        pageFallback: true, pageInterval: 5000, pageMaxPerMinute: 10,
        breaker: 10, longCooldown: 300000, maxCooldown: 60000
      }
    }
  };

  // میزبان‌های درگاه‌های بانکی رایج (برای اعلان/فوکوس تب درگاه)
  var PSP_HOST_PATTERNS = [
    'shaparak.ir', 'sadadpsp.ir', 'refah-bank.ir', 'enbank.ir', 'sepehr.mci.ir',
    'asanpardakht.ir', 'zarinpal.com', 'pay.ir', 'idpay.ir', 'yekpay.ir',
    'mellat.mobi', 'behpardakht.com', 'sep.shaparak.ir', 'pec.ir', 'samanepay.com',
    'parsian-bank.ir', 'pasargad-bank.ir', 'sb24.ir', 'banksepah.ir', 'tejaratbank.ir'
  ];

  var STORAGE_KEY = 'config';

  g.KVT_GATEWAYS = GATEWAYS;
  g.KVT_DEFAULTS = DEFAULTS;
  g.KVT_PRESETS = PRESETS;
  g.KVT_PSP_HOST_PATTERNS = PSP_HOST_PATTERNS;
  g.KVT_STORAGE_KEY = STORAGE_KEY;
  g.KVT_VERSION = '1.2.0';

  // ادغام امن: فقط کلیدهای شناخته‌شده، با نوع درست
  g.KVT_mergeConfig = function (base, patch) {
    var out = Object.assign({}, base);
    if (!patch || typeof patch !== 'object') return out;
    Object.keys(patch).forEach(function (k) {
      if (!(k in DEFAULTS)) return;
      var d = DEFAULTS[k];
      var v = patch[k];
      if (v === null) { out[k] = d; return; }
      if (Array.isArray(d)) {
        out[k] = Array.isArray(v) ? v.slice(0, 500) : d;
        return;
      }
      if (typeof d === 'number') {
        var n = Number(v);
        if (Number.isFinite(n)) out[k] = n;
        return;
      }
      if (typeof d === 'boolean') { out[k] = !!v; return; }
      if (typeof d === 'string') { out[k] = String(v).slice(0, 500); return; }
      out[k] = v;
    });
    return out;
  };
})(globalThis);
