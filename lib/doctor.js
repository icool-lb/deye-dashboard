// Doctor Deye: a deep diagnosis of one system from everything available — 2 years of daily stats, the full Deye
// alarm history, 90 days of 5-minute frames, inverter data, settings and grid quality. It finds when each problem
// started, measures the real battery capacity over time and projects where things are heading.
import { call, frameRows, devicesLatest, stationDevices, addDays, today, round } from "./deye.js";
import { rpc } from "./db.js";
import { evaluateStation } from "./eval.js";
import { stationHealth } from "./health.js";
import { irradiance, stationLL } from "./weather.js";
import { auditStation } from "./settings.js";

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const med = (a) => { const s = a.filter((x) => x !== null && Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
async function pool(items, size, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; } } })); return out; }
function slope(pts) { // least squares, x in days
  if (pts.length < 3) return null; const mx = sum(pts.map((p) => p.x)) / pts.length, my = sum(pts.map((p) => p.y)) / pts.length;
  const d = sum(pts.map((p) => (p.x - mx) ** 2)); return d ? sum(pts.map((p) => (p.x - mx) * (p.y - my))) / d : null;
}
const dnum = (d) => Date.parse(d + "T00:00:00Z") / 864e5;
function groupDates(dates) { // consecutive dates -> ranges
  const out = []; for (const d of [...dates].sort()) { const l = out[out.length - 1]; if (l && dnum(d) - dnum(l.to) === 1) { l.to = d; l.days++; } else out.push({ from: d, to: d, days: 1 }); } return out;
}

// Deye fault codes -> meaning, usual cause and action (the most common ones on hybrid inverters)
const KB = {
  F13: ["تغيّر وضع العمل/الشبكة", "تبدّل وضع التشغيل أو تذبذب الشبكة", "عادةً لا يحتاج تدخل إذا لم يتكرر كثيراً"],
  F18: ["تيار متناوب زائد (AC over current)", "حمل أكبر من قدرة الإنفرتر أو قصر في الحمل", "افحص الأحمال الكبيرة عند وقت الإنذار وقلّل الحمل أو افحص التمديدات"],
  F20: ["تيار مستمر زائد (DC over current)", "تيار ألواح أو بطارية أعلى من المسموح", "افحص توصيل الألواح (عدد بالتوازي) وإعدادات تيار البطارية"],
  F22: ["إيقاف طوارئ (Tz)", "حماية داخلية بسبب تيار مفاجئ", "إذا تكرر: افحص الحمل والتأريض وراجع Deye"],
  F23: ["تسرّب تيار متناوب (Leakage)", "عزل ضعيف في الأحمال أو الكابلات أو تأريض", "افحص العزل والتأريض ومقاطع RCD"],
  F24: ["عزل DC منخفض (Insulation)", "رطوبة أو كابل ألواح متضرر أو كونكتور تالف", "افحص عزل كابلات الألواح والكونكتورات خاصة بعد المطر"],
  F26: ["عدم توازن الـ DC Bus", "حمل غير متوازن أو خلل داخلي", "راقب، وإذا تكرر راجع Deye"],
  F29: ["خطأ اتصال التوازي (CAN)", "كابل التوازي أو الإعدادات", "افحص كابلات التوازي والـ Master/Slave"],
  F34: ["حمل زائد على الخرج (Overload)", "الأحمال تتجاوز قدرة الإنفرتر", "وزّع الأحمال أو زِد القدرة"],
  F35: ["لا توجد شبكة AC", "انقطاع الدولة", "طبيعي عند انقطاع الكهرباء"],
  F41: ["توقف نظام التوازي", "أحد الإنفرترات على التوازي توقف أو فقد الاتصال", "افحص الإنفرترات وكابلات التوازي"],
  F42: ["جهد الشبكة منخفض", "فولت الدولة/المولد منخفض", "افحص فولت المصدر وحدود الجهد في الإعدادات"],
  F46: ["خطأ بطارية احتياطية", "البطارية أو اتصالها", "افحص البطارية والـ BMS والكابلات"],
  F47: ["تردد الشبكة مرتفع", "تردد المولد/الدولة خارج الحدود", "اضبط المولد أو حدود التردد"],
  F48: ["تردد الشبكة منخفض", "تردد المولد/الدولة منخفض", "اضبط سرعة المولد أو وسّع حدود التردد"],
  F51: ["حرارة البطارية مرتفعة", "مكان البطارية حار أو تيار شحن عالٍ", "حسّن التهوية وخفّض تيار الشحن"],
  F56: ["جهد الـ DC Bus منخفض", "البطارية فرغت أو جهد البطارية منخفض", "افحص البطارية ونسبة الفصل"],
  F58: ["خطأ اتصال الـ BMS", "كابل الاتصال مع البطارية أو بروتوكول غير مطابق", "افحص كابل BMS (CAN/RS485) والبروتوكول"],
  F63: ["قوس كهربائي (ARC)", "كونكتور أو كابل ألواح متضرر", "افحص الكونكتورات MC4 فوراً"],
  F64: ["حرارة المبرّد مرتفعة", "تهوية سيئة أو حمل عالٍ لفترة طويلة", "نظّف المراوح وحسّن التهوية"],
};
const kbFor = (name) => { const m = /F\s?0*(\d{1,3})/i.exec(name || ""); return m ? { code: `F${m[1]}`, kb: KB[`F${m[1]}`] || null } : { code: null, kb: null }; };

