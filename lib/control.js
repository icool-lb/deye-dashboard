// Remote control of Deye inverters through the OpenAPI "order" endpoints. Every command is validated,
// logged (who/what/before/after/order id/result) and its order status is followed until it finishes.
import { call, callGet, DeyeError } from "./deye.js";
import { rpc } from "./db.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bool = (v) => v === true || v === "true" || v === 1 || v === "1" || v === "on";
const int = (v, lo, hi, name) => { const x = Math.round(Number(v)); if (!Number.isFinite(x) || x < lo || x > hi) throw new DeyeError(`${name}: القيمة يجب أن تكون بين ${lo} و ${hi}`); return x; };
const oneOf = (v, set, name) => { if (!set.includes(v)) throw new DeyeError(`${name} غير صالح`); return v; };

// command -> [path, body builder, Arabic label]
export const COMMANDS = {
  workMode: ["/v1.0/order/sys/workMode/update", (sn, p) => ({ deviceSn: sn, workMode: oneOf(p.value, ["SELLING_FIRST", "ZERO_EXPORT_TO_LOAD", "ZERO_EXPORT_TO_CT"], "وضع العمل") }), "وضع العمل"],
  energyPattern: ["/v1.0/order/sys/energyPattern/update", (sn, p) => ({ deviceSn: sn, energyPattern: oneOf(p.value, ["BATTERY_FIRST", "LOAD_FIRST"], "أولوية الطاقة") }), "أولوية الطاقة"],
  solarSell: ["/v1.0/order/sys/solarSell/control", (sn, p) => ({ deviceSn: sn, enable: bool(p.value) }), "البيع للشبكة"],
  gridCharge: ["/v1.0/order/battery/modeControl", (sn, p) => ({ deviceSn: sn, chargeMode: "GRID_CHARGE", enable: bool(p.value) }), "الشحن من الشبكة"],
  genCharge: ["/v1.0/order/battery/modeControl", (sn, p) => ({ deviceSn: sn, chargeMode: "GEN_CHARGE", enable: bool(p.value) }), "الشحن من المولد"],
  maxCharge: ["/v1.0/order/battery/parameter/update", (sn, p) => ({ deviceSn: sn, paramterType: "MAX_CHARGE_CURRENT", value: int(p.value, 0, 300, "تيار الشحن") }), "تيار الشحن الأقصى (A)"],
  maxDischarge: ["/v1.0/order/battery/parameter/update", (sn, p) => ({ deviceSn: sn, paramterType: "MAX_DISCHARGE_CURRENT", value: int(p.value, 0, 300, "تيار التفريغ") }), "تيار التفريغ الأقصى (A)"],
  gridChargeAmp: ["/v1.0/order/battery/parameter/update", (sn, p) => ({ deviceSn: sn, paramterType: "GRID_CHARGE_AMPERE", value: int(p.value, 0, 200, "تيار الشحن من الشبكة") }), "تيار الشحن من الشبكة (A)"],
  battLow: ["/v1.0/order/battery/parameter/update", (sn, p) => ({ deviceSn: sn, paramterType: "BATT_LOW", value: int(p.value, 5, 90, "Batt Low") }), "Batt Low (%)"],
  maxSell: ["/v1.0/order/sys/power/update", (sn, p) => ({ deviceSn: sn, power: "MAX_SELL_POWER", value: int(p.value, 0, 100000, "قدرة البيع") }), "أقصى قدرة بيع (W)"],
  maxSolar: ["/v1.0/order/sys/power/update", (sn, p) => ({ deviceSn: sn, power: "MAX_SOLAR_POWER", value: int(p.value, 0, 100000, "قدرة الألواح") }), "أقصى قدرة ألواح (W)"],
  zeroExport: ["/v1.0/order/sys/power/update", (sn, p) => ({ deviceSn: sn, power: "ZERO_EXPORT_POWER", value: int(p.value, 0, 1000, "Zero export") }), "Zero Export Power (W)"],
  touSwitch: ["/v1.0/order/sys/tou/switch", (sn, p) => ({ deviceSn: sn, enable: bool(p.value), days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] }), "Time of Use"],
  touUpdate: ["/v1.0/order/sys/tou/update", (sn, p) => {
    const items = Array.isArray(p.value) ? p.value : JSON.parse(p.value || "[]");
    if (items.length !== 6) throw new DeyeError("جدول الوقت يجب أن يحتوي 6 فترات");
    let prev = -1;
    return { deviceSn: sn, timeUseSettingItems: items.map((x, i) => {
      if (!/^\d{2}:\d{2}$/.test(x.time) || Number(x.time.slice(3)) % 5) throw new DeyeError(`الفترة ${i + 1}: الوقت بصيغة HH:MM ومضاعفات 5 دقائق`);
      const m = Number(x.time.slice(0, 2)) * 60 + Number(x.time.slice(3)); if (m <= prev) throw new DeyeError("أوقات الجدول يجب أن تكون تصاعدية"); prev = m;
      return { time: x.time, power: int(x.power, 0, 100000, "القدرة"), soc: int(x.soc, 5, 100, "SOC"), voltage: Number(x.voltage) || 49, enableGridCharge: bool(x.enableGridCharge), enableGeneration: bool(x.enableGeneration) };
    }) };
  }, "جدول الوقت (TOU)"],
};

export async function orderStatus(orderId, waitMs = 30000) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < waitMs) {
    await sleep(3000);
    last = await callGet(`/v1.0/order/${orderId}`).catch(() => last);
    const st = Number(last?.status);
    if (st === 666 || (last?.error && last.error !== null) || [3, 4, 5, 777, 888, 999].includes(st)) break;
  }
  const st = Number(last?.status);
  return { status: st || null, done: st === 666, error: last?.error || null, raw: last ? { status: last.status, error: last.error, analysisResult: last.analysisResult } : null };
}

export async function sendCommand({ cmd, sns, value, stationId, before, user = "Ahmad" }) {
  const c = COMMANDS[cmd]; if (!c) throw new DeyeError("أمر غير معروف");
  if (!sns?.length) throw new DeyeError("لم يتم تحديد إنفرتر");
  const results = [];
  for (const sn of sns) {
    const body = c[1](sn, { value });
    let order = null, res = null, err = null;
    try { order = await call(c[0], body); res = order.orderId ? await orderStatus(order.orderId) : null; }
    catch (e) { err = e.message; }
    const row = { station_id: Number(stationId) || null, device_sn: sn, cmd, label: c[2], payload: body, before: before ?? null, order_id: order?.orderId ? String(order.orderId) : null, status: err ? "failed" : res?.done ? "done" : res?.status ? `status ${res.status}` : "sent", result: err ? { error: err } : res, by_user: user };
    await rpc("control_add", row).catch(() => {});
    results.push({ sn, ok: !err && (res?.done ?? true), status: row.status, error: err || res?.error || null, orderId: row.order_id });
  }
  return { label: c[2], results };
}
