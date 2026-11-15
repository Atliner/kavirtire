/*
 * Kavirtire FastBuy — Payment (MAIN world)
 *
 * روی صفحه‌ی /esale/payment:
 *  - اگر «علامت خرید» معتبر باشد و autoPay روشن باشد، درگاه را انتخاب و «تایید و پرداخت» را می‌زند
 *  - دکمه‌ی شناور «درگاه را انتخاب کن و پرداخت کن» برای حالت دستی
 *  - منتظر ریدایرکت به بانک می‌ماند؛ اگر نشد، با تأخیر دوباره تلاش می‌کند (نه بیشتر از payRetries)
 */
(function (g) {
  'use strict';
  const K = g.__KVTB = g.__KVTB || {};
  const S = K.site;

  function toast() {
    const host = document.createElement('div');
    host.id = 'kvt-toast';
    host.style.cssText = 'all:initial;position:fixed;top:16px;left:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        .t{width:320px;direction:rtl;font-family:Vazirmatn,Tahoma,"Segoe UI",sans-serif;font-size:13px;color:#1f2937;background:#fff;
           border-radius:16px;box-shadow:0 12px 44px rgba(15,23,42,.28),0 0 0 1px rgba(15,23,42,.06);overflow:hidden}
        .h{display:flex;align-items:center;gap:8px;padding:11px 14px;color:#fff;font-weight:800;
           background:linear-gradient(135deg,#2563eb,#4f46e5)}
        .h .sp{flex:1}
        .x{width:22px;height:22px;border:0;border-radius:6px;background:rgba(255,255,255,.18);color:#fff;cursor:pointer;font-size:12px}
        .m{padding:12px 14px;line-height:1.8}
        .m.warn{background:#fef3c7;color:#92400e}.m.ok{background:#dcfce7;color:#166534}.m.bad{background:#fee2e2;color:#991b1b}
        .b{display:flex;gap:8px;padding:0 14px 12px}.b:empty{display:none}
        .b button{flex:1;height:38px;border:0;border-radius:10px;color:#fff;font:inherit;font-weight:700;cursor:pointer;background:#4f46e5}
        .b button.ok{background:#16a34a}.b button.bad{background:#dc2626}
        .b button:hover{filter:brightness(1.06)}
      </style>
      <div class="t">
        <div class="h"><span>⚡</span><span class="sp">پرداخت سریع</span><button class="x" id="x">✕</button></div>
        <div class="m" id="m"></div>
        <div class="b" id="b"></div>
      </div>`;
    document.documentElement.appendChild(host);
    const m = root.getElementById('m'), b = root.getElementById('b');
    root.getElementById('x').onclick = () => host.remove();
    return {
      set(text, cls = '') { m.textContent = text; m.className = 'm ' + cls; },
      buttons(list) {
        b.replaceChildren(...list.map(([label, fn, kind]) => {
          const x = document.createElement('button');
          x.textContent = label; x.className = kind || ''; x.onclick = fn; return x;
        }));
      },
      alive: () => host.isConnected,
      destroy() { host.remove(); }
    };
  }

  function gatewayList() {
    const raw = (K.config.gateways || '').trim();
    if (raw) {
      const list = raw.split(',').map((s) => {
        const [k, ...rest] = s.split(':');
        return { key: (k || '').trim(), name: (rest.join(':') || k || '').trim() };
      }).filter((x) => x.key);
      if (list.length) return list;
    }
    return g.KVT_GATEWAYS || [];
  }

  K.gatewayList = gatewayList;

  function paymentPage() {
    const ui = toast();
    const st = { cancelled: false, running: false, handedOff: false, tries: 0 };
    // علامت خرید: { t: timestamp, id: tireId } — با فرمت قدیمی (عدد) هم سازگار است
    const armRaw = K.store.get('arm', null);
    const armAt = typeof armRaw === 'number' ? armRaw : Number(armRaw?.t) || 0;
    const armId = (armRaw && typeof armRaw === 'object') ? String(armRaw.id || '') : '';
    const ttl = Math.max(Number(K.config.armTtl) || 180000, 15000);
    const armed = !!armAt && (Date.now() - armAt) < ttl;
    const cartIds = K.store.get('cartIds', []);
    const mismatch = !!(armId && cartIds.length && !cartIds.map(String).includes(armId));
    const consume = () => K.store.del('arm');
    const gws = gatewayList();
    const gwKey = (K.config.gateway || '').trim();
    const gwName = gws.find((x) => x.key === gwKey)?.name || gwKey;

    K.store.del('navigating');
    K.log(`صفحه‌ی پرداخت | armed=${armed} | autoPay=${K.config.autoPay} | gateway=${gwKey}`);

    const pageState = {
      onUpdate: null,
      destroy() { ui.destroy(); },
      alive: () => ui.alive()
    };

    function lockRun(fn) {
      if (st.running) return;
      st.running = true;
      Promise.resolve().then(fn).catch((e) => {
        console.warn('[KVT payment]', e);
        ui.set('خطا در پرداخت خودکار: ' + (e.message || e), 'bad');
        ui.buttons([]);
      }).finally(() => { st.running = false; });
    }

    async function run(auto) {
      ui.buttons([['لغو', () => { st.cancelled = true; consume(); ui.set('⏹ لغو شد؛ خودتان ادامه دهید.', 'warn'); ui.buttons([]); }, 'bad']]);
      if (!gwKey) { consume(); ui.set('درگاهی انتخاب نشده؛ از پنل انتخاب کنید.', 'warn'); ui.buttons([]); return; }

      ui.set(`⏳ آماده‌سازی درگاه ${gwName}...`);
      if (!S.cartCount()) {
        // صفحه ممکن است هنوز رندر نشده باشد
        const ok = await K.waitFor(() => S.cartCount() > 0, 3000, 100);
        if (!ok) { consume(); K.beep('warn'); ui.set('⚠️ سبد خرید خالی است؛ پرداخت انجام نشد.', 'bad'); ui.buttons([]); return; }
      }

      const btn = await K.waitFor(() => S.gatewayButton(gwKey), 12000, 60);
      if (st.cancelled) return;
      if (!btn) {
        consume(); K.beep('warn');
        ui.set(`⚠️ دکمه‌ی درگاه «${gwName}» پیدا نشد؛ دستی انتخاب کنید.`, 'bad');
        ui.buttons([]);
        return;
      }

      const host = btn.closest('[wire\\:id]') || document.querySelector('[wire\\:id]');
      const wire = await K.waitFor(() => S.wireOf(host), 12000, 60);
      if (st.cancelled) return;

      const readGw = () => { try { return wire && wire.$get ? wire.$get('gateway') : undefined; } catch (e) { return undefined; } };
      const readable = readGw() !== undefined;

      ui.set(`⏳ ثبت درگاه ${gwName}...`);
      if (readGw() !== gwKey) {
        S.click(btn);
        if (readable) await K.waitFor(() => readGw() === gwKey, 5000, 60);
        else await K.sleep(800);
      }
      if (st.cancelled) return;

      if (readable && readGw() !== gwKey) {
        // ثبت نشد: یک بار دیگر مستقیم با API کامپوننت امتحان کن
        try { await wire?.$call?.('setGateway', gwKey); } catch (e) { /* noop */ }
        await K.waitFor(() => readGw() === gwKey, 3500, 60);
      }
      if (readable && readGw() !== gwKey) {
        consume(); K.beep('warn');
        ui.set(`⚠️ درگاه «${gwName}» ثبت نشد؛ خودتان انتخاب کنید.`, 'warn');
        ui.buttons([]);
        return;
      }
      K.log('درگاه سمت سرور ثبت شد: ' + readGw());

      const tries = K.clamp(Number(K.config.payRetries) || 3, 1, 5);
      for (let i = 1; i <= tries && !st.cancelled; i++) {
        st.tries = i;
        const pay = await K.waitFor(() => {
          const b = S.payButton();
          return b && !b.disabled && !b.classList.contains('disabled') ? b : null;
        }, 9000, 60);
        if (!pay) { K.log('دکمه‌ی تایید و پرداخت فعال نشد'); break; }
        consume();
        S.click(pay);
        K.log(`تایید و پرداخت کلیک شد (${i}/${tries})`);
        ui.set(`💳 درخواست ارسال شد (${K.fa(i)}/${K.fa(tries)}) — انتقال به درگاه بانک...`);
        const left = await K.waitFor(
          () => st.handedOff || K.store.get('navigating', false) || !S.paymentPage(),
          6000, 100
        );
        if (left) { st.handedOff = true; K.log('انتقال به درگاه انجام شد.'); return; }
        await K.sleep(900);
      }

      if (!st.cancelled && !st.handedOff) {
        consume(); K.beep('warn');
        ui.set('⚠️ به درگاه منتقل نشدم؛ «تایید و پرداخت» را خودتان بزنید.', 'warn');
        ui.buttons([['تلاش دوباره', () => lockRun(() => run(false)), 'ok']]);
      }
    }

    if (armed && mismatch) {
      ui.set('⚠️ سبد شامل آیتم‌های دیگری هم هست؛ برای جلوگیری از پرداخت اشتباه، دستی تایید کنید.', 'warn');
      ui.buttons([[gwKey ? `انتخاب «${gwName}» و پرداخت` : 'پرداخت', () => lockRun(() => run(false)), 'ok']]);
    } else if (armed && K.config.autoPay) {
      ui.set('⚡ پرداخت خودکار در حال اجراست...');
      lockRun(() => run(true));
    } else {
      ui.set(armed ? '🛒 سفارش ساخته شد؛ پرداخت خودکار خاموش است.' : 'برای انتخاب درگاه و پرداخت، دکمه‌ی زیر را بزنید.', armed ? 'ok' : '');
      ui.buttons([[gwKey ? `انتخاب «${gwName}» و پرداخت` : 'پرداخت', () => lockRun(() => run(false)), 'ok']]);
      if (armed) K.beep('tick');
    }

    return pageState;
  }

  K.paymentPage = paymentPage;
})(globalThis);