async function alertHistory(id, days) {
  const now = Math.floor(Date.now() / 1000), wins = [];
  for (let e = now; e > now - days * 86400; e -= 30 * 86400) wins.push([Math.max(e - 30 * 86400, now - days * 86400), e]);
  const res = await pool(wins, 4, async ([a, b]) => {
    const items = [];
    for (let page = 1; page <= 10; page++) {
      const j = await call("/v1.0/station/alertList", { stationId: Number(id), page, size: 100, startTimestamp: a, endTimestamp: b });
      const it = j.stationAlertItems || []; items.push(...it); if (it.length < 100) break;
    }
    return items;
  });
  const ts = (v) => (v ? Number(v) * (Number(v) > 1e11 ? 0.001 : 1) : null);
  const seen = new Set(), all = [];
  for (const a of res.flat().filter(Boolean)) { const k = `${a.alertId}|${a.alertStartTime}|${a.deviceSn}`; if (seen.has(k)) continue; seen.add(k); all.push({ name: a.alertName || "Alarm", sn: a.deviceSn, type: a.deviceType, start: ts(a.alertStartTime), end: ts(a.alertEndTime), level: a.level }); }
  return all.sort((x, y) => x.start - y.start);
}

// real battery capacity from 5-minute frames: energy moved between the day's SOC low and high points
function batteryCapacity(rows) {
  const byDay = {}; for (const r of rows) (byDay[r.date] = byDay[r.date] || []).push(r);
  const out = [];
  for (const [date, fr] of Object.entries(byDay)) {
    if (fr.length < 200) continue;
    let iMin = -1, iMax = -1;
    for (let i = 0; i < fr.length; i++) { if (fr[i].soc === null) continue; if (iMin < 0 || fr[i].soc < fr[iMin].soc) iMin = i; }
    if (iMin < 0) continue;
    for (let i = iMin; i < fr.length; i++) if (fr[i].soc !== null && (iMax < 0 || fr[i].soc > fr[iMax].soc)) iMax = i;
    if (iMax < 0) continue;
    const dSoc = fr[iMax].soc - fr[iMin].soc;
    if (dSoc < 30) continue;
    let e = 0, gaps = 0;
    for (let i = iMin + 1; i <= iMax; i++) { const dt = (fr[i].ts - fr[i - 1].ts) / 3600; if (dt > 1 / 3) { gaps++; continue; } const p = fr[i].bat; if (p !== null) e += Math.abs(p) * dt; }
    if (gaps > 2 || e <= 0) continue;
    out.push({ date, dSoc, kwh: round(e, 2), cap: round((e / dSoc) * 100 * 0.96, 1) }); // ~4% charge losses
  }
  return out;
}

