// Monthly customer report (printable HTML → "Save as PDF" / share). /api/report?id=..&month=YYYY-MM&price=0.30&k=ACCESS_CODE
import { guard, call, frameRows, dailyTotals, analyzeDays, addDays, today } from "./_deye.js";
import { stationMetrics } from "./_eval.js";

const AR_MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
const f = (v, d = 1) => (v === null || v === undefined || isNaN(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export default async function handler(req, res) {
  if (req.query.k) req.headers["x-access-code"] = req.query.k;
  if (!guard(req, res)) return;
  try {
    const id = req.query.id;
    const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : addDays(today(), -1).slice(0, 7);
    const price = Number(req.query.price) || 0.3;
    const from = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let to = `${month}-${String(last).padStart(2, "0")}`;
    if (to >= today()) to = addDays(today(), -1);
    let st = null;
    for (let p = 1; p < 10 && !st; p++) { const j = await call("/v1.0/station/list", { page: p, size: 200 }); st = (j.stationList || []).find((s) => String(s.id) === String(id)); if ((j.stationList || []).length < 200) break; }
    const kwp = Number(st?.installedCapacity) || null;
    const [rows, totals] = await Promise.all([frameRows(id, from, to), dailyTotals(id, from, to)]);
    const days = analyzeDays(rows, totals).filter((d) => d.date >= from && d.date <= to);
    const m2 = stationMetrics(rows, days, kwp);
    const pv = days.reduce((s, d) => s + (d.pvKwh || 0), 0), load = days.reduce((s, d) => s + (d.loadKwh || 0), 0), imp = days.reduce((s, d) => s + (d.importKwh || 0), 0);
    const solarUsed = Math.max(0, load - imp);
    const cover = load ? Math.round((solarUsed / load) * 100) : null;
    const peak = days.filter((d) => d.peakLoad).reduce((b, d) => (!b || d.peakLoad.kw > b.peakLoad.kw ? d : b), null);
    const socMin = Math.min(...days.map((d) => d.socMin ?? 101));
    const maxV = Math.max(1, ...days.map((d) => Math.max(d.pvKwh || 0, d.loadKwh || 0)));
    const W = 680, H = 170, bw = W / Math.max(days.length, 1);
    const bars = days.map((d, i) => {
      const hp = ((d.pvKwh || 0) / maxV) * (H - 20), hl = ((d.loadKwh || 0) / maxV) * (H - 20);
      return `<rect x="${i * bw + 2}" y="${H - hp}" width="${bw / 2 - 2}" height="${hp}" fill="#F5B301"/><rect x="${i * bw + bw / 2}" y="${H - hl}" width="${bw / 2 - 2}" height="${hl}" fill="#0066A7"/>` +
        (i % 3 === 0 ? `<text x="${i * bw + bw / 2}" y="${H + 12}" font-size="9" text-anchor="middle" fill="#5b6977">${d.date.slice(8)}</text>` : "");
    }).join("");
    const tips = [];
    if (m2.capRatio !== null && m2.capRatio < 0.8) tips.push("أداء الألواح أقل من المتوقع — يُنصح بتنظيف الألواح وفحص التظليل.");
    if (m2.curtailPct !== null && m2.curtailPct >= 25) tips.push("البطارية تمتلئ باكراً وجزء من الطاقة الشمسية لا يُستفاد منه — شغّل الأحمال الكبيرة (سخان، غسالة، مضخة) بين 10 صباحاً و3 بعد الظهر.");
    if (m2.deepDays >= 3) tips.push(`البطارية نزلت تحت 20% في ${m2.deepDays} أيام — خفّف الاستهلاك الليلي أو فكّر بزيادة سعة البطارية.`);
    if (cover !== null && cover < 60) tips.push("نسبة كبيرة من الاستهلاك من الشبكة/المولد — يمكن دراسة زيادة عدد الألواح.");
    if (!tips.length) tips.push("النظام يعمل بشكل جيد هذا الشهر. ✓");
    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>تقرير ${esc(st?.name || id)} — ${AR_MONTHS[m - 1]} ${y}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800&display=swap" rel="stylesheet">
<style>@page{size:A4;margin:12mm}body{font-family:Cairo,sans-serif;color:#14222f;max-width:760px;margin:0 auto;padding:12px}
.hd{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #0066A7;padding-bottom:6px}.hd img{height:58px}
.co{direction:ltr;text-align:left;font-size:12px;line-height:1.35}.co b{color:#0066A7;font-size:15px}.co .t{color:#F1471E;font-weight:800;letter-spacing:1.5px}
h1{color:#0066A7;font-size:22px;margin:12px 0 0}.sub{color:#5b6977;font-size:13px}
.k{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.k div{border:1px solid #d6dee7;background:#f6f9fc;border-radius:10px;padding:8px 10px}
.k .l{font-size:12px;color:#5b6977}.k .v{font-size:22px;font-weight:800;direction:ltr;text-align:right}.k .v small{font-size:12px;color:#5b6977}.k .hl{border-color:#F1471E;background:#fff5f2}.k .hl .v{color:#F1471E}
h2{color:#0066A7;font-size:16px;border-right:4px solid #F1471E;padding-right:8px;margin:16px 0 6px}ul{margin:0;padding-right:20px}li{margin:4px 0}
.lg span{display:inline-block;width:10px;height:10px;margin:0 4px}.ft{border-top:1px solid #d6dee7;margin-top:18px;padding-top:6px;font-size:11px;color:#5b6977;display:flex;justify-content:space-between;direction:ltr}
.pr{position:fixed;bottom:12px;left:12px;background:#0066A7;color:#fff;border:0;border-radius:10px;padding:10px 16px;font-family:inherit;font-weight:700}@media print{.pr{display:none}}</style></head><body>
<div class="hd"><img src="/logo-full.png"><div class="co"><b>iCOOL Trading &amp; Contracting</b><br><span class="t">HVAC • SOLAR • MEP</span><br>ELECTROMECHANICAL SERVICES<br>Tel/WhatsApp: +961 3 715 512</div></div>
<h1>التقرير الشهري لنظام الطاقة الشمسية</h1>
<div class="sub">${esc(st?.name || id)} · ${esc(st?.locationAddress || "")} · ${kwp ? kwp + " kWp" : ""} · <b>${AR_MONTHS[m - 1]} ${y}</b> (${days.length} يوم)</div>
<div class="k">
<div class="hl"><div class="l">الإنتاج الشمسي</div><div class="v">${f(pv, 0)} <small>kWh</small></div></div>
<div><div class="l">الاستهلاك الكلي</div><div class="v">${f(load, 0)} <small>kWh</small></div></div>
<div><div class="l">تغطية الطاقة الشمسية</div><div class="v">${f(cover, 0)} <small>%</small></div></div>
<div class="hl"><div class="l">التوفير التقديري</div><div class="v">$${f(solarUsed * price, 0)}</div><div class="l">على أساس $${price}/kWh</div></div>
<div><div class="l">من الشبكة / المولد</div><div class="v">${f(imp, 0)} <small>kWh</small></div></div>
<div><div class="l">أعلى ذروة استهلاك</div><div class="v">${f(peak?.peakLoad.kw, 2)} <small>kW</small></div><div class="l" dir="ltr" style="text-align:right">${peak ? peak.date.slice(8) + "/" + peak.date.slice(5, 7) + " · " + peak.peakLoad.at : ""}</div></div>
<div><div class="l">متوسط الإنتاج اليومي</div><div class="v">${f(kwp && days.length ? pv / days.length / kwp : null, 2)} <small>kWh/kWp</small></div><div class="l">المتوقع ≈ ${f(m2.yieldExpected, 1)}</div></div>
<div><div class="l">أدنى شحن للبطارية</div><div class="v">${socMin <= 100 ? socMin : "—"} <small>%</small></div></div>
<div><div class="l">أداء الألواح</div><div class="v">${m2.capRatio ? Math.round(m2.capRatio * 100) : "—"} <small>%</small></div><div class="l">من القدرة المتوقعة</div></div>
</div>
<h2>الإنتاج والاستهلاك اليومي</h2>
<div class="lg" style="font-size:12px"><span style="background:#F5B301"></span>إنتاج شمسي <span style="background:#0066A7"></span>استهلاك (kWh)</div>
<svg viewBox="0 0 ${W} ${H + 16}" width="100%" style="direction:ltr">${bars}</svg>
<h2>ملاحظات وتوصيات</h2><ul>${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
<div class="ft"><span>iCOOL Trading &amp; Contracting — COOL YOUR LIFE</span><span>Eng. Ahmad Mohammad Nasser · OEA 36359</span></div>
<button class="pr" onclick="print()">حفظ PDF / طباعة</button></body></html>`;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.status(200).send(html);
  } catch (e) { res.status(502).send("خطأ: " + e.message); }
}
