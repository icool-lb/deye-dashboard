// System performance evaluation: yield vs. Lebanon expectations, PV capability (curtailment-aware),
// per-string comparison, clipping, inverter temperatures, battery usage, grid/generator dependence.
import { call, frameRows, dailyTotals, analyzeDays, stationDevices, devicesLatest, addDays, today, round } from "./deye.js";

// Typical fixed-tilt (≈25–30°, south) specific yield in Lebanon, kWh/kWp/day by month (estimate).
const EXPECTED_YIELD = [3.4, 4.1, 5.0, 5.8, 6.4, 6.8, 6.9, 6.7, 6.0, 5.0, 3.9, 3.2];
// Clear-day midday PV power as a fraction of kWp (irradiance × temperature × system losses), by month (estimate).
const PEAK_FACTOR = [0.62, 0.68, 0.74, 0.78, 0.78, 0.77, 0.76, 0.76, 0.75, 0.72, 0.65, 0.6];

const n = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const hourOf = (hm) => Number(hm.slice(0, 2)) + Number(hm.slice(3, 5)) / 60;

async function pool(tasks, size = 6) {
  const out = new Array(tasks.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (i < tasks.length) { const k = i++; try { out[k] = await tasks[k](); } catch (e) { out[k] = null; } }
  }));
  return out;
}

// station-level metrics from 5-minute frames (no device calls) — used for single station and fleet ranking
export function stationMetrics(rows, days, kwp) {
  const month = (d) => Number(d.slice(5, 7)) - 1;
  const valid = days.filter((d) => d.frames >= 200);
  const yields = valid.filter((d) => d.pvKwh !== null && kwp).map((d) => ({ d: d.date, y: d.pvKwh / kwp, exp: EXPECTED_YIELD[month(d.date)] }));
  const yieldAvg = yields.length ? yields.reduce((s, x) => s + x.y, 0) / yields.length : null;
  const expAvg = yields.length ? yields.reduce((s, x) => s + x.exp, 0) / yields.length : null;

  // daylight frames
  const day = rows.filter((r) => { const h = hourOf(r.hm); return h >= 9 && h <= 15 && r.pv !== null; });
  const mid = day.filter((r) => { const h = hourOf(r.hm); return h >= 10.5 && h <= 13.5; });
  // PV is "unconstrained" only while the battery is charging (SOC < 95%) or energy is exported; systems without a battery
  // that do not export (e.g. pumps) are load-limited, so their PV capability cannot be measured.
  const unconstrained = mid.filter((r) => (r.soc !== null && r.soc < 95) || (r.sell || 0) > 0.1);
  const capFrames = unconstrained.length >= 6 ? unconstrained : [];
  let best = null;
  for (const r of capFrames) if (!best || r.pv > best.pv) best = r;
  const expPeak = best && kwp ? kwp * PEAK_FACTOR[month(best.date)] : null;
  const capRatio = best && expPeak ? best.pv / expPeak : null;

  // curtailment: battery full, nothing exported, PV well below what the array could give
  const curtailed = day.filter((r) => r.soc !== null && r.soc >= 97 && (r.sell || 0) < 0.05 && kwp && r.pv < 0.5 * kwp * PEAK_FACTOR[month(r.date)]);
  const curtailPct = day.length ? pct(curtailed.length, day.length) : null;

  // battery & grid
  const socMins = valid.map((d) => d.socMin).filter((v) => v !== null);
  const deepDays = socMins.filter((v) => v <= 20).length;
  const fullNights = valid.filter((d) => d.socMin !== null && d.socMin >= 90).length;
  const load = valid.reduce((s, d) => s + (d.loadKwh || 0), 0);
  const imp = valid.reduce((s, d) => s + (d.importKwh || 0), 0);
  const pv = valid.reduce((s, d) => s + (d.pvKwh || 0), 0);
  const cover = load ? Math.max(0, Math.min(100, Math.round((1 - imp / load) * 100))) : null;
  const dataPct = days.length ? pct(days.reduce((s, d) => s + d.frames, 0), days.length * 288) : 0;

  return {
    days: valid.length, dataPct, kwp,
    yieldAvg: round(yieldAvg, 2), yieldExpected: round(expAvg, 2), yieldRatio: yieldAvg && expAvg ? round(yieldAvg / expAvg, 2) : null,
    bestPv: best ? { kw: round(best.pv, 2), date: best.date, at: best.hm, soc: best.soc } : null,
    expectedPeak: round(expPeak, 2), capRatio: round(capRatio, 2), capSamples: unconstrained.length,
    curtailPct, deepDays, fullNights, socMinMedian: median(socMins),
    pvKwh: round(pv, 1), loadKwh: round(load, 1), importKwh: round(imp, 1), coverPct: cover,
  };
}

