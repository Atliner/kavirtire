/*
 * Kavirtire FastBuy — Panel (MAIN world)
 * پنل شناور RTL در Shadow DOM: انتخاب محصول، اولویت، درگاه، سرعت و لاگ.
 */
(function (g) {
  'use strict';
  const K = g.__KVTB = g.__KVTB || {};
  const S = K.site;
  const PRESETS = g.KVT_PRESETS;

  function createPanel() {
    const existing = document.getElementById('kvt-panel-host');
    if (existing) existing.remove();

    const host = document.createElement('div');
    host.id = 'kvt-panel-host';
    host.style.cssText = 'all:initial;position:fixed;top:12px;left:12px;z-index:2147483646';
    const root = host.attachShadow({ mode: 'open' });

    root.innerHTML = `
    <style>
      :host{all:initial}
      *{box-sizing:border-box;margin:0;padding:0}
      .panel{width:352px;max-height:calc(100vh - 24px);display:flex;flex-direction:column;direction:rtl;
        font-family:Vazirmatn,Tahoma,"Segoe UI",sans-serif;font-size:13px;line-height:1.6;color:#1f2937;
        background:#fff;border-radius:16px;box-shadow:0 18px 48px rgba(15,23,42,.26),0 0 0 1px rgba(15,23,42,.06);overflow:hidden}
      .hd{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;color:#fff;cursor:grab;user-select:none;
        background:linear-gradient(135deg,#2563eb,#4f46e5)}
      .hd:active{cursor:grabbing}
      .hd .ttl{flex:1;font-weight:800;font-size:13.5px;letter-spacing:.1px}
      .dot{width:9px;height:9px;border-radius:50%;background:#94a3b8;flex:none;transition:.2s}
      .dot.run{background:#4ade80;box-shadow:0 0 0 0 rgba(74,222,128,.7);animation:pulse 1.4s infinite}
      .dot.cool{background:#fbbf24}
      @keyframes pulse{70%{box-shadow:0 0 0 8px rgba(74,222,128,0)}100%{box-shadow:0 0 0 0 rgba(74,222,128,0)}}
      .ib{width:25px;height:25px;border:0;border-radius:7px;background:rgba(255,255,255,.16);color:#fff;font-size:13px;cursor:pointer;
        display:grid;place-items:center;line-height:1;flex:none}
      .ib:hover{background:rgba(255,255,255,.32)}
      .bd{padding:10px 12px 12px;overflow-y:auto;min-height:0}
      .panel.closed .bd{display:none}
      .bd::-webkit-scrollbar,.list::-webkit-scrollbar{width:6px}
      .bd::-webkit-scrollbar-thumb,.list::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:6px}

      .tabs{display:flex;gap:4px;background:#f1f5f9;border-radius:10px;padding:3px;margin-bottom:10px}
      .tabs button{flex:1;height:30px;border:0;border-radius:8px;background:transparent;font:inherit;font-size:12px;font-weight:700;
        color:#64748b;cursor:pointer}
      .tabs button.on{background:#fff;color:#4338ca;box-shadow:0 1px 4px rgba(15,23,42,.12)}
      .tabs button{position:relative;font-size:11.5px}
      .tbadge{display:none;position:absolute;top:1px;left:4px;min-width:14px;height:14px;border-radius:7px;background:#dc2626;
        color:#fff;font-size:9px;font-weight:800;line-height:14px;padding:0 3px;text-align:center}
      .tbadge.on{display:inline-block}

      /* ---- Trace viewer ---- */
      .trace-view{display:flex;flex-direction:column;gap:7px;height:100%}
      .tv-bar{display:flex;gap:5px;flex-wrap:wrap}
      .tv-pill{font-size:10.5px;padding:2px 8px;border-radius:999px;background:#f1f5f9;color:#475569;font-weight:700}
      .tv-pill.bad{background:#fee2e2;color:#b91c1c}
      .tv-pill.warn{background:#fef3c7;color:#b45309}
      .tv-tools{display:flex;gap:5px;align-items:center}
      .tv-tools select,.tv-tools input{height:27px;border:1px solid #e2e8f0;border-radius:8px;font:inherit;font-size:11px;padding:0 6px;background:#fff;color:#1f2937}
      .tv-tools select{max-width:96px}
      .tv-tools input{flex:1;min-width:0}
      .tv-b{height:27px;padding:0 8px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#4338ca;font:inherit;font-size:11px;font-weight:700;cursor:pointer}
      .tv-b:hover{background:#eef2ff}
      .tv-b.bad{color:#b91c1c;border-color:#fecaca}
      .tv-b.bad:hover{background:#fef2f2}
      .tv-fails{display:flex;gap:4px;flex-wrap:wrap}
      .tv-fail-title{font-size:10.5px;color:#b91c1c;font-weight:800;width:100%}
      .tv-chip{font-size:10px;padding:2px 7px;border-radius:999px;border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;cursor:pointer;font:inherit;font-size:10px}
      .tv-chip:hover{background:#fee2e2}
      .tv-feed{flex:1;overflow-y:auto;min-height:180px;max-height:300px;display:flex;flex-direction:column;gap:3px;
        border:1px solid #eef2f7;border-radius:10px;padding:6px;background:#fcfdfe}
      .tv-feed::-webkit-scrollbar{width:6px}
      .tv-feed::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:6px}
      .tv-row{border-radius:7px;padding:3px 6px;background:#fff;border:1px solid #f1f5f9;font-size:10.5px}
      .tv-row.error{border-color:#fecaca;background:#fff5f5}
      .tv-row.warn{border-color:#fde68a;background:#fffcf2}
      .tv-row.debug{opacity:.82}
      .tv-h{display:flex;gap:5px;align-items:baseline;cursor:pointer;flex-wrap:wrap}
      .tv-row:not(:has(.tv-d)) .tv-h{cursor:default}
      .tv-time{color:#94a3b8;font-size:9.5px;direction:ltr;flex:none}
      .tv-ms{color:#6366f1;font-weight:800;font-size:9.5px;direction:ltr;flex:none}
      .tv-stage{font-size:9px;font-weight:800;border-radius:4px;padding:0 4px;background:#eef2ff;color:#4338ca;flex:none}
      .tv-stage.s-ADD{background:#dcfce7;color:#15803d}
      .tv-stage.s-PAY{background:#ede9fe;color:#6d28d9}
      .tv-stage.s-DETECT{background:#fef3c7;color:#b45309}
      .tv-stage.s-NET{background:#e0f2fe;color:#0369a1}
      .tv-stage.s-WATCH{background:#f1f5f9;color:#475569}
      .tv-code{font-size:9px;font-weight:800;color:#b91c1c;background:#fee2e2;border-radius:4px;padding:0 4px;direction:ltr;flex:none}
      .tv-msg{flex:1;min-width:0;overflow-wrap:anywhere;color:#1f2937}
      .tv-d{display:none;margin-top:4px;padding-top:4px;border-top:1px dashed #e2e8f0}
      .tv-row.open .tv-d{display:block}
      .tv-json{margin:2px 0;padding:4px 6px;background:#0f172a;color:#cbd5e1;border-radius:6px;font-size:9.5px;
        direction:ltr;text-align:left;overflow-x:auto;max-height:110px;font-family:ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all}
      .tv-diag{margin-top:3px}
      .tv-diag>b{font-size:9.5px;color:#64748b}
      .tv-kv{display:flex;gap:4px;align-items:flex-start;margin-top:3px}
      .tv-k{font-size:9px;font-weight:800;color:#4338ca;background:#eef2ff;border-radius:4px;padding:0 4px;flex:none;direction:ltr}
      .tv-steps{margin-top:3px;display:flex;flex-direction:column;gap:2px}
      .tv-step{display:flex;gap:5px;align-items:baseline;font-size:9.5px;color:#475569;flex-wrap:wrap}
      .tv-empty{text-align:center;color:#94a3b8;font-size:11px;padding:22px 0}
      .tv-foot{font-size:9px;color:#94a3b8;line-height:1.7;direction:rtl}

      .search{position:relative;margin-bottom:8px}
      .search input{width:100%;height:32px;padding:0 30px 0 10px;border:1px solid #e2e8f0;border-radius:9px;font:inherit;font-size:12px;color:#1f2937}
      .search input:focus{outline:0;border-color:#818cf8;box-shadow:0 0 0 3px rgba(99,102,241,.16)}
      .search span{position:absolute;top:50%;right:9px;transform:translateY(-50%);color:#94a3b8;font-size:12px}

      .tools{display:flex;align-items:center;gap:6px;margin-bottom:6px}
      .tools button{border:0;background:#eef2ff;color:#4338ca;font:inherit;font-size:11px;font-weight:700;padding:3px 8px;border-radius:7px;cursor:pointer}
      .tools button:hover{background:#e0e7ff}
      .tools .cnt{margin-right:auto;color:#64748b;font-size:11px}

      .notice{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:#fffbeb;border:1px solid #fde68a;color:#92400e;
        border-radius:9px;padding:6px 9px;font-size:11px;margin-bottom:6px}
      .notice button{border:0;background:#f59e0b;color:#fff;border-radius:7px;padding:2px 8px;font:inherit;font-size:10.5px;font-weight:700;cursor:pointer}
      .list{max-height:236px;overflow-y:auto;padding-left:2px;display:flex;flex-direction:column;gap:5px}
      .row{display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid #e8edf5;border-radius:10px;background:#fff;transition:.14s}
      .row:hover{border-color:#c7d2fe;background:#fafbff}
      .row.on{border-color:#818cf8;background:#eef2ff}
      .chk{position:relative;width:16px;height:16px;flex:none;cursor:pointer}
      .chk input{position:absolute;inset:0;opacity:0;cursor:pointer;margin:0}
      .chk i{position:absolute;inset:0;border:1.6px solid #cbd5e1;border-radius:5px;background:#fff;display:grid;place-items:center;transition:.14s}
      .chk i::after{content:"";width:8px;height:4px;border:2px solid #fff;border-top:0;border-right:0;transform:rotate(-45deg) scale(0);transition:.14s;margin-top:-2px}
      .chk input:checked + i{background:#4f46e5;border-color:#4f46e5}
      .chk input:checked + i::after{transform:rotate(-45deg) scale(1)}
      .nm{flex:1;min-width:0;font-weight:700;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .nm small{display:block;font-weight:500;font-size:11px;color:#64748b;direction:ltr;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .badge{flex:none;font-size:10.5px;padding:1px 7px;border-radius:999px;background:#f1f5f9;color:#64748b;white-space:nowrap}
      .badge.on{background:#dcfce7;color:#15803d}.badge.off{background:#fee2e2;color:#b91c1c}.badge.ex{background:#fef3c7;color:#b45309}
      .qb{flex:none;width:26px;height:26px;border:0;border-radius:8px;background:#eef2ff;color:#4338ca;font-size:13px;cursor:pointer;display:grid;place-items:center}
      .qb:hover{background:#e0e7ff}
      .qb:disabled{opacity:.35;cursor:not-allowed}
      .pri{flex:none;display:flex;flex-direction:column;gap:1px}
      .pri button{width:18px;height:15px;border:0;background:transparent;color:#94a3b8;font-size:9px;cursor:pointer;line-height:1;padding:0}
      .pri button:hover{color:#4f46e5}
      .empty{color:#94a3b8;font-size:12px;text-align:center;padding:16px 0}

      .qtybox{border:1px solid #e0e7ff;background:linear-gradient(180deg,#f8faff,#eef2ff);border-radius:11px;padding:8px 10px;margin-bottom:10px}
      .qtyrow{display:flex;align-items:center;gap:8px;justify-content:space-between;padding:3px 0}
      .qtylbl{font-size:12px;font-weight:700;color:#3730a3}
      .qtyhint{font-size:10px;color:#818cf8;background:#fff;border-radius:999px;padding:1px 7px;flex:none}
      .qtyctl{display:flex;align-items:center;gap:0;margin-right:auto;direction:ltr;background:#fff;border:1px solid #c7d2fe;border-radius:9px;overflow:hidden}
      .qtyctl button{width:28px;height:28px;border:0;background:#eef2ff;color:#4338ca;font-size:15px;font-weight:800;cursor:pointer;line-height:1}
      .qtyctl button:hover{background:#e0e7ff}
      .qtyctl input{width:44px;height:28px;border:0;text-align:center;font:inherit;font-size:13px;font-weight:800;color:#312e81;background:#fff}
      .qtyctl input:focus{outline:0;background:#f5f3ff}
      .sec{font-size:11.5px;font-weight:700;color:#64748b;margin:12px 0 6px}
      .seg{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
      .seg button{height:32px;border:1px solid #e5e7eb;background:#fff;border-radius:9px;font:inherit;font-size:11.5px;color:#334155;cursor:pointer;transition:.14s}
      .seg button:hover{border-color:#c7d2fe}
      .seg button.on{border-color:#4f46e5;background:#eef2ff;color:#3730a3;font-weight:800}
      .seg.gw button{font-size:11px}
      .seg.gw{grid-template-columns:repeat(2,1fr)}

      .opt{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#475569;margin:9px 0 0;gap:8px}
      .opt .hint{color:#94a3b8;font-size:10.5px}
      .sw{position:relative;flex:none;width:38px;height:22px;cursor:pointer}
      .sw input{position:absolute;opacity:0;width:0;height:0}
      .sw span{position:absolute;inset:0;border-radius:999px;background:#cbd5e1;transition:.2s}
      .sw span::after{content:"";position:absolute;top:3px;right:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:.2s}
      .sw input:checked + span{background:#4f46e5}
      .sw input:checked + span::after{transform:translateX(-16px)}

      details{margin:10px 0 0;border:1px solid #e8edf5;border-radius:10px;background:#fafbfe}
      summary{cursor:pointer;padding:7px 10px;font-size:11.5px;font-weight:700;color:#475569;list-style:none;display:flex;justify-content:space-between;user-select:none}
      summary::-webkit-details-marker{display:none}
      summary::after{content:"▾";transition:.2s}
      details[open] > summary::after{transform:rotate(180deg)}
      .set{display:grid;grid-template-columns:1fr 88px;gap:7px 8px;align-items:center;padding:4px 10px 12px;font-size:11.5px;color:#475569}
      .set input[type=number],.set input[type=text]{width:100%;height:29px;padding:0 7px;border:1px solid #dbe2ec;border-radius:8px;direction:ltr;font:inherit;font-size:11.5px;background:#fff;color:#111}
      .set input:focus{outline:0;border-color:#818cf8;box-shadow:0 0 0 3px rgba(99,102,241,.16)}
      .set .sw{justify-self:end}

      .go{width:100%;height:42px;margin-top:11px;border:0;border-radius:11px;color:#fff;font:inherit;font-size:14px;font-weight:800;cursor:pointer;
        background:linear-gradient(135deg,#16a34a,#22c55e);box-shadow:0 6px 16px rgba(34,197,94,.32);transition:.15s}
      .go:hover{filter:brightness(1.05)}
      .go.stop{background:linear-gradient(135deg,#dc2626,#ef4444);box-shadow:0 6px 16px rgba(239,68,68,.32)}
      .go:disabled{opacity:.45;cursor:not-allowed;box-shadow:none;filter:none}

      .rowbtns{display:flex;gap:6px;margin-top:6px}
      .mini{flex:1;height:32px;border:1px solid #e2e8f0;border-radius:9px;background:#fff;color:#4338ca;font:inherit;font-size:12px;
        font-weight:700;cursor:pointer;transition:.14s}
      .mini:hover{background:#eef2ff;border-color:#c7d2fe}
      .stat{display:flex;align-items:center;gap:6px;margin-top:9px;font-size:11px;color:#64748b;flex-wrap:wrap}
      .pill{background:#f1f5f9;border-radius:999px;padding:2px 8px;white-space:nowrap}
      .pill.good{background:#dcfce7;color:#15803d}.pill.warn{background:#fef3c7;color:#b45309}.pill.bad{background:#fee2e2;color:#b91c1c}
      .meter{flex:1;min-width:60px;height:5px;border-radius:999px;background:#e2e8f0;overflow:hidden}
      .meter i{display:block;height:100%;width:0;background:linear-gradient(90deg,#22c55e,#4f46e5);transition:width .3s}

      .log{margin-top:9px;padding:7px 9px;border-radius:9px;background:#f8fafc;border:1px solid #eef2f7;color:#475569;font-size:11.5px;
        max-height:92px;overflow-y:auto;white-space:pre-wrap;word-break:break-word}
      .log div{padding:1px 0}
      .log .ok{color:#15803d}.log .warn{color:#b45309}.log .err{color:#b91c1c}
      .foot{margin-top:8px;font-size:10.5px;color:#94a3b8;text-align:center}
      .foot b{color:#6366f1}
      .hidden{display:none !important}
    </style>

    <div class="panel" id="panel">
      <div class="hd" id="hd">
        <span class="dot" id="dot"></span>
        <span class="ttl">خرید سریع کویرتایر</span>
        <button class="ib" id="min" title="جمع/باز کردن">–</button>
        <button class="ib" id="hide" title="پنهان کردن (Alt+Shift+P)">✕</button>
      </div>
      <div class="bd">
        <div class="tabs" id="tabs">
          <button data-tab="products" class="on">محصولات</button>
          <button data-tab="pay">پرداخت</button>
          <button data-tab="adv">پیشرفته</button>
          <button data-tab="trace">لاگ حرفه‌ای <b id="traceBadge" class="tbadge"></b></button>
        </div>

        <!-- محصولات -->
        <div data-pane="products">
          <div class="search"><span>⌕</span><input id="q" placeholder="جست‌وجو: برند، سایز، شناسه…"></div>
          <div class="tools">
            <button id="all">همه</button>
            <button id="none">هیچ</button>
            <button id="onlyAvail">فقط موجود</button>
            <span class="cnt" id="cnt"></span>
          </div>
          <div class="notice hidden" id="orphans">
            برخی انتخاب‌ها در صفحه‌ی فعلی نیستند (خودرو/صفحه‌ی دیگر).
            <button id="pruneOrphans">پاک کردن آن‌ها</button>
          </div>
          <div class="list" id="list"></div>
          <div class="opt"><span>افزودن خودکار به سبد وقتی موجود شد</span><label class="sw"><input type="checkbox" id="autoAdd"><span></span></label></div>
          <div class="opt"><span>خرید محصولی که از قبل موجود است</span><label class="sw"><input type="checkbox" id="buyIfAlreadyAvailable"><span></span></label></div>
          <div class="opt"><span>توقف پایش بعد از خرید موفق</span><label class="sw"><input type="checkbox" id="stopAfterHit"><span></span></label></div>
        </div>

        <!-- پرداخت -->
        <div data-pane="pay" class="hidden">
          <div class="qtybox">
            <div class="qtyrow">
              <span class="qtylbl">تعداد حلقه</span>
              <div class="qtyctl">
                <button id="qtyMinus" title="کاهش">−</button>
                <input id="qty" type="number" min="1" max="10" value="2">
                <button id="qtyPlus" title="افزایش">+</button>
              </div>
              <span class="qtyhint">حداکثر ۲</span>
            </div>
            <div class="qtyrow">
              <span class="qtylbl">تنظیم خودکار تعداد</span>
              <label class="sw"><input type="checkbox" id="qtyEnabled"><span></span></label>
            </div>
            <div class="qtyrow">
              <span class="qtylbl">اگر تعداد ست نشد، پرداخت نکن</span>
              <label class="sw"><input type="checkbox" id="qtyRequired"><span></span></label>
            </div>
          </div>

          <div class="sec">درگاه پرداخت</div>
          <div class="seg gw" id="gws"></div>
          <div class="opt"><span>انتخاب درگاه و «تایید و پرداخت» خودکار</span><label class="sw"><input type="checkbox" id="autoPay"><span></span></label></div>
          <div class="opt"><span>آوردن تب هنگام موجود شدن</span><label class="sw"><input type="checkbox" id="focusOnHit"><span></span></label></div>
          <div class="opt"><span>فوکوس تب درگاه بانک <span class="hint">(نیاز به دسترسی اختیاری)</span></span><label class="sw"><input type="checkbox" id="focusGatewayTab"><span></span></label></div>
          <div class="opt"><span>صدا و اعلان</span><label class="sw"><input type="checkbox" id="sound"><span></span></label></div>
          <div class="opt"><span>جلوگیری از خواب تایمر در تب پنهان</span><label class="sw"><input type="checkbox" id="keepAwake"><span></span></label></div>
          <div class="set" style="grid-template-columns:1fr 88px;padding:10px 0 0;border-radius:0;background:none">
            <span>تعداد تلاش پرداخت</span><input type="number" id="payRetries" min="1" max="5">
            <span>اعتبار خرید خودکار (ثانیه)</span><input type="number" id="armTtl" min="15" max="900" step="15">
          </div>
          <div class="foot">درگاه‌های پرکاربرد:</div>
        </div>

        <!-- پیشرفته -->
        <div data-pane="adv" class="hidden">
          <div class="sec">پیش‌تنظیم سرعت</div>
          <div class="seg" id="presets"></div>
          <div class="sec">محافظت از حساب</div>
          <div class="set" style="padding:0;background:none;border:0">
            <span>فاصله چک (ms)</span><input type="number" id="interval" min="400" max="60000" step="100">
            <span>حداقل فاصله درخواست‌ها (ms)</span><input type="number" id="minGap" min="150" max="60000" step="50">
            <span>سقف درخواست در دقیقه</span><input type="number" id="maxPerMinute" min="3" max="240">
            <span>تایم‌اوت درخواست (ms)</span><input type="number" id="timeout" min="2000" max="30000" step="500">
            <span>آستانه استراحت (خطای پشت‌سرهم)</span><input type="number" id="breaker" min="2" max="30">
            <span>استراحت طولانی (ms)</span><input type="number" id="longCooldown" min="60000" max="3600000" step="60000">
            <span>فاصله‌ی تصادفی</span><label class="sw"><input type="checkbox" id="jitter"><span></span></label>
            <span>چک از طریق صفحه هنگام محدودیت</span><label class="sw"><input type="checkbox" id="pageFallback"><span></span></label>
            <span>فاصله چک صفحه (ms)</span><input type="number" id="pageInterval" min="2000" max="120000" step="500">
            <span>سقف صفحه در دقیقه</span><input type="number" id="pageMaxPerMinute" min="1" max="30">
          </div>
          <div class="sec">سرعت خرید (هدف: زیر ۲ ثانیه)</div>
          <div class="set" style="padding:0;background:none;border:0">
            <span>بودجه‌ی هر تلاش افزودن (ms)</span><input type="number" id="addTimeout" min="600" max="4000" step="100">
            <span>انتظار ریدایرکت خودکار (ms)</span><input type="number" id="navWait" min="200" max="3000" step="100">
            <span>انتظار فعال شدن دکمه‌ی پرداخت (ms)</span><input type="number" id="payBtnWait" min="800" max="8000" step="100">
            <span>انتظار ریدایرکت به بانک (ms)</span><input type="number" id="payRedirectWait" min="1000" max="8000" step="100">
            <span>اگر درگاه دلخواه نبود</span><input type="text" id="gatewayStrategy" placeholder="first | random">
            <span>ثبت لاگ حرفه‌ای</span><label class="sw"><input type="checkbox" id="traceEnabled"><span></span></label>
          </div>
          <details>
            <summary>تنظیمات حرفه‌ای (آدرس‌ها و انتخابگرها)</summary>
            <div class="set">
              <span>آدرس API موجودی</span><input type="text" id="apiUrl">
              <span>آدرس صفحه محصولات</span><input type="text" id="pageUrl">
              <span>انتخابگر کارت محصول</span><input type="text" id="cardSelector">
              <span>روش افزودن</span><input type="text" id="addMethod" placeholder="auto | wire | click">
              <span>لیست درگاه‌ها (key:نام)</span><input type="text" id="gateways" placeholder="refahk:رفاه, saderat:صادرات">
            </div>
          </details>
          <div class="foot">تنظیمات به‌طور خودکار ذخیره می‌شود.</div>
        </div>

        <div data-pane="trace" class="hidden">
          <div id="traceMount"></div>
        </div>

        <button class="go" id="go" disabled>▶ شروع پایش</button>
        <div class="rowbtns">
          <button class="mini" id="buyNow" title="همین حالا برای محصولات انتخاب‌شده‌ی موجود، خرید را انجام بده">⚡ خرید فوری</button>
          <button class="mini" id="resetBase" title="وضعیت فعلی را دوباره خط مبنا بگیر">↺ بازگرفتن خط مبنا</button>
        </div>
        <div class="stat">
          <span class="pill" id="pMode">آماده</span>
          <span class="pill" id="pLat"></span>
          <span class="pill" id="pChecks"></span>
          <span class="pill warn hidden" id="pOwner"></span>
          <span class="meter" title="بودجه‌ی درخواست در دقیقه"><i id="meter"></i></span>
        </div>
        <div class="log" id="log"></div>
      </div>
    </div>`;

    document.documentElement.appendChild(host);

    const $ = (s) => root.querySelector(s);
    const panel = $('#panel'), dot = $('#dot'), listEl = $('#list'), logEl = $('#log');
    const goBtn = $('#go'), qInput = $('#q');
    const state = { q: '', cards: [], tab: 'products' };

    // ---------- موقعیت و کوچک‌سازی ----------
    const applyPos = () => {
      const p = K.config.panelPos;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        host.style.left = Math.max(4, Math.min(p.x, innerWidth - 60)) + 'px';
        host.style.top = Math.max(4, Math.min(p.y, innerHeight - 60)) + 'px';
      }
      panel.classList.toggle('closed', !!K.config.collapsed);
    };
    applyPos();
    $('#min').onclick = () => {
      const next = !panel.classList.contains('closed');
      panel.classList.toggle('closed', next);
      K.applyConfig({ collapsed: next });
    };
    $('#hide').onclick = () => {
      K.applyConfig({ panelHidden: true });
      K.emit('panel-hidden');
    };
    $('#hd').addEventListener('pointerdown', (e) => {
      if (e.target.closest('.ib')) return;
      const r = host.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => {
        const x = Math.max(2, Math.min(ev.clientX - dx, innerWidth - 80));
        const y = Math.max(2, Math.min(ev.clientY - dy, innerHeight - 50));
        host.style.left = x + 'px'; host.style.top = y + 'px';
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        const r2 = host.getBoundingClientRect();
        K.applyConfig({ panelPos: { x: Math.round(r2.left), y: Math.round(r2.top) } });
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up, { once: true });
    });

    // ---------- تب‌ها ----------
    let traceViewer = null;
    const ensureTrace = () => {
      if (traceViewer) return traceViewer;
      if (!K.createTraceViewer) return null;
      const mount = root.querySelector('#traceMount');
      if (!mount) return null;
      traceViewer = K.createTraceViewer(mount);
      return traceViewer;
    };

    root.querySelectorAll('#tabs button').forEach((b) => {
      b.onclick = () => {
        state.tab = b.dataset.tab;
        root.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
        root.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== state.tab));
        if (state.tab === 'trace') {
          ensureTrace()?.refresh?.();
          const bd = root.querySelector('#traceBadge');
          if (bd) bd.classList.remove('on');
        }
      };
    });

    // نشانگر خطا روی تب لاگ حرفه‌ای
    const badge = root.querySelector('#traceBadge');
    let badgeT = null;
    if (K.trace) {
      K.trace.onRecord((rec) => {
        if (rec.lv !== 'error') return;
        if (badgeT) return;
        badgeT = setTimeout(() => { badgeT = null; }, 400);
        badge.textContent = '';
        badge.classList.add('on');
      });
    }

    // ---------- کمک‌تابع ----------
    const fa = K.fa;
    const setLogLine = (item) => {
      const d = document.createElement('div');
      d.className = item.kind === 'warn' ? 'warn' : item.kind === 'ok' ? 'ok' : item.kind === 'err' ? 'err' : '';
      d.textContent = `${K.faTime(new Date(item.t))} — ${item.msg}`;
      logEl.appendChild(d);
      while (logEl.children.length > 60) logEl.firstChild.remove();
      logEl.scrollTop = logEl.scrollHeight;
    };
    if (K.logs.length) K.logs.slice(-12).forEach(setLogLine);

    const num = (id) => Number($('#' + id).value);
    const bindNum = (id, key, opts = {}) => {
      const el = $('#' + id);
      el.value = K.config[key];
      el.addEventListener('change', () => {
        const v = Number(el.value);
        if (!Number.isFinite(v)) { el.value = K.config[key]; return; }
        const min = opts.min ?? Number(el.min) ?? 0;
        const max = opts.max ?? Number(el.max) ?? 1e9;
        const val = Math.min(max, Math.max(min, v));
        el.value = val;
        K.applyConfig({ [key]: val });
      });
    };
    const bindBool = (id, key) => {
      const el = $('#' + id);
      el.checked = !!K.config[key];
      el.addEventListener('change', () => K.applyConfig({ [key]: el.checked }));
    };
    const bindText = (id, key) => {
      const el = $('#' + id);
      el.value = K.config[key] || '';
      el.addEventListener('change', () => K.applyConfig({ [key]: el.value.trim() }));
    };

    // ---------- درگاه‌ها ----------
    const renderGateways = () => {
      const wrap = $('#gws');
      wrap.replaceChildren();
      const list = K.gatewayList();
      list.forEach((gw) => {
        const b = document.createElement('button');
        b.textContent = gw.name;
        b.classList.toggle('on', (K.config.gateway || '') === gw.key);
        b.onclick = () => K.applyConfig({ gateway: gw.key });
        wrap.appendChild(b);
      });
      const custom = document.createElement('button');
      custom.textContent = 'دستی (هیچ‌کدام)';
      custom.classList.toggle('on', !K.config.gateway);
      custom.onclick = () => K.applyConfig({ gateway: '' });
      wrap.appendChild(custom);
    };

    // ---------- پیش‌تنظیم‌ها ----------
    const renderPresets = () => {
      const wrap = $('#presets');
      wrap.replaceChildren();
      Object.entries(PRESETS).forEach(([key, p]) => {
        const b = document.createElement('button');
        b.textContent = p.label.split(' (')[0];
        b.title = p.hint;
        b.classList.toggle('on', K.config.preset === key);
        b.onclick = () => {
          K.applyConfig({ ...p.patch, preset: key });
          renderPresets();
          syncInputs();
        };
        wrap.appendChild(b);
      });
    };

    // ---------- لیست محصولات ----------
    let lastRenderSig = '';
    const renderProducts = (force) => {
      const products = S.products();
      state.cards = products;
      const selected = new Set((K.config.selected || []).map(String));
      const data = K.engineState?.products || {};
      const sig = products.map((p) => p.id).join('|') + '#' + [...selected].join(',') + '#' + state.q
        + '#' + Object.entries(data).map(([k, v]) => k + (v.available ? '1' : '0')).join('');
      if (!force && sig === lastRenderSig) return;
      lastRenderSig = sig;

      const q = S.norm(state.q || '').toLowerCase();
      const filtered = products.filter((p) => !q || S.norm(p.full).toLowerCase().includes(q) || p.id.includes(q));
      listEl.replaceChildren();

      if (!filtered.length) {
        const e = document.createElement('div');
        e.className = 'empty';
        e.textContent = products.length ? 'نتیجه‌ای پیدا نشد.' : 'محصولی در صفحه نیست. صفحه را نوسازی کنید.';
        listEl.appendChild(e);
        $('#cnt').textContent = '';
        updateGo();
        return;
      }

      filtered.forEach((p) => {
        const stat = data[p.id] || (p.el ? S.status(p.el) : null);
        const avail = !!stat?.available;
        const exhausted = !!stat?.exhausted;

        const row = document.createElement('div');
        row.className = 'row' + (selected.has(p.id) ? ' on' : '');

        const chk = document.createElement('label');
        chk.className = 'chk';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = selected.has(p.id);
        cb.onchange = () => {
          const set = new Set((K.config.selected || []).map(String));
          cb.checked ? set.add(p.id) : set.delete(p.id);
          K.applyConfig({ selected: [...set] });
          row.classList.toggle('on', cb.checked);
          updateGo();
        };
        const mark = document.createElement('i');
        chk.append(cb, mark);

        const nm = document.createElement('div');
        nm.className = 'nm';
        nm.textContent = p.title;
        const small = document.createElement('small');
        small.textContent = (p.size || '') + ' · ' + p.id;
        nm.appendChild(small);
        nm.title = p.full;

        const badge = document.createElement('span');
        badge.className = 'badge ' + (avail ? 'on' : exhausted ? 'ex' : 'off');
        badge.textContent = avail ? 'موجود' : exhausted ? 'اتمام' : 'ناموجود';

        const pri = document.createElement('div');
        pri.className = 'pri';
        const up = document.createElement('button'); up.textContent = '▲'; up.title = 'اولویت بالاتر';
        const dn = document.createElement('button'); dn.textContent = '▼'; dn.title = 'اولویت پایین‌تر';
        up.onclick = (e) => { e.stopPropagation(); movePriority(p.id, -1); };
        dn.onclick = (e) => { e.stopPropagation(); movePriority(p.id, +1); };
        pri.append(up, dn);

        const qb = document.createElement('button');
        qb.className = 'qb'; qb.textContent = '⚡'; qb.title = 'همین حالا به سبد اضافه کن';
        qb.disabled = !avail;
        qb.onclick = (e) => { e.stopPropagation(); K.emit('quick-buy', { id: p.id }); };

        row.append(chk, nm, badge, pri, qb);
        row.addEventListener('dblclick', () => { cb.checked = !cb.checked; cb.onchange(); });
        listEl.appendChild(row);
      });

      const availCount = products.filter((p) => (data[p.id]?.available ?? S.status(p.el)?.available)).length;
      const ids = new Set(products.map((p) => p.id));
      const orphans = [...selected].filter((id) => !ids.has(id)).length;
      $('#cnt').textContent = `${fa(selected.size)} از ${fa(products.length)} · ${fa(availCount)} موجود` +
        (orphans ? ` · ${fa(orphans)} خارج از صفحه` : '');
      const orph = $('#orphans');
      if (orph) orph.classList.toggle('hidden', !orphans);
      updateGo();
    };

    const movePriority = (id, dir) => {
      const sel = (K.config.selected || []).map(String);
      if (!sel.includes(String(id))) sel.push(String(id));
      const prio = (K.config.priority || []).map(String).filter((x) => sel.includes(x));
      sel.forEach((x) => { if (!prio.includes(x)) prio.push(x); });
      const i = prio.indexOf(String(id));
      const j = i + dir;
      if (j < 0 || j >= prio.length) return;
      [prio[i], prio[j]] = [prio[j], prio[i]];
      K.applyConfig({ priority: prio, selected: sel });
    };

    // ---------- کنترل‌ها ----------
    const updateGo = () => {
      const eng = K.engineState;
      const running = !!eng?.running || !!eng?.busy;
      const count = (K.config.selected || []).length;
      goBtn.disabled = !running && !count;
      goBtn.textContent = running ? '⏹ توقف پایش' : '▶ شروع پایش';
      goBtn.classList.toggle('stop', running);
      dot.classList.toggle('run', running);
      dot.title = running ? 'در حال پایش' : 'متوقف';
    };

    const syncInputs = () => {
      const c = K.config;
      const safe = (id, fn) => { try { fn($('#' + id)); } catch (e) { /* noop */ } };
      safe('autoAdd', (e) => { e.checked = !!c.autoAdd; });
      safe('stopAfterHit', (e) => { e.checked = !!c.stopAfterHit; });
      safe('buyIfAlreadyAvailable', (e) => { e.checked = !!c.buyIfAlreadyAvailable; });
      safe('qtyEnabled', (e) => { e.checked = c.qtyEnabled !== false; });
      safe('qtyRequired', (e) => { e.checked = !!c.qtyRequired; });
      safe('qty', (e) => { if (document.activeElement !== e) e.value = c.quantity || 2; });
      safe('autoPay', (e) => { e.checked = !!c.autoPay; });
      safe('focusOnHit', (e) => { e.checked = !!c.focusOnHit; });
      safe('focusGatewayTab', (e) => { e.checked = !!c.focusGatewayTab; });
      safe('sound', (e) => { e.checked = !!c.sound; });
      safe('keepAwake', (e) => { e.checked = !!c.keepAwake; });
      safe('jitter', (e) => { e.checked = !!c.jitter; });
      safe('pageFallback', (e) => { e.checked = !!c.pageFallback; });
      safe('traceEnabled', (e) => { e.checked = !!c.traceEnabled; });
      ['interval', 'minGap', 'maxPerMinute', 'timeout', 'breaker', 'longCooldown', 'pageInterval', 'pageMaxPerMinute', 'payRetries',
       'addTimeout', 'navWait', 'payBtnWait', 'payRedirectWait']
        .forEach((id) => safe(id, (e) => { if (document.activeElement !== e) e.value = c[id]; }));
      safe('gatewayStrategy', (e) => { if (document.activeElement !== e) e.value = c.gatewayStrategy || 'first'; });
      safe('armTtl', (e) => { if (document.activeElement !== e) e.value = Math.round((Number(c.armTtl) || 180000) / 1000); });
      ['apiUrl', 'pageUrl', 'cardSelector', 'addMethod', 'gateways'].forEach((id) => safe(id, (e) => { if (document.activeElement !== e) e.value = c[id] ?? ''; }));
      renderGateways();
      renderPresets();
    };

    bindBool('autoAdd', 'autoAdd');
    bindBool('stopAfterHit', 'stopAfterHit');
    bindBool('buyIfAlreadyAvailable', 'buyIfAlreadyAvailable');
    bindBool('qtyEnabled', 'qtyEnabled');
    bindBool('qtyRequired', 'qtyRequired');
    bindNum('qty', 'quantity', { min: 1, max: 10 });
    bindBool('autoPay', 'autoPay');
    bindBool('focusOnHit', 'focusOnHit');
    bindBool('sound', 'sound');
    bindBool('keepAwake', 'keepAwake');
    bindBool('jitter', 'jitter');
    bindBool('pageFallback', 'pageFallback');
    bindNum('interval', 'interval');
    bindNum('minGap', 'minGap');
    bindNum('maxPerMinute', 'maxPerMinute');
    bindNum('timeout', 'timeout');
    bindNum('breaker', 'breaker');
    bindNum('longCooldown', 'longCooldown');
    bindNum('pageInterval', 'pageInterval');
    bindNum('pageMaxPerMinute', 'pageMaxPerMinute');
    bindNum('payRetries', 'payRetries');
    bindNum('addTimeout', 'addTimeout');
    bindNum('navWait', 'navWait');
    bindNum('payBtnWait', 'payBtnWait');
    bindNum('payRedirectWait', 'payRedirectWait');
    bindText('gatewayStrategy', 'gatewayStrategy');
    bindBool('traceEnabled', 'traceEnabled');
    bindText('apiUrl', 'apiUrl');
    bindText('pageUrl', 'pageUrl');
    bindText('cardSelector', 'cardSelector');
    bindText('addMethod', 'addMethod');
    bindText('gateways', 'gateways');

    // armTtl در تنظیمات میلی‌ثانیه است، در فرم ثانیه
    const armIn = $('#armTtl');
    armIn.addEventListener('change', () => {
      const sec = K.clamp(Number(armIn.value) || 180, 15, 900);
      armIn.value = sec;
      K.applyConfig({ armTtl: Math.round(sec * 1000) });
    });

    // دکمه‌های ± تعداد
    const qtyIn = $('#qty');
    const setQty = (v) => {
      const n = K.clamp(Math.round(Number(v) || 1), 1, 10);
      qtyIn.value = n;
      K.applyConfig({ quantity: n, qtyEnabled: true });
    };
    $('#qtyPlus').onclick = () => setQty(Number(qtyIn.value) + 1);
    $('#qtyMinus').onclick = () => setQty(Number(qtyIn.value) - 1);
    qtyIn.addEventListener('change', () => setQty(qtyIn.value));

    $('#focusGatewayTab').addEventListener('change', async (e) => {
      const on = e.target.checked;
      if (on) {
        const res = await K.bridge.fire('tab:gateway', { request: true });
        if (res && res.granted === false) {
          e.target.checked = false;
          K.applyConfig({ focusGatewayTab: false });
          K.log('برای فوکوس تب درگاه، از صفحه‌ی تنظیمات افزونه دسترسی «همه سایت‌ها» را فعال کنید.', 'warn');
          K.bridge.fire('config:open', null);
          return;
        }
      }
      K.applyConfig({ focusGatewayTab: on });
    });

    qInput.addEventListener('input', () => { state.q = qInput.value; renderProducts(true); });
    $('#all').onclick = () => {
      K.applyConfig({ selected: state.cards.map((p) => p.id) });
      renderProducts(true);
    };
    $('#none').onclick = () => {
      K.applyConfig({ selected: [] });
      renderProducts(true);
    };
    $('#pruneOrphans').onclick = () => {
      const ids = new Set(S.products().map((p) => p.id));
      const kept = (K.config.selected || []).filter((id) => ids.has(String(id)));
      K.applyConfig({ selected: kept });
      renderProducts(true);
    };
    $('#onlyAvail').onclick = () => {
      const data = K.engineState?.products || {};
      const ids = state.cards.filter((p) => data[p.id]?.available ?? S.status(p.el)?.available).map((p) => p.id);
      K.applyConfig({ selected: ids });
      renderProducts(true);
    };

    goBtn.onclick = () => {
      const eng = K.engine;
      if (!eng) return;
      if (K.engineState?.running || K.engineState?.busy) eng.stop('کاربر');
      else eng.start();
    };

    $('#buyNow').onclick = () => {
      const eng = K.engine;
      if (!eng) return;
      if (!(K.config.selected || []).length) { K.log('اول محصول(ها) را انتخاب کنید.', 'warn'); return; }
      eng.buyNow();
    };
    $('#resetBase').onclick = () => K.engine?.resetHits?.();

    // ---------- وضعیت و لاگ ----------
    const updateStats = () => {
      const st = K.engineState;
      if (!st) return;
      const g = st.guard || {};
      const mode = $('#pMode');
      if (st.running) {
        mode.textContent = (st.busy ? 'در حال خرید' : 'در حال پایش') + (K.config.qtyEnabled ? ` · ${K.config.quantity || 2} حلقه` : '');
        mode.className = 'pill good';
      } else {
        mode.textContent = 'متوقف';
        mode.className = 'pill';
      }
      $('#pLat').textContent = st.latency != null ? st.latency + ' ms' : '—';
      $('#pChecks').textContent = 'چک: ' + fa(st.checksOk || 0) + (st.checks && st.checks !== st.checksOk ? ' / ' + fa(st.checks) : '');
      const used = g.used || 0, cap = g.cap || 1;
      $('#meter').style.width = Math.min(100, Math.round((used / cap) * 100)) + '%';
      const cool = g.cool || 0;
      const owner = $('#pOwner');
      if (owner) {
        if (!st.running && st.guard && K.engine?.hasOwner && !K.engine.hasOwner() && (K.engine.ownerId?.() || null)) {
          owner.textContent = 'پایش در تب دیگر';
          owner.className = 'pill warn';
          owner.classList.remove('hidden');
        } else owner.classList.add('hidden');
      }
      dot.classList.toggle('cool', cool > 0);
      if (cool > 0) {
        const secs = Math.ceil(cool / 1000);
        mode.textContent = '⏳ استراحت ' + secs + ' ثانیه';
        mode.className = 'pill warn';
        if (secs <= 3 && !K.__coolWarned) {
          K.__coolWarned = true;
          K.log('استراحت محافظتی تقریباً تمام شد؛ پایش ادامه می‌یابد.', 'ok');
        }
        if (secs > 3) K.__coolWarned = false;
      } else if (!st.running) {
        K.__coolWarned = false;
      }
      updateGo();
    };

    // ---------- رویدادها ----------
    const offs = [];
    const on = (t, fn) => offs.push(K.on(t, fn));

    on('log', setLogLine);
    on('config', () => { syncInputs(); renderProducts(true); updateStats(); });
    on('data', () => { renderProducts(); });
    on('run', () => { updateGo(); updateStats(); });
    on('guard', updateStats);
    on('tick', updateStats);
    on('watch', () => renderProducts(true));
    on('products-changed', () => renderProducts(true));

    syncInputs();
    renderProducts(true);
    updateGo();
    updateStats();
    setInterval(updateStats, 1000);
    // اگر Livewire کارت‌ها را با تأخیر رندر کرد، دوباره بخوان
    setTimeout(() => renderProducts(true), 800);
    setTimeout(() => renderProducts(true), 2000);

    // تغییرات DOM (ورود/خروج محصول) — throttle
    let moTimer = null;
    const mo = new MutationObserver(() => {
      clearTimeout(moTimer);
      moTimer = setTimeout(() => {
        const n = S.cards().length;
        if (n !== state.cards.length) renderProducts(true);
        else renderProducts();
      }, 350);
    });
    try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) { /* noop */ }

    const api = {
      destroy() {
        offs.forEach((f) => { try { f(); } catch (e) { /* noop */ } });
        try { traceViewer?.destroy?.(); } catch (e) { /* noop */ }
        traceViewer = null;
        mo.disconnect();
        host.remove();
      },
      alive: () => host.isConnected,
      rerender() { renderProducts(true); },
      openTab(tab) {
        state.tab = tab;
        const b = root.querySelector(`#tabs button[data-tab="${tab}"]`);
        b?.click();
      }
    };
    if (K.config.panelHidden) host.classList.add('hidden');
    api.show = () => {
      host.classList.remove('hidden');
      if (K.config.panelHidden) K.applyConfig({ panelHidden: false });
    };
    api.hide = () => host.classList.add('hidden');
    return api;
  }

  K.createPanel = createPanel;
})(globalThis);
