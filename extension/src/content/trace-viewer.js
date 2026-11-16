/*
 * Kavirtire FastBuy — Trace Viewer (MAIN world)
 *
 * تب «لاگ حرفه‌ای» در پنل — کاملاً جدا از لاگ کاربر عادی.
 * نشان می‌دهد: هر خرید با چه مراحلی و چند میلی‌ثانیه انجام شد و کجا شکست خورد.
 */
(function (g) {
  'use strict';
  const K = g.__KVTB = g.__KVTB || {};

  const STAGE_FA = {
    BOOT: 'راه‌اندازی', WATCH: 'پایش', DETECT: 'تشخیص',
    ADD: 'سبد', NAV: 'ناوبری', PAY: 'پرداخت', NET: 'شبکه', CFG: 'تنظیمات'
  };
  const LEVEL_FA = { debug: 'اشکال‌زدایی', info: 'اطلاع', warn: 'هشدار', error: 'خطا' };

  const FAIL_FA = {
    ADD_NO_ELEMENT: 'کارت محصول پیدا نشد',
    ADD_UNAVAILABLE: 'محصول ناموجود شد',
    ADD_NO_METHOD: 'روش افزودن در دسترس نبود',
    ADD_NO_RESPONSE: 'پاسخ سرور نیامد',
    ADD_NOT_SELECTED: 'سرور محصول را انتخاب نکرد',
    ADD_SERVER_429: 'محدودیت نرخ (۴۲۹)',
    ADD_SERVER_5XX: 'خطای سرور (۵xx)',
    ADD_SERVER_419: 'نشست منقضی (۴۱۹)',
    ADD_NET_ERROR: 'خطای شبکه',
    ADD_MODAL_BLOCK: 'مودال مزاحم',
    ADD_TIMEOUT: 'تایم‌اوت افزودن',
    ADD_LEGACY: 'رفتار قدیمی/کند',
    PAY_NO_CART: 'سبد خالی',
    PAY_NO_GWBTN: 'دکمه‌ی درگاه نبود',
    PAY_GW_UNSET: 'درگاه ثبت نشد',
    PAY_QTY_FAILED: 'تنظیم تعداد ناموفق',
    PAY_NO_PAYBTN: 'دکمه‌ی پرداخت غیرفعال',
    PAY_BTN_DISABLED: 'دکمه‌ی پرداخت غیرفعال',
    PAY_NO_NAV: 'ریدایرکت به بانک نشد',
    PAY_TIMEOUT: 'تایم‌اوت پرداخت',
    PAY_NO_WIRE: 'کامپوننت Livewire نبود',
    NAV_FAILED: 'ناوبری شکست خورد',
    DET_NO_BASELINE: 'خط مبنا ثبت نشد',
    WATCH_429: 'محدودیت سرور',
    WATCH_419: 'نشست منقضی',
    WATCH_NET: 'خطای شبکه',
    CFG_INVALID: 'تنظیم نامعتبر',
    UNKNOWN: 'نامشخص'
  };

  function failFa(code) { return FAIL_FA[code] || code || '—'; }

  function humanMs(ms) {
    if (ms == null) return '—';
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(2) + 's';
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /**
   * رندر کامل تب لاگ حرفه‌ای درون پنل
   * @param {HTMLElement} mount
   * @param {() => void} onClose
   */
  function createTraceViewer(mount) {
    const T = K.trace;
    const st = { filter: 'all', q: '', autoScroll: true, expanded: null };
    let off = null;

    mount.classList.add('trace-view');
    mount.innerHTML = `
      <div class="tv-bar">
        <span class="tv-pill" id="tvTotal">۰</span>
        <span class="tv-pill bad" id="tvErr">۰ خطا</span>
        <span class="tv-pill warn" id="tvWarn">۰ هشدار</span>
        <span class="tv-pill" id="tvSid">—</span>
      </div>
      <div class="tv-tools">
        <select id="tvFilter">
          <option value="all">همه</option>
          <option value="error">فقط خطا</option>
          <option value="warn">هشدار و خطا</option>
          <option value="ADD">خرید/سبد</option>
          <option value="PAY">پرداخت</option>
          <option value="WATCH">پایش</option>
          <option value="DETECT">تشخیص</option>
          <option value="NET">شبکه</option>
        </select>
        <input id="tvQ" placeholder="جست‌وجو در لاگ…">
        <button class="tv-b" id="tvCopy" title="کپی همه‌ی لاگ‌ها">کپی</button>
        <button class="tv-b" id="tvJson" title="دانلود JSON">JSON</button>
        <button class="tv-b bad" id="tvClear" title="پاک کردن لاگ">پاک</button>
      </div>
      <div class="tv-fails" id="tvFails"></div>
      <div class="tv-feed" id="tvFeed"></div>
      <div class="tv-foot" id="tvFoot">—</div>
    `;

    const $ = (s) => mount.querySelector(s);
    const feed = $('#tvFeed'), fails = $('#tvFails');
    const totalEl = $('#tvTotal'), errEl = $('#tvErr'), warnEl = $('#tvWarn'), sidEl = $('#tvSid'), footEl = $('#tvFoot');

    // ---------- رندر ----------
    function matches(rec) {
      const f = st.filter;
      if (f === 'error' && rec.lv !== 'error') return false;
      if (f === 'warn' && rec.lv !== 'warn' && rec.lv !== 'error') return false;
      if (['ADD', 'PAY', 'WATCH', 'DETECT', 'NET'].includes(f) && rec.st !== f) return false;
      if (st.q) {
        const hay = `${rec.m} ${rec.d || ''} ${rec.c || ''} ${STAGE_FA[rec.st] || rec.st} ${failFa(rec.c)}`.toLowerCase();
        if (!hay.includes(st.q.toLowerCase())) return false;
      }
      return true;
    }

    function recRow(rec) {
      const row = el('div', 'tv-row ' + (rec.lv || 'info') + (rec.c ? ' failed' : ''));
      const head = el('div', 'tv-h');
      head.appendChild(el('span', 'tv-time', new Date(rec.t).toLocaleTimeString('fa-IR', { hour12: false })));
      head.appendChild(el('span', 'tv-stage s-' + rec.st, (STAGE_FA[rec.st] || rec.st)));
      if (rec.ms != null) head.appendChild(el('span', 'tv-ms', humanMs(rec.ms)));
      if (rec.c) head.appendChild(el('span', 'tv-code', rec.c));
      head.appendChild(el('span', 'tv-msg', rec.m));
      row.appendChild(head);

      // جزئیات: فقط اگر داده یا مراحل داشته باشد
      const hasDetail = rec.d || rec.diag || rec.steps;
      if (hasDetail) {
        const body = el('div', 'tv-d');
        if (rec.d) {
          const pre = el('pre', 'tv-json');
          pre.textContent = pretty(rec.d);
          body.appendChild(pre);
        }
        if (rec.diag) {
          const box = el('div', 'tv-diag');
          box.appendChild(el('b', null, 'تشخیص:'));
          for (const [k, v] of Object.entries(rec.diag)) {
            const line = el('div', 'tv-kv');
            line.appendChild(el('span', 'tv-k', k));
            const pre = el('pre', 'tv-json');
            pre.textContent = pretty(v);
            line.appendChild(pre);
            box.appendChild(line);
          }
          body.appendChild(box);
        }
        if (rec.steps) {
          const ol = el('div', 'tv-steps');
          for (const s of rec.steps) {
            const li = el('div', 'tv-step');
            li.appendChild(el('span', 'tv-ms', humanMs(s.ms)));
            li.appendChild(el('span', null, s.m));
            if (s.d) {
              const pre = el('pre', 'tv-json');
              pre.textContent = pretty(s.d);
              li.appendChild(pre);
            }
            ol.appendChild(li);
          }
          body.appendChild(ol);
        }
        head.onclick = () => {
          const open = body.style.display !== 'none';
          body.style.display = open ? 'none' : 'block';
          row.classList.toggle('open', !open);
        };
        row.appendChild(body);
      }
      return row;
    }

    function pretty(v) {
      if (v == null) return '';
      try {
        const obj = typeof v === 'string' && /^[[{]/.test(v.trim()) ? JSON.parse(v) : v;
        return typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1);
      } catch (e) { return String(v); }
    }

    function render() {
      if (!T) return;
      const all = T.dump();
      const stats = T.stats();

      totalEl.textContent = K.fa(stats.total);
      errEl.textContent = K.fa(stats.byLevel.error || 0) + ' خطا';
      warnEl.textContent = K.fa(stats.byLevel.warn || 0) + ' هشدار';
      sidEl.textContent = (stats.session || '').slice(0, 9);
      sidEl.title = 'شناسه‌ی نشست: ' + stats.session;

      // کارت‌های خلاصه‌ی شکست
      const failsList = Object.entries(stats.fails || {}).sort((a, b) => b[1] - a[1]);
      fails.replaceChildren();
      if (failsList.length) {
        fails.appendChild(el('div', 'tv-fail-title', 'دلایل شکست (برای رفع باگ):'));
        for (const [code, n] of failsList.slice(0, 8)) {
          const chip = el('button', 'tv-chip');
          chip.textContent = `${failFa(code)} ×${K.fa(n)}`;
          chip.title = code;
          chip.onclick = () => {
            st.q = code;
            $('#tvQ').value = code;
            st.filter = 'all';
            $('#tvFilter').value = 'all';
            render();
          };
          fails.appendChild(chip);
        }
      }

      const frag = document.createDocumentFragment();
      const list = all.filter(matches).slice(-200);
      for (const rec of list) frag.appendChild(recRow(rec));
      if (!list.length) frag.appendChild(el('div', 'tv-empty', 'رکوردی مطابق فیلتر نیست.'));
      feed.replaceChildren(frag);
      if (st.autoScroll) feed.scrollTop = feed.scrollHeight;

      const byStage = stats.byStage || {};
      footEl.textContent = K.STAGES.map((s) => `${STAGE_FA[s] || s}: ${byStage[s] || 0}`).join(' · ');
    }

    // ---------- اقدام‌ها ----------
    $('#tvFilter').onchange = (e) => { st.filter = e.target.value; render(); };
    let qT = null;
    $('#tvQ').oninput = (e) => {
      clearTimeout(qT);
      qT = setTimeout(() => { st.q = e.target.value.trim(); render(); }, 180);
    };
    $('#tvClear').onclick = () => {
      if (!confirm('همه‌ی لاگ‌های حرفه‌ای پاک شود؟')) return;
      T.clear();
      K.bridge.fire('trace:clear', { session: T.session() });
      render();
    };
    $('#tvCopy').onclick = async () => {
      const txt = exportText();
      try {
        await navigator.clipboard.writeText(txt);
        $('#tvCopy').textContent = 'کپی شد ✓';
        setTimeout(() => { $('#tvCopy').textContent = 'کپی'; }, 1500);
      } catch (e) {
        // فالبک: انتخاب متن
        const ta = document.createElement('textarea');
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        $('#tvCopy').textContent = 'کپی شد ✓';
        setTimeout(() => { $('#tvCopy').textContent = 'کپی'; }, 1500);
      }
    };
    $('#tvJson').onclick = () => {
      const payload = {
        generatedAt: new Date().toISOString(),
        version: K.version,
        session: T.session(),
        url: location.href,
        stats: T.stats(),
        entries: T.dump()
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `kavirtire-trace-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    };

    function exportText() {
      const lines = [
        `# Kavirtire FastBuy — Trace ${T.session()}`,
        `# ${new Date().toISOString()} | v${K.version} | ${location.href}`,
        `# stats: ${JSON.stringify(T.stats())}`,
        ''
      ];
      for (const r of T.dump()) {
        const parts = [
          new Date(r.t).toISOString(),
          r.st,
          (r.lv || '').toUpperCase(),
          r.c ? `[${r.c}]` : '',
          r.sp ? `(${r.sp})` : '',
          r.ms != null ? `${r.ms}ms` : '',
          r.m,
          r.d ? '  data=' + pretty(r.d).replace(/\n\s*/g, ' ') : '',
          r.diag ? '  diag=' + JSON.stringify(r.diag).slice(0, 900) : ''
        ];
        lines.push(parts.filter(Boolean).join(' | '));
      }
      return lines.join('\n');
    }

    // ---------- زنده ----------
    let renderT = null;
    const scheduleRender = () => {
      if (renderT) return;
      renderT = setTimeout(() => { renderT = null; render(); }, 250);
    };
    if (T) off = T.onRecord(scheduleRender);

    feed.addEventListener('scroll', () => {
      st.autoScroll = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    });

    const t = setInterval(render, 1500);
    render();

    return {
      destroy() { clearInterval(t); if (off) off(); clearTimeout(renderT); },
      refresh: render
    };
  }

  K.createTraceViewer = createTraceViewer;
  K.failFa = failFa;
  K.humanMs = humanMs;
})(globalThis);