function grade(v, good, ok) { if (v === null || v === undefined) return "na"; return v >= good ? "good" : v >= ok ? "warn" : "bad"; }

// ---------- per-inverter string analysis ----------
async function inverterAnalysis(inv, latest, from, to) {
  const keys = new Set((latest?.dataList || []).map((x) => x.key));
  const val = (k) => n((latest?.dataList || []).find((x) => x.key === k)?.value);
  const strings = [1, 2, 3, 4].filter((i) => keys.has(`DCPowerPV${i}`));
  const rated = val("RatedPower");
  const dates = []; for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const groups = [
    [...strings.map((i) => `DCPowerPV${i}`), "DC Temperature"],
    [...strings.map((i) => `DCVoltagePV${i}`), "AC Temperature"],
    strings.map((i) => `DCCurrentPV${i}`),
  ];
  const tasks = [];
  for (const d of dates) for (const g of groups) tasks.push(() => call("/v1.0/device/history", { deviceSn: inv.deviceSn, granularity: 1, startAt: d, endAt: addDays(d, 1), measurePoints: g }).then((j) => j.dataList || []));
  const res = (await pool(tasks, 6)).flat().filter(Boolean);
  // merge by timestamp
  const byTs = new Map();
  for (const fr of res) { const t = n(fr.time); if (t === null) continue; const o = byTs.get(t) || { t }; for (const it of fr.itemList || []) o[it.key] = n(it.value); byTs.set(t, o); }
  const frames = [...byTs.values()].sort((a, b) => a.t - b.t);
  const hm = (t) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t * 1000));
  const midFrames = frames.filter((f) => { const h = hourOf(hm(f.t)); return h >= 10.5 && h <= 13.5; });

  const st = strings.map((i) => {
    const P = midFrames.map((f) => f[`DCPowerPV${i}`]).filter((v) => v !== null && v !== undefined);
    const V = midFrames.map((f) => f[`DCVoltagePV${i}`]).filter((v) => v);
    const I = midFrames.map((f) => f[`DCCurrentPV${i}`]).filter((v) => v !== null && v !== undefined);
    const maxP = Math.max(0, ...frames.map((f) => f[`DCPowerPV${i}`] || 0));
    return { pv: i, maxW: maxP, medW: median(P), medV: median(V), medI: median(I), samples: P.length, latestV: val(`DCVoltagePV${i}`), latestI: val(`DCCurrentPV${i}`), latestW: val(`DCPowerPV${i}`) };
  });
  const active = st.filter((s) => s.maxW > 150);
  const findings = [];
  const bestW = Math.max(0, ...active.map((s) => s.medW || 0));
  const bestI = Math.max(0, ...active.map((s) => s.medI || 0));
  const vRef = median(active.map((s) => s.medV).filter(Boolean));
  for (const s of st) {
    if (s.maxW <= 150 && active.length && (s.latestV || 0) > 50) findings.push({ lvl: "bad", t: `PV${s.pv}: فيه جهد (${round(s.latestV, 0)}V) لكن ما في إنتاج طوال الفترة — فحص الفيوز/الـ MC4/القاطع DC لهذا الـ String.` });
    if (s.maxW <= 150 || !bestW) continue;
    const rI = bestI ? (s.medI || 0) / bestI : null, rW = (s.medW || 0) / bestW, rV = vRef && s.medV ? s.medV / vRef : null;
    s.ratioW = round(rW, 2); s.ratioI = round(rI, 2); s.ratioV = round(rV, 2);
    if (rV !== null && rV < 0.88) findings.push({ lvl: "warn", t: `PV${s.pv}: الجهد أقل بـ ${Math.round((1 - rV) * 100)}% من باقي الـ Strings — إذا عدد الألواح نفسه، فهذا يعني لوح أو أكثر مفصول/الـ bypass diode شغّال (لوح معطّل أو مظلّل).` });
    else if (rI !== null && rI < 0.8) findings.push({ lvl: "warn", t: `PV${s.pv}: التيار أقل بـ ${Math.round((1 - rI) * 100)}% من أفضل String والجهد طبيعي — غالباً تظليل أو غبار أو اتجاه/ميل مختلف، أو ألواح أضعف.` });
  }
  // clipping
  const tot = frames.map((f) => strings.reduce((s, i) => s + (f[`DCPowerPV${i}`] || 0), 0));
  const clipN = rated ? tot.filter((w) => w >= rated * 0.97).length : 0;
  const dayN = tot.filter((w) => w > 50).length;
  const clipPct = dayN ? pct(clipN, dayN) : null;
  if (clipPct !== null && clipPct >= 5) findings.push({ lvl: "warn", t: `الإنفرتر وصل لقدرته القصوى (${rated}W) في ${clipPct}% من وقت الإنتاج — الألواح أكبر من الإنفرتر وفي طاقة ضائعة (Clipping).` });
  // temperatures
  const dcT = Math.max(...frames.map((f) => f["DC Temperature"] ?? -999)), acT = Math.max(...frames.map((f) => f["AC Temperature"] ?? -999));
  const maxT = Math.max(dcT, acT);
  if (maxT > 80) findings.push({ lvl: "bad", t: `حرارة الإنفرتر وصلت ${round(maxT, 1)}°C — عالية جداً: تهوية الغرفة/المراوح/الغبار على المشتت.` });
  else if (maxT > 70) findings.push({ lvl: "warn", t: `حرارة الإنفرتر وصلت ${round(maxT, 1)}°C — مرتفعة، راقب التهوية.` });
  // battery (from latest)
  const batV = val("BatteryVoltage"), soc = val("SOC"), bmsT = val("BMSTemperature"), capAh = val("BatteryRatedCapacity");
  const tChg = val("TotalChargeEnergy"), tDis = val("TotalDischargeEnergy");
  const nomKwh = capAh ? (capAh * 51.2) / 1000 : null;
  const cycles = nomKwh && tDis ? Math.round(tDis / nomKwh) : null;
  const eff = tChg && tDis ? round((tDis / tChg) * 100, 0) : null;
  if (bmsT !== null && bmsT > -50 && bmsT > 45) findings.push({ lvl: "warn", t: `حرارة البطارية ${bmsT}°C — مرتفعة.` });
  if (val("BMSVoltage") === 0 && (val("BMSSOC") === 0) && soc !== null) findings.push({ lvl: "info", t: "لا يوجد اتصال BMS بين البطارية والإنفرتر (الشحن يعتمد على الجهد فقط) — مع بطاريات الليثيوم يُفضّل ربط كابل الـ BMS (CAN/RS485)." });
  return {
    sn: inv.deviceSn, rated, strings: st, clipPct, maxTemp: maxT > -999 ? round(maxT, 1) : null,
    battery: { voltage: batV, soc, capAh, nomKwh: round(nomKwh, 1), cycles, roundTrip: eff, bmsTemp: bmsT > -50 ? bmsT : null },
    totals: { pvLifetime: val("PVCumulativePowerGenerationActive"), genLifetime: val("TotalProductionGenerator"), purchased: val("CumulativeEnergyPurchased") },
    findings, frames: frames.length,
  };
}

