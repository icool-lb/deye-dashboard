// Panel health from stored daily stats + real irradiance: performance ratio (PR), soiling, rain-cleaning effect,
// year-over-year degradation, and tomorrow's production forecast.
import { rpc } from "./db.js";
import { addDays, today, round } from "./deye.js";
import { irradiance, stationLL, forecastKwh, PR_REF } from "./weather.js";

const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
// upper-percentile PR: battery-full / load-limited days only pull PR down, so the top of the distribution shows what the panels can do
const prTop = (days) => { const v = days.map((d) => d.pr); return v.length >= 5 ? q(v, 0.9) : null; };

export async function stationHealth(st, opts = {}) {
  const kwp = Number(st.installedCapacity ?? st.kwp) || 0;
  const to = opts.to || addDays(today(), -1), from = addDays(to, -729);
  const [rows, ll] = await Promise.all([rpc("daily", { station_id: Number(st.id), from, to }), stationLL(st)]);
  const stats = (rows || []).filter((r) => r.pv_kwh !== null && (r.frames ?? 288) >= 200);
  if (!kwp) return { ok: false, reason: "kWp غير مسجلة", ll };
  if (stats.length < 10) return { ok: false, reason: "لا توجد بيانات كافية في قاعدة البيانات بعد", ll, days: stats.length };
  const first = stats[0].date, last = stats[stats.length - 1].date;
  const irr = await irradiance(ll.lat, ll.lng, first, last);
  const days = stats.map((r) => ({ date: r.date, pv: Number(r.pv_kwh), poa: irr[r.date]?.poa, rain: irr[r.date]?.precip || 0, socMax: r.soc_max, exp: r.export_kwh }))
    .filter((d) => d.poa > 1.5).map((d) => ({ ...d, pr: d.pv / (kwp * d.poa) })).filter((d) => d.pr > 0.05 && d.pr < 1.3);
  if (days.length < 10) return { ok: false, reason: "بيانات الإشعاع غير متوفرة", ll };
  const lastD = days[days.length - 1].date;
  const win = (a, b) => days.filter((d) => d.date >= a && d.date <= b);

  const prNow = prTop(win(addDays(lastD, -29), lastD));
  // best 30-day window in the last 6 months (after rain / cleaning)
  let prBest = null, bestAt = null;
  for (let e = addDays(lastD, -180); e <= lastD; e = addDays(e, 7)) { const p = prTop(win(addDays(e, -29), e)); if (p !== null && (prBest === null || p > prBest)) { prBest = p; bestAt = e; } }
  const soiling = prNow && prBest ? Math.max(0, 1 - prNow / prBest) : null;

  // rain cleaning effect (rain ≥ 5 mm): PR after vs before
  const rains = [];
  for (const d of days.filter((x) => x.rain >= 5 && x.date >= addDays(lastD, -365))) {
    if (rains.length && d.date <= addDays(rains[rains.length - 1].date, 10)) continue;
    const b = prTop(win(addDays(d.date, -10), addDays(d.date, -1))), a = prTop(win(addDays(d.date, 1), addDays(d.date, 10)));
    if (b && a) rains.push({ date: d.date, mm: round(d.rain, 1), gain: round((a / b - 1) * 100, 1) });
  }
  const lastRain = days.filter((x) => x.rain >= 5).map((x) => x.date).pop() || null;

  // year over year (same calendar window, last 12 months vs the 12 before)
  const y1 = win(addDays(lastD, -364), lastD), y0 = win(addDays(lastD, -729), addDays(lastD, -365));
  const pr1 = y1.length >= 120 ? prTop(y1) : null, pr0 = y0.length >= 120 ? prTop(y0) : null;
  const degr = pr1 && pr0 ? round((pr1 / pr0 - 1) * 100, 1) : null;

  // monthly series
  const months = {};
  for (const d of days) { const m = d.date.slice(0, 7); (months[m] = months[m] || []).push(d); }
  const monthly = Object.entries(months).map(([m, ds]) => ({ m, pr: round(prTop(ds), 3), kwh: round(ds.reduce((s, x) => s + x.pv, 0), 0), poa: round(ds.reduce((s, x) => s + x.poa, 0), 0), days: ds.length }));

  const last30 = win(addDays(lastD, -29), lastD);
  const kwh30 = last30.reduce((s, x) => s + x.pv, 0);
  const lossKwhMonth = soiling ? round((kwh30 * soiling) / (1 - soiling), 0) : 0;
  let forecast = [];
  try { forecast = await forecastKwh(ll.lat, ll.lng, kwp, prNow || PR_REF); } catch (e) {}

  const findings = [];
  if (prNow !== null) {
    if (prNow < 0.6) findings.push({ lvl: "bad", t: `نسبة الأداء (PR) ${Math.round(prNow * 100)}% فقط مقارنة بالإشعاع الفعلي — الطبيعي 75–85%. تحقق من الألواح والـ Strings وقيمة kWp.` });
    else if (prNow < 0.72) findings.push({ lvl: "warn", t: `نسبة الأداء (PR) ${Math.round(prNow * 100)}% — أقل من الطبيعي (75–85%).` });
    else findings.push({ lvl: "good", t: `نسبة الأداء (PR) ${Math.round(prNow * 100)}% مقارنة بالإشعاع الفعلي — طبيعية.` });
  }
  if (soiling !== null && soiling >= 0.06) findings.push({ lvl: soiling >= 0.12 ? "bad" : "warn", t: `الإنتاج أقل بـ ${Math.round(soiling * 100)}% من أفضل فترة له في آخر 6 أشهر (${bestAt}) — على الأرجح غبار/اتساخ. التنظيف يرجّع حوالي ${lossKwhMonth} kWh بالشهر.` });
  const bigRain = rains.filter((r) => r.gain >= 5);
  if (bigRain.length) findings.push({ lvl: "info", t: `بعد المطر ارتفع الأداء بوضوح (${bigRain.map((r) => `${r.date}: +${r.gain}%`).join("، ")}) — الألواح تتسخ بسرعة، يُنصح بتنظيف دوري.` });
  if (degr !== null) {
    if (degr <= -4) findings.push({ lvl: "warn", t: `الأداء نزل ${Math.abs(degr)}% عن السنة الماضية — أكثر من التراجع الطبيعي للألواح (0.5–1% بالسنة). احتمال: تظليل جديد، ألواح تالفة، أو اتساخ دائم.` });
    else findings.push({ lvl: "good", t: `التراجع السنوي ${degr}% — ضمن الطبيعي.` });
  }
  if (ll.approx) findings.push({ lvl: "info", t: "موقع النظام غير محدد — الإشعاع محسوب لوسط لبنان تقريباً. حدّد الموقع من الخريطة لدقة أعلى." });
  return {
    ok: true, ll, kwp, from: days[0].date, to: lastD, days: days.length,
    prNow: round(prNow, 3), prBest: round(prBest, 3), bestAt, soilingPct: soiling === null ? null : round(soiling * 100, 1), lossKwhMonth,
    rains: rains.slice(-6), lastRain, pr1: round(pr1, 3), pr0: round(pr0, 3), degradationPct: degr, monthly, forecast, findings,
  };
}

// expected kWh per day for a window (used by the evaluation instead of the fixed monthly table)
export async function expectedDaily(st, from, to) {
  const kwp = Number(st.installedCapacity) || 0; if (!kwp) return null;
  const ll = await stationLL(st);
  const irr = await irradiance(ll.lat, ll.lng, from, to);
  const out = {}; for (const [d, v] of Object.entries(irr)) out[d] = { poa: v.poa, yieldExp: round(v.poa * PR_REF, 2) };
  return { ll, days: out };
}
