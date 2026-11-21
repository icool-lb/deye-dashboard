// Live inverter settings (read from the inverter itself via strategy/dynamicControl/read) and a fleet audit.
import { call, callGet, stationDevices, devicesLatest, DeyeError } from "./deye.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));

const FRIENDLY = [[/2104005|not supported/i, "هذا الموديل لا يدعم قراءة الإعدادات عن بعد"], [/2104006|offline/i, "الإنفرتر غير متصل"], [/2101040|not found/i, "الجهاز غير موجود على الحساب"]];
export async function readSettings(sn, waitMs = 25000) {
  let r;
  try { r = await call("/v1.0/strategy/dynamicControl/read", { deviceSn: sn }); }
  catch (e) { const f = FRIENDLY.find(([re]) => re.test(e.message)); throw new DeyeError(f ? f[1] : e.message); }
  const orderId = r.orderId;
  if (!orderId) throw new DeyeError("لم يُرسل أمر القراءة");
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    await sleep(2500);
    const j = await call("/v1.0/strategy/dynamicControl/readResult", { orderId }).catch(() => null);
    if (j && j.workMode) { const { code, msg, success, requestId, ...data } = j; return data; }
  }
  throw new DeyeError("الإنفرتر لم يرد على أمر القراءة (قد يكون غير متصل)");
}

const LKEYS = ["RatedPower", "BatteryRatedCapacity", "BMSChargeCurrentLimit", "BMSDischargeCurrentLimit", "SOC", "BatteryVoltage", "DCPowerPV1"];
export async function stationSettings(id) {
  const devs = (await stationDevices(id)).filter((d) => /INVERTER/i.test(d.deviceType || ""));
  const latest = devs.length ? await devicesLatest(devs.map((d) => d.deviceSn)).catch(() => []) : [];
  const inverters = await Promise.all(devs.map(async (d) => {
    const l = latest.find((x) => x.deviceSn === d.deviceSn);
    const info = {}; for (const it of l?.dataList || []) if (LKEYS.includes(it.key)) info[it.key] = num(it.value);
    try { return { sn: d.deviceSn, online: d.connectStatus === 1 || d.connectStatus === "1" || d.connectStatus === undefined, info, settings: await readSettings(d.deviceSn) }; }
    catch (e) { return { sn: d.deviceSn, info, error: e.message }; }
  }));
  return { inverters, audit: auditStation(inverters), readAt: Date.now() };
}

const WM = { SELLING_FIRST: "بيع للشبكة أولاً", ZERO_EXPORT_TO_LOAD: "Zero Export للحمل", ZERO_EXPORT_TO_CT: "Zero Export مع CT" };
export const workModeName = (w) => WM[w] || w;
const minTouSoc = (s) => (s.touAction === "on" ? Math.min(...(s.timeUseSettingItems || []).map((x) => num(x.soc)).filter((v) => v !== null)) : null);

export function auditStation(inverters) {
  const F = [];
  const ok = inverters.filter((i) => i.settings);
  for (const inv of ok) {
    const s = inv.settings, tag = inverters.length > 1 ? `[${inv.sn}] ` : "";
    const cap = inv.info.BatteryRatedCapacity;
    const minSoc = minTouSoc(s);
    if (cap && s.maxChargeCurrent && s.maxChargeCurrent / cap > 0.55) F.push({ lvl: "warn", t: `${tag}تيار الشحن الأقصى ${s.maxChargeCurrent}A على بطارية ${cap}Ah (${(s.maxChargeCurrent / cap).toFixed(2)}C) — أعلى من 0.5C الموصى به لليثيوم.` });
    if (cap && s.maxDischargeCurrent && s.maxDischargeCurrent / cap > 0.8) F.push({ lvl: "warn", t: `${tag}تيار التفريغ الأقصى ${s.maxDischargeCurrent}A على بطارية ${cap}Ah — مرتفع بالنسبة لسعة البطارية.` });
    if (s.maxChargeCurrent !== undefined && Number(s.maxChargeCurrent) < 20) F.push({ lvl: "warn", t: `${tag}تيار الشحن الأقصى ${s.maxChargeCurrent}A فقط — منخفض جداً، البطارية لن تشحن كفاية من الألواح.` });
    if (s.gridChargeAction === "on" && cap && s.gridChargeAmpere / cap > 0.3) F.push({ lvl: "info", t: `${tag}الشحن من الشبكة/المولد بتيار ${s.gridChargeAmpere}A — مرتفع؛ قد يحمّل المولد أو الشبكة.` });
    if (s.touAction !== "on") F.push({ lvl: "info", t: `${tag}Time of Use مطفأ — لا يوجد احتياط مضبوط للبطارية حسب الوقت.` });
    if (minSoc !== null && minSoc < 15) F.push({ lvl: "warn", t: `${tag}أدنى SOC في جدول الوقت ${minSoc}% — تفريغ عميق يقصّر عمر البطارية.` });
    if (minSoc !== null && minSoc >= 80) F.push({ lvl: "info", t: `${tag}البطارية محجوزة عند ${minSoc}% في كل الأوقات — جزء كبير من سعتها لا يُستعمل يومياً (مقبول إذا كانت للاحتياط عند الانقطاع).` });
    if (s.workMode === "SELLING_FIRST") F.push({ lvl: "info", t: `${tag}وضع العمل "بيع للشبكة أولاً" — تأكد أن هناك عداد صافي (Net Metering)، وإلا الطاقة تُهدر للشبكة.` });
    if (inv.info.RatedPower && s.maxSolarPower && s.maxSolarPower < inv.info.RatedPower * 0.8) F.push({ lvl: "warn", t: `${tag}Max Solar Power مضبوط على ${s.maxSolarPower}W أقل من قدرة الإنفرتر (${inv.info.RatedPower}W) — قد يحدّ الإنتاج.` });
  }
  if (ok.length > 1) {
    const diff = (label, f) => { const vals = ok.map(f).map((v) => JSON.stringify(v)); if (new Set(vals).size > 1) F.push({ lvl: "bad", t: `الإنفرترات على التوازي إعداداتها مختلفة في: ${label} (${ok.map((i) => `${i.sn}: ${f(i)}`).join(" / ")})` }); };
    diff("وضع العمل", (i) => i.settings.workMode);
    diff("Time of Use", (i) => i.settings.touAction);
    diff("جدول SOC", (i) => (i.settings.timeUseSettingItems || []).map((x) => `${x.time}:${x.soc}`).join(","));
    diff("تيار الشحن الأقصى", (i) => i.settings.maxChargeCurrent);
    diff("تيار التفريغ الأقصى", (i) => i.settings.maxDischargeCurrent);
    diff("الشحن من الشبكة", (i) => `${i.settings.gridChargeAction}/${i.settings.gridChargeAmpere}A`);
    diff("سعة البطارية", (i) => i.info.BatteryRatedCapacity);
  }
  const off = inverters.filter((i) => i.error);
  if (off.length) F.push({ lvl: "info", t: `تعذرت قراءة الإعدادات من ${off.map((i) => i.sn).join("، ")}: ${off[0].error}` });
  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  return F.sort((a, b) => order[a.lvl] - order[b.lvl]);
}

export { callGet };