export async function doctor(st, opts = {}) {
  const id = String(st.id), t0 = Date.now();
  const kwp = n(st.installedCapacity) || 0;
  const to = addDays(today(), -1), from2y = addDays(to, -729), from90 = addDays(to, -89);
  const [daily, alerts, frames, devs, file, settingsAll, grid, evalR, health, ll] = await Promise.all([
    rpc("daily", { station_id: Number(id), from: from2y, to }).catch(() => []),
    alertHistory(id, 730).catch(() => []),
    frameRows(id, from90, to).catch(() => []),
    stationDevices(id).catch(() => []),
    rpc("sfile_get", { station_id: Number(id) }).then((r) => r?.data || {}).catch(() => ({})),
    rpc("settings_all").catch(() => []),
    rpc("grid_range", { from: addDays(to, -13), to, station_id: Number(id) }).catch(() => []),
    evaluateStation(id, { days: 30 }).catch(() => null),
    stationHealth(st).catch(() => null),
    stationLL(st).catch(() => null),
  ]);
  const invs = devs.filter((d) => /INVERTER/i.test(d.deviceType || ""));
  const latest = invs.length ? await devicesLatest(invs.map((d) => d.deviceSn)).catch(() => []) : [];
  const L = latest.map((d) => { const m = {}; for (const it of d.dataList || []) m[it.key] = n(it.value); return { sn: d.deviceSn, m }; });
  const ratedKw = sum(L.map((x) => x.m.RatedPower || 0)) / 1000 || null;

  const D = []; // diagnoses
  const T = []; // timeline events
  const add = (lvl, area, title, detail, extra = {}) => D.push({ lvl, area, title, detail, ...extra });

  // ---- 1. data coverage / connectivity
  const have = new Set((daily || []).filter((r) => (r.frames ?? 0) >= 200).map((r) => r.date));
  const first = (daily || [])[0]?.date || from2y;
  const missing = []; for (let d = first; d <= to; d = addDays(d, 1)) if (!have.has(d)) missing.push(d);
  const outages = groupDates(missing).filter((g) => g.days >= 2);
  for (const g of outages.slice(-8)) T.push({ date: g.from, to: g.to, kind: "offline", t: `انقطاع اتصال/بيانات ${g.days} يوم` });
  const last90Missing = missing.filter((d) => d >= from90).length;
  if (last90Missing >= 10) add("warn", "الاتصال", "انقطاعات متكررة في الاتصال", `${last90Missing} يوم بدون بيانات كاملة في آخر 90 يوماً — افحص الـ WiFi/الداتالوغر والراوتر.`);

  // ---- 2. production: dead days and step drops (vs real irradiance)
  if (kwp && ll) {
    const irr = await irradiance(ll.lat, ll.lng, first, to).catch(() => ({}));
    const days = (daily || []).filter((r) => have.has(r.date) && irr[r.date]?.poa > 3).map((r) => ({ date: r.date, pr: Number(r.pv_kwh) / (kwp * irr[r.date].poa), free: Number(r.soc_max) < 98 || Number(r.export_kwh) > 0.5 }));
    const dead = groupDates(days.filter((d) => d.pr < 0.05).map((d) => d.date));
    for (const g of dead) T.push({ date: g.from, to: g.to, kind: "noprod", t: `لا إنتاج من الألواح رغم الشمس (${g.days} يوم)` });
    const recentDead = dead.filter((g) => g.to >= addDays(to, -30));
    if (recentDead.length) add("bad", "الإنتاج", "أيام بدون إنتاج رغم الشمس", `آخرها ${recentDead[recentDead.length - 1].from}${recentDead[recentDead.length - 1].days > 1 ? ` → ${recentDead[recentDead.length - 1].to}` : ""} — إنفرتر متوقف أو قاطع DC مفصول أو عطل ألواح.`, { since: recentDead[0].from });
    // step drop on unconstrained days: 21-day rolling median vs the 45 days before
    const free = days.filter((d) => d.free && d.pr >= 0.05);
    let drop = null;
    for (let i = 0; i < free.length; i++) {
      const d = free[i].date;
      const after = free.filter((x) => x.date >= d && x.date <= addDays(d, 20)).map((x) => x.pr);
      const before = free.filter((x) => x.date < d && x.date >= addDays(d, -45)).map((x) => x.pr);
      if (after.length < 8 || before.length < 10) continue;
      const r = med(after) / med(before);
      if (r < 0.75 && (!drop || r < drop.r)) drop = { date: d, r, before: med(before), after: med(after) };
    }
    if (drop) {
      const still = free.filter((x) => x.date >= addDays(to, -20)).map((x) => x.pr);
      const ongoing = still.length >= 5 && med(still) < drop.before * 0.8;
      T.push({ date: drop.date, kind: "drop", t: `هبوط مفاجئ في أداء الألواح ${Math.round((1 - drop.r) * 100)}%` });
      add(ongoing ? "bad" : "info", "الألواح", `هبوط مفاجئ في الأداء بدأ ${drop.date}`, `نسبة الأداء نزلت من ${Math.round(drop.before * 100)}% إلى ${Math.round(drop.after * 100)}%${ongoing ? " وما زالت منخفضة — احتمال String مفصول، لوح تالف، تظليل جديد، أو فيوز DC." : " ثم تحسّنت لاحقاً (تنظيف/مطر/إصلاح)."}`, { since: drop.date });
    }
  }

  // ---- 3. Deye alarm history
  const groups = {};
  for (const a of alerts) { const g = (groups[a.name] = groups[a.name] || { name: a.name, n: 0, first: a.start, last: a.start, mins: 0, recent: 0, sns: new Set() }); g.n++; g.last = a.start; g.sns.add(a.sn); if (a.end) g.mins += Math.max(0, (a.end - a.start) / 60); if (a.start > Date.now() / 1000 - 30 * 86400) g.recent++; }
  const alarmList = Object.values(groups).map((g) => { const k = kbFor(g.name); return { name: g.name, code: k.code, meaning: k.kb?.[0] || null, cause: k.kb?.[1] || null, action: k.kb?.[2] || null, count: g.n, recent30: g.recent, first: new Date(g.first * 1000).toISOString().slice(0, 10), last: new Date(g.last * 1000).toISOString().slice(0, 10), hours: round(g.mins / 60, 1), devices: [...g.sns].filter(Boolean) }; }).sort((a, b) => b.recent30 - a.recent30 || b.count - a.count);
  for (const a of alarmList) {
    if (a.code === "F35" || a.code === "F13") continue; // normal grid events in Lebanon
    T.push({ date: a.first, kind: "alarm", t: `أول ظهور ${a.name}${a.meaning ? " — " + a.meaning : ""}` });
    if (a.recent30 >= 3 || (a.count >= 10 && a.recent30 > 0)) add(a.recent30 >= 10 ? "bad" : "warn", "الإنذارات", `${a.name} يتكرر (${a.recent30} مرة آخر 30 يوماً، ${a.count} إجمالاً)`, `${a.meaning ? a.meaning + ". " : ""}${a.cause ? "السبب المعتاد: " + a.cause + ". " : ""}${a.action || "راجع سجل الإنذارات."}`, { since: a.first });
  }

  // ---- 4. battery: real capacity over time, deep discharges, full-charge calibration
  const caps = batteryCapacity(frames || []);
  const nominal = Number(file.batteryKwh) || (() => { const ah = Math.max(0, ...L.map((x) => x.m.BatteryRatedCapacity || 0)); const v = L.find((x) => x.m.BatteryVoltage)?.m.BatteryVoltage; return ah ? round((ah * (v > 100 ? v : 51.2)) / 1000, 1) : null; })();
  let battery = { nominalKwh: nominal, samples: caps.length };
  if (caps.length >= 5) {
    const capMed = med(caps.map((c) => c.cap));
    const first30 = med(caps.filter((c) => c.date < addDays(from90, 30)).map((c) => c.cap)), last30 = med(caps.filter((c) => c.date >= addDays(to, -29)).map((c) => c.cap));
    const sl = slope(caps.map((c) => ({ x: dnum(c.date), y: c.cap })));
    battery = { ...battery, measuredKwh: capMed, first30, last30, perYearPct: sl !== null && capMed ? round((sl * 365 / capMed) * 100, 1) : null, sohPct: nominal ? round((capMed / nominal) * 100, 0) : null, series: caps.map((c) => ({ d: c.date, c: c.cap })) };
    if (battery.sohPct !== null && battery.sohPct < 75 && !file.batteryKwh) add("info", "البطارية", `السعة المقاسة ${capMed} kWh أقل من المسجلة (${nominal} kWh)`, "إما أن البطارية فقدت جزءاً من سعتها أو أن السعة المضبوطة في الإنفرتر/ملف النظام غير صحيحة. أدخل السعة الحقيقية في ملف النظام للتأكد.");
    else if (battery.sohPct !== null && battery.sohPct < 80) add("warn", "البطارية", `صحة البطارية حوالي ${battery.sohPct}%`, `السعة الفعلية المقاسة ${capMed} kWh من ${nominal} kWh.`);
    if (battery.perYearPct !== null && battery.perYearPct < -8 && caps.length >= 20) add("warn", "البطارية", `سعة البطارية تتراجع بسرعة (${battery.perYearPct}% بالسنة)`, `من ${first30 ?? "—"} kWh قبل 3 أشهر إلى ${last30 ?? "—"} kWh الآن. افحص توازن الخلايا والحرارة وتيارات الشحن.`);
  }
  const deep = (daily || []).filter((r) => r.date >= addDays(to, -89) && Number(r.soc_min) <= 10).length;
  if (deep >= 8) add("warn", "البطارية", `تفريغ عميق متكرر (${deep} يوم آخر 90 يوماً تحت 10%)`, "التفريغ العميق المتكرر يقصّر عمر الليثيوم — ارفع نسبة الفصل أو خفّف الأحمال الليلية أو زِد السعة.");
  const lastFull = [...(daily || [])].reverse().find((r) => Number(r.soc_max) >= 99)?.date || null;
  battery.lastFull = lastFull;
  if (lastFull && dnum(to) - dnum(lastFull) >= 21) add("warn", "البطارية", `البطارية لم تصل 100% منذ ${lastFull}`, "الليثيوم يحتاج شحناً كاملاً دورياً لمعايرة الـ BMS وتوازن الخلايا — تأكد من الشحن من الشبكة/المولد أو تيار الشحن.");

  // ---- 5. inverter loading
  if (ratedKw) {
    const recent = (daily || []).filter((r) => r.date >= addDays(to, -89));
    const over = recent.filter((r) => Number(r.peak_kw) >= ratedKw).length, near = recent.filter((r) => Number(r.peak_kw) >= ratedKw * 0.9).length;
    const pk = (a) => med(a.map((r) => Number(r.peak_kw)));
    const yearAgo = (daily || []).filter((r) => r.date >= addDays(to, -454) && r.date <= addDays(to, -365));
    const growth = yearAgo.length >= 30 && recent.length >= 30 ? round((pk(recent) / pk(yearAgo) - 1) * 100, 0) : null;
    if (over >= 3) add("bad", "الحمل", `الذروة تجاوزت قدرة الإنفرتر ${over} يوم (آخر 90 يوماً)`, `قدرة الإنفرتر ${ratedKw} kW. خطر إنذار Overload (F34/F18) وارتفاع حرارة — وزّع الأحمال أو زِد القدرة.`);
    else if (near >= 10) add("warn", "الحمل", `الذروة قريبة من حد الإنفرتر ${near} يوم`, `أكثر من 90% من ${ratedKw} kW.`);
    if (growth !== null && growth >= 20) add("info", "الحمل", `الاستهلاك الأقصى زاد ${growth}% عن نفس الفترة من السنة الماضية`, "الزبون أضاف أحمالاً — راجع حجم النظام قبل الصيف/الشتاء.");
  }

  // ---- 6. grid quality (last 14 days)
  const g14 = (grid || []).map((r) => r.data);
  if (g14.length) {
    const vmax = Math.max(0, ...g14.map((x) => x.vmax || 0)), vmin = Math.min(999, ...g14.map((x) => x.vmin ?? 999)), fmin = Math.min(99, ...g14.map((x) => x.fmin ?? 99));
    if (vmax > 255) add("warn", "الشبكة", `فولت الدولة وصل ${vmax}V`, "جهد مرتفع يسبب فصل الإنفرتر وإجهاد الأجهزة — يُنصح بحماية جهد (AVR/Voltage protector).");
    if (vmin < 185) add("warn", "الشبكة", `فولت الدولة نزل إلى ${vmin}V`, "جهد منخفض جداً — قد يسبب F42 وفصل متكرر.");
    if (fmin < 47) add("info", "الشبكة", `التردد نزل إلى ${fmin}Hz`, "غالباً من المولد المركّب على مدخل الشبكة — اضبط سرعة المولد.");
  }

  // ---- 7. reuse the 30-day evaluation (strings, clipping, temperatures, BMS) and settings audit
  for (const f of (evalR?.findings || [])) if (f.lvl === "bad" || f.lvl === "warn") add(f.lvl, "تقييم آخر 30 يوم", f.t, "");
  const myInv = (settingsAll || []).filter((r) => String(r.station_id) === id).map((r) => ({ sn: r.sn, info: r.info || {}, settings: r.data, error: r.data ? null : r.error }));
  for (const f of auditStation(myInv)) if (f.lvl === "bad" || f.lvl === "warn") add(f.lvl, "الإعدادات", f.t, "");
  for (const f of (health?.findings || [])) if (f.lvl === "bad" || f.lvl === "warn") add(f.lvl, "صحة الألواح", f.t, "");
  for (const x of L) {
    const dt = x.m["DC Temperature"], at = x.m["AC Temperature"];
    if ((dt ?? 0) >= 80 || (at ?? 0) >= 80) add("bad", "الحرارة", `حرارة الإنفرتر ${Math.max(dt || 0, at || 0)}°C الآن`, "نظّف المراوح وحسّن التهوية.");
  }

  // ---- predictions
  const P = [];
  if (battery.perYearPct !== null && battery.measuredKwh && nominal && battery.perYearPct < 0) {
    const yrs = ((battery.measuredKwh / nominal) - 0.8) / (-battery.perYearPct / 100);
    if (yrs > 0 && yrs < 10) P.push(`البطارية تصل 80% من سعتها الاسمية خلال حوالي ${round(yrs, 1)} سنة على الوتيرة الحالية.`);
  }
  if (health?.degradationPct !== null && health?.degradationPct !== undefined && health.degradationPct < -2) P.push(`أداء الألواح ينخفض حوالي ${Math.abs(health.degradationPct)}% بالسنة.`);
  const rising = alarmList.filter((a) => a.recent30 >= 3 && a.code !== "F35" && a.code !== "F13");
  if (rising.length) P.push(`إنذارات نشطة قد تسبق عطلاً: ${rising.map((a) => a.code || a.name).join("، ")}.`);

  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  D.sort((a, b) => order[a.lvl] - order[b.lvl]);
  const seen = new Set(); const diag = D.filter((d) => { const k = d.title; if (seen.has(k)) return false; seen.add(k); return true; });
  const score = Math.max(0, 100 - 20 * diag.filter((d) => d.lvl === "bad").length - 8 * diag.filter((d) => d.lvl === "warn").length);
  return {
    station: { id, name: st.name, kwp, ratedKw }, generatedAt: new Date().toISOString(), ms: Date.now() - t0,
    coverage: { from: first, to, daysWithData: have.size, alarms: alerts.length, frames: (frames || []).length },
    score, verdict: score >= 85 ? "سليم" : score >= 60 ? "يحتاج متابعة" : "يحتاج زيارة صيانة",
    diagnoses: diag, timeline: T.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40), alarms: alarmList.slice(0, 25), battery, predictions: P,
  };
}