export async function evaluateStation(id, opts = {}) {
  const list = await call("/v1.0/station/list", { page: 1, size: 200 }).catch(() => ({}));
  let st = (list.stationList || []).find((s) => String(s.id) === String(id));
  if (!st) { // more than 200 stations: page through
    for (let p = 2; p < 10 && !st; p++) { const j = await call("/v1.0/station/list", { page: p, size: 200 }); st = (j.stationList || []).find((s) => String(s.id) === String(id)); if ((j.stationList || []).length < 200) break; }
  }
  const kwp = n(st?.installedCapacity);
  const lastTs = n(st?.lastUpdateTime);
  const lastDay = lastTs ? new Date(lastTs * 1000).toISOString().slice(0, 10) : today();
  const to = opts.to || (lastDay < today() ? lastDay : today());
  const from = addDays(to, -((opts.days || 30) - 1));
  const [rows, totals, devices] = await Promise.all([frameRows(id, from, to), dailyTotals(id, from, to), stationDevices(id).catch(() => [])]);
  const days = analyzeDays(rows, totals).filter((d) => d.date >= from && d.date <= to && d.date < today());
  const m = stationMetrics(rows, days, kwp);

  const invs = devices.filter((d) => /INVERTER/i.test(d.deviceType || ""));
  const latest = invs.length ? await devicesLatest(invs.map((d) => d.deviceSn)).catch(() => []) : [];
  const sFrom = addDays(to, -4);
  const inverters = await Promise.all(invs.map((inv) => inverterAnalysis(inv, latest.find((l) => l.deviceSn === inv.deviceSn), sFrom, to).catch((e) => ({ sn: inv.deviceSn, error: e.message, findings: [] }))));

  // ---------- findings & scores ----------
  const F = [];
  const yieldG = m.yieldRatio === null ? "na" : (m.curtailPct >= 25 ? "limited" : grade(m.yieldRatio, 0.85, 0.65));
  if (!kwp) F.push({ lvl: "warn", t: "القدرة المركّبة (kWp) غير مسجّلة في Deye Cloud — لا يمكن تقييم الإنتاج بدقة. أدخلها في إعدادات المحطة." });
  if (m.dataPct < 70) F.push({ lvl: "warn", t: `البيانات ناقصة (${m.dataPct}% فقط من القراءات وصلت) — اتصال اللوغر غير مستقر.` });
  const kwpSuspect = m.capRatio !== null && (m.capRatio > 1.25 || m.capRatio < 0.15);
  if (kwpSuspect) F.push({ lvl: "warn", t: m.capRatio > 1.25 ? `الألواح أنتجت ${m.bestPv.kw} kW وهذا أكثر من المتوقع لـ ${kwp} kWp — القدرة المسجّلة في Deye أقل من الحقيقية على الأرجح؛ صحّحها حتى يكون التقييم دقيقاً.` : `القدرة المسجّلة ${kwp} kWp لا تتطابق مع الإنتاج (${m.bestPv.kw} kW) — على الأرجح خطأ في إدخال الـ kWp.` });
  if (m.capRatio !== null && !kwpSuspect) {
    if (m.capRatio < 0.7) F.push({ lvl: "bad", t: `أعلى قدرة وصلتها الألواح ${m.bestPv.kw} kW بينما المتوقع لـ ${kwp} kWp بهذا الشهر حوالي ${m.expectedPeak} kW (${Math.round(m.capRatio * 100)}%) — احتمال: ألواح متسخة، تظليل، String مفصول، أو kWp مسجّلة أكبر من الحقيقة.` });
    else if (m.capRatio < 0.85) F.push({ lvl: "warn", t: `أعلى قدرة للألواح ${m.bestPv.kw} kW = ${Math.round(m.capRatio * 100)}% من المتوقع (${m.expectedPeak} kW) — أقل بقليل من الطبيعي، يُنصح بتنظيف الألواح والتحقق من التظليل.` });
    else F.push({ lvl: "good", t: `الألواح وصلت ${m.bestPv.kw} kW = ${Math.round(m.capRatio * 100)}% من المتوقع — قدرة الألواح سليمة.` });
  } else if (m.capRatio === null && m.socMinMedian === null) F.push({ lvl: "info", t: "النظام بدون بطارية ولا يصدّر للشبكة، فالإنتاج محدود بالحمل (مثل المضخات) — لا يمكن قياس القدرة القصوى للألواح من البيانات." });
  else if (m.capRatio === null && m.curtailPct !== null && m.curtailPct > 50) F.push({ lvl: "info", t: "البطارية كانت ممتلئة معظم أوقات النهار، فلا يمكن قياس القدرة الحقيقية للألواح في هذه الفترة." });
  if (m.curtailPct !== null && m.curtailPct >= 25) F.push({ lvl: "info", t: `في ${m.curtailPct}% من ساعات النهار كانت البطارية ممتلئة والإنتاج محدود بالاستهلاك — طاقة شمسية ضائعة. يمكن الاستفادة منها بحمل إضافي نهاراً (سخان، مضخة، تكييف) أو تفعيل البيع للشبكة إن وُجد عدّاد.` });
  if (m.yieldRatio !== null && yieldG !== "limited") {
    if (m.yieldRatio < 0.65) F.push({ lvl: "bad", t: `الإنتاج اليومي ${m.yieldAvg} kWh/kWp مقابل ${m.yieldExpected} متوقع (${Math.round(m.yieldRatio * 100)}%).` });
    else if (m.yieldRatio < 0.85) F.push({ lvl: "warn", t: `الإنتاج اليومي ${m.yieldAvg} kWh/kWp مقابل ${m.yieldExpected} متوقع (${Math.round(m.yieldRatio * 100)}%).` });
  }
  if (m.deepDays >= 3) F.push({ lvl: "warn", t: `البطارية نزلت تحت 20% في ${m.deepDays} أيام من ${m.days} — السعة أقل من حاجة الليل، أو الاستهلاك الليلي مرتفع.` });
  if (m.days >= 7 && m.fullNights >= m.days * 0.8) F.push({ lvl: "info", t: "البطارية لا تنزل تحت 90% معظم الليالي — سعة البطارية أكبر من الحاجة أو قليلة الاستخدام." });
  if (m.coverPct !== null && m.coverPct < 60 && m.loadKwh > 0) F.push({ lvl: "warn", t: `الطاقة الشمسية تغطي ${m.coverPct}% فقط من الاستهلاك — الباقي من الشبكة/المولد (${m.importKwh} kWh).` });
  for (const inv of inverters) for (const f of inv.findings || []) F.push({ ...f, t: `[${inv.sn}] ${f.t}` });
  const caps = [...new Set(inverters.map((i) => i.battery?.capAh).filter(Boolean))];
  if (inverters.length > 1 && caps.length > 1) F.push({ lvl: "warn", t: `الإنفرترات على التوازي لكن سعة البطارية المضبوطة مختلفة (${caps.join(" / ")} Ah) — يجب توحيد إعدادات البطارية على كل الإنفرترات.` });

  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  F.sort((a, b) => order[a.lvl] - order[b.lvl]);
  const bad = F.filter((f) => f.lvl === "bad").length, warn = F.filter((f) => f.lvl === "warn").length;
  const score = Math.max(0, 100 - bad * 25 - warn * 10);
  return {
    station: { id, name: st?.name, kwp, address: st?.locationAddress, lastUpdate: lastTs }, from, to,
    score, verdict: bad ? "يحتاج تدخل" : warn ? "يحتاج فحص" : "ممتاز",
    metrics: m, inverters, findings: F,
    notes: "القيم المتوقعة تقديرية لظروف لبنان (ميل 25–30° جنوب). القياس يستبعد الأوقات التي كانت فيها البطارية ممتلئة لأن الإنتاج يكون محدوداً بالاستهلاك وليس بالألواح.",
  };
}

// fleet ranking (station-level metrics only, last N days)
export async function evaluateFleet(stations, daysN = 7) {
  const to = addDays(today(), -1), from = addDays(to, -(daysN - 1));
  const online = stations.filter((s) => (Date.now() / 1000 - n(s.lastUpdateTime)) < 86400 * 2);
  const res = await pool(online.map((s) => async () => {
    const rows = await frameRows(s.id, from, to);
    const days = analyzeDays(rows, []);
    const m = stationMetrics(rows, days, n(s.installedCapacity));
    return { id: s.id, name: s.name, address: s.locationAddress, kwp: n(s.installedCapacity), ...m };
  }), 6);
  return { from, to, items: res.filter(Boolean) };
}
