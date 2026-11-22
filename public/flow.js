// iCOOL animated power-flow diagram + battery runtime card (shared by the owner app and the customer portal).
(function () {
  const C = { pv: "#F1471E", grid: "#0066A7", gen: "#6b5bd6", bat: "#1a9b5c", home: "#14222f", off: "#b8c3ce" };
  const fx = (v, d = 2) => (v === null || v === undefined || isNaN(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
  const ICON = {
    pv: '<path d="M-14 6 L-8 -8 L14 -8 L8 6 Z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M-11 -1 L11 -1 M-1 -8 L-4 6 M6 -8 L3 6" stroke="currentColor" stroke-width="1.6"/><path d="M-3 9 L3 9 M0 6 L0 12" stroke="currentColor" stroke-width="2"/>',
    grid: '<path d="M0 -15 L-9 15 M0 -15 L9 15 M-11 -6 L11 -6 M-13 3 L13 3 M-6 15 L6 3 M6 15 L-6 3" fill="none" stroke="currentColor" stroke-width="2"/>',
    gen: '<rect x="-14" y="-9" width="28" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M-2 -6 L-6 1 L-1 1 L-3 7 L4 -1 L-1 -1 L1 -6 Z" fill="currentColor"/><path d="M-10 9 L-10 13 M10 9 L10 13" stroke="currentColor" stroke-width="2"/>',
    home: '<path d="M-14 0 L0 -13 L14 0 M-10 -3 L-10 12 L10 12 L10 -3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><rect x="-3" y="3" width="6" height="9" fill="currentColor"/>',
  };
  const P = { pv: [72, 58], grid: [288, 58], gen: [306, 158], home: [288, 278], bat: [72, 278], inv: [180, 168] };

  function line(id, from, to, color, active, reverse, kw) {
    const [x1, y1] = P[from], [x2, y2] = P[to];
    const speed = active ? Math.max(0.6, 2.4 - Math.min(2, Math.abs(kw || 0) / 3)) : 0;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${active ? color : C.off}" stroke-opacity="${active ? 0.25 : 0.5}" stroke-width="6" stroke-linecap="round"/>` +
      (active ? `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 12" class="icf-dash${reverse ? " rev" : ""}" style="animation-duration:${speed}s"/>` : "");
  }
  function node(key, label, color, val, sub, on) {
    const [x, y] = P[key];
    return `<g transform="translate(${x},${y})" style="color:${on ? color : C.off}">
      <circle r="31" fill="#fff" stroke="currentColor" stroke-width="3"/>
      <g>${ICON[key] || ""}</g>
      <text y="48" text-anchor="middle" class="icf-l">${label}</text>
      <text y="66" text-anchor="middle" direction="ltr" class="icf-v" fill="${on ? color : "#8795a1"}">${val}</text>
      ${sub ? `<text y="82" text-anchor="middle" class="icf-s">${sub}</text>` : ""}</g>`;
  }
  function battery(soc, bat, on) {
    const [x, y] = P.bat, s = Math.max(0, Math.min(100, soc ?? 0)), col = s <= 20 ? "#c0392b" : s <= 40 ? "#e08a00" : C.bat;
    const h = Math.round(32 * s / 100);
    return `<g transform="translate(${x},${y})" style="color:${col}">
      <circle r="31" fill="#fff" stroke="currentColor" stroke-width="3"/>
      <rect x="-10" y="-17" width="20" height="34" rx="3" fill="none" stroke="currentColor" stroke-width="2.4"/>
      <rect x="-4" y="-21" width="8" height="4" rx="1" fill="currentColor"/>
      <rect x="-7" y="${15 - h}" width="14" height="${h}" rx="1.5" fill="currentColor" opacity=".85"/>
      <text y="48" text-anchor="middle" class="icf-l">البطارية ${soc ?? "—"}٪</text>
      <text y="66" text-anchor="middle" direction="ltr" class="icf-v" fill="${col}">${fx(Math.abs(bat || 0))} kW</text>
      <text y="82" text-anchor="middle" class="icf-s">${bat > 0.05 ? "تفرّغ" : bat < -0.05 ? "تشحن" : "ثابتة"}</text></g>`;
  }
  window.icoolFlow = function (el, f) {
    if (!f || !f.ok) { el.innerHTML = `<div class="muted">${(f && f.reason) || "لا توجد بيانات"}</div>`; return; }
    const pvOn = (f.pv || 0) > 0.05, genRun = f.genOn, gridIn = (f.grid || 0) > 0.05, gridOut = (f.grid || 0) < -0.05;
    const batOut = (f.bat || 0) > 0.05, batIn = (f.bat || 0) < -0.05;
    el.innerHTML = `<style>
      .icf svg{width:100%;max-width:420px;display:block;margin:auto;font-family:Cairo,system-ui,sans-serif}
      .icf-l{font-size:12px;fill:#5b6977;font-weight:700}.icf-v{font-size:15px;font-weight:800;direction:ltr;unicode-bidi:plaintext}.icf-s{font-size:10.5px;fill:#8795a1}
      .icf-dash{animation:icfm linear infinite}.icf-dash.rev{animation-direction:reverse}
      @keyframes icfm{to{stroke-dashoffset:-28}}
      .icf-badges{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:4px}
      .icf-badges span{font-size:12px;font-weight:700;border-radius:20px;padding:3px 10px}
    </style>
    <div class="icf"><svg viewBox="0 0 360 370" role="img" aria-label="مسار الطاقة">
      ${line("a", "pv", "inv", C.pv, pvOn, false, f.pv)}
      ${line("b", "grid", "inv", C.grid, gridIn || gridOut, gridOut, f.grid)}
      ${line("c", "gen", "inv", C.gen, genRun && (f.gen || 0) > 0.05, false, f.gen)}
      ${line("d", "bat", "inv", C.bat, batOut || batIn, batIn, f.bat)}
      ${line("e", "inv", "home", C.home, (f.load || 0) > 0.02, false, f.load)}
      ${node("pv", "الألواح", C.pv, fx(f.pv) + " kW", pvOn ? "" : "لا إنتاج", pvOn)}
      ${node("grid", "الدولة", C.grid, f.gridOn ? fx(Math.abs(f.grid || 0)) + " kW" : "مقطوعة", f.gridOn ? (gridOut ? "تصدير" : "موجودة") : "", f.gridOn)}
      ${node("gen", "المولد", C.gen, genRun ? fx(f.gen) + " kW" : "متوقف", "", genRun)}
      ${node("home", "البيت", C.home, fx(f.load) + " kW", "الاستهلاك", true)}
      ${battery(f.soc, f.bat, true)}
      <g transform="translate(${P.inv[0]},${P.inv[1]})">
        <rect x="-38" y="-30" width="76" height="60" rx="12" fill="#fff" stroke="#0066A7" stroke-width="3"/>
        <image href="logo.png" x="-30" y="-22" width="60" height="28" preserveAspectRatio="xMidYMid meet"/>
        <text y="22" text-anchor="middle" style="font-size:10.5px;font-weight:700;fill:#0066A7">الإنفرتر${f.inverters > 1 ? " ×" + f.inverters : ""}</text>
      </g>
    </svg>
    ${f.stale ? `<div style="text-align:center;color:#c0392b;font-size:12.5px;font-weight:700">⚠️ قيم قديمة — آخر قراءة ${new Date(f.ts * 1000).toLocaleString("en-GB", { hour12: false })}</div>` : ""}
    <div class="icf-badges">
      <span style="background:${f.gridOn ? "#e7f1f9" : "#fdecea"};color:${f.gridOn ? "#0066A7" : "#c0392b"}">⚡ الدولة ${f.gridOn ? "موجودة" : "مقطوعة"}</span>
      <span style="background:${f.genOn ? "#efedfb" : "#f2f4f7"};color:${f.genOn ? "#6b5bd6" : "#8795a1"}">🛠️ المولد ${f.genOn ? "يعمل" : "متوقف"}</span>
      ${f.battTemp !== null && f.battTemp !== undefined ? `<span style="background:#f2f4f7;color:#5b6977">🌡️ البطارية ${fx(f.battTemp, 0)}°C</span>` : ""}
    </div></div>`;
  };
  window.icoolRuntime = function (el, r, opts = {}) {
    if (!r) { el.innerHTML = ""; return; }
    if (!r.ok) { el.innerHTML = `<div class="muted" style="font-size:13px">${r.reason || ""}</div>`; return; }
    const box = (bg, col, html) => `<div style="background:${bg};border-radius:14px;padding:12px 14px;color:${col}">${html}</div>`;
    const foot = `<div style="font-size:11.5px;color:#5b6977;margin-top:6px">طاقة متاحة ${fx(r.usableKwh, 1)} kWh من ${fx(r.capKwh, 1)} kWh (حتى ${r.cutoff}%)${r.capSuspicious && opts.owner ? " · ⚠️ السعة مأخوذة من إعداد الإنفرتر (200Ah) وقد تكون خطأ — أدخل السعة الحقيقية في ملف النظام" : ""}</div>`;
    if (r.mode === "solar") { el.innerHTML = box("#fff6e5", "#9a5b00", `<b>☀️ الألواح تغطي الاستهلاك الآن</b><div style="font-size:13px">البطارية تُشحن (${r.soc}%).</div>`) + foot; return; }
    const pre = r.mode === "external" ? `<div style="font-size:12px;margin-bottom:4px">النظام الآن على ${r.gridOn ? "الدولة" : "المولد"} — هذا الحساب إذا انقطعت:</div>` : "";
    if (r.lasts) {
      el.innerHTML = box("#eaf7ef", "#14623b", `${pre}<b style="font-size:16px">✅ البطارية تكفي حتى الصباح</b><div style="font-size:13px;margin-top:4px">حتى تغطي الألواح الاستهلاك حوالي ${r.sunAt} (بعد ${fx(r.hoursToSun, 1)} ساعة) · يلزم ${fx(r.needKwh, 1)} kWh على الاستهلاك المعتاد ${fx(r.avgLoadKw)} kW.</div>`) + foot;
      return;
    }
    const pct = Math.min(100, Math.round((r.targetLoadKw / Math.max(r.avgLoadKw, r.currentLoadKw, 0.01)) * 100));
    el.innerHTML = box("#fdecea", "#8e2a1e", `${pre}<b style="font-size:16px">⚠️ البطارية تكفي حتى حوالي ${r.cutAt} فقط</b>
      <div style="font-size:13px;margin-top:4px">ستفصل عند ${r.cutoff}% بعد ${fx(r.hoursLeft, 1)} ساعة، والألواح تبدأ تغطي الاستهلاك حوالي ${r.sunAt}.</div>
      <div style="font-size:14px;margin-top:8px">ليصمد النظام حتى الصباح: خفّف الاستهلاك إلى <b>${fx(r.targetLoadKw)} kW</b> كمعدل (المعتاد ${fx(r.avgLoadKw)} kW · الآن ${fx(r.currentLoadKw)} kW)</div>
      <div style="height:10px;background:#f6c9c2;border-radius:6px;margin-top:8px;overflow:hidden"><div style="width:${pct}%;height:100%;background:#1a9b5c"></div></div>
      <div style="font-size:11.5px;margin-top:4px">أطفئ الأحمال الكبيرة: السخان، المكيفات، الغسالة، الفرن الكهربائي، المضخات.</div>`) + foot;
  };
})();
