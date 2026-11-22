// Live power flow from the inverters themselves (PV, battery, grid/EDL, generator, load) and a battery-runtime
// estimate: will the battery last until the sun covers the load in the morning, and what load would make it last.
import { stationDevices, devicesLatest, frameRows, addDays, today, round, localParts } from "./deye.js";
import { rpc } from "./db.js";

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const kw = (w) => (w === null ? null : round(w / 1000, 2));
const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);

export async function liveFlow(id) {
  const devs = (await stationDevices(id)).filter((d) => /INVERTER/i.test(d.deviceType || ""));
  if (!devs.length) return { ok: false, reason: "لا يوجد إنفرتر في هذا النظام" };
  const lat = await devicesLatest(devs.map((d) => d.deviceSn));
  const inv = lat.map((d) => {
    const m = {}; for (const it of d.dataList || []) m[it.key] = it.value;
    const pvKeys = Object.keys(m).filter((k) => /^DCPowerPV\d+$/.test(k));
    const gridV = n(m.GridVoltageL1L2 ?? m.GridVoltageL1 ?? m["Grid Voltage L1"]), gridF = n(m.GridFrequency);
    const genV = n(m.GenVoltage ?? m.GenVoltageL1), genF = n(m.GeneratorFrequency);
    return {
      sn: d.deviceSn, ts: n(d.collectionTime),
      pv: pvKeys.length ? sum(pvKeys.map((k) => n(m[k]))) : n(m.TotalDCInputPower),
      load: n(m.TotalConsumptionPower ?? m.UPSLoadPower),
      grid: n(m.TotalGridPower), gen: n(m.TotalGenPower), bat: n(m.BatteryPower), soc: n(m.SOC ?? m.BMSSOC),
      battV: n(m.BatteryVoltage), capAh: n(m.BatteryRatedCapacity), battTemp: n(m["Temperature- Battery"] ?? m.BMSTemperature),
      gridOn: (gridF !== null && gridF > 40) && (gridV === null || gridV > 150),
      genOn: ((genF !== null && genF > 40) && (genV === null || genV > 150)) || (n(m.TotalGenPower) || 0) > 100,
      relay: m.GridRelayStatus || null, rated: n(m.RatedPower),
    };
  });
  const socs = inv.map((i) => i.soc).filter((v) => v !== null && v > 0);
  const f = {
    ok: true, inverters: inv.length,
    pv: kw(sum(inv.map((i) => i.pv))), load: kw(sum(inv.map((i) => i.load))),
    grid: kw(sum(inv.map((i) => i.grid))), gen: kw(sum(inv.map((i) => i.gen))), bat: kw(sum(inv.map((i) => i.bat))),
    soc: socs.length ? Math.round(sum(socs) / socs.length) : null,
    gridOn: inv.some((i) => i.gridOn), genOn: inv.some((i) => i.genOn),
    battV: inv.find((i) => i.battV)?.battV ?? null, capAh: Math.max(0, ...inv.map((i) => i.capAh || 0)) || null,
    battTemp: inv.map((i) => i.battTemp).filter((t) => t !== null && t > -50).sort((a, b) => b - a)[0] ?? null,
    ts: Math.max(0, ...inv.map((i) => i.ts || 0)) || null,
  };
  return f;
}

// typical consumption per hour of day (kW) and the hour the sun covers the load, from the last 7 days
const profCache = new Map();
export async function loadProfile(id) {
  const key = `${id}:${today()}`;
  if (profCache.has(key)) return profCache.get(key);
  const rows = await frameRows(id, addDays(today(), -7), addDays(today(), -1)).catch(() => []);
  const L = Array.from({ length: 24 }, () => []), P = Array.from({ length: 24 }, () => []);
  for (const r of rows) { const h = Number(r.hm.slice(0, 2)); if (r.load !== null) L[h].push(r.load); if (r.pv !== null) P[h].push(r.pv); }
  const avg = (a) => (a.length ? sum(a) / a.length : null);
  const load = L.map(avg), pv = P.map(avg);
  let sunCover = null;
  for (let h = 5; h <= 12; h++) if (pv[h] !== null && load[h] !== null && pv[h] >= load[h] * 0.9 && pv[h] > 0.2) { sunCover = h; break; }
  let sunset = null;
  for (let h = 20; h >= 13; h--) if (pv[h] !== null && load[h] !== null && pv[h] >= load[h] * 0.9 && pv[h] > 0.2) { sunset = h + 1; break; }
  const out = { load: load.map((v) => (v === null ? null : round(v, 2))), pv: pv.map((v) => (v === null ? null : round(v, 2))), sunCover: sunCover ?? 8, sunset: sunset ?? 16, days: new Set(rows.map((r) => r.date)).size };
  profCache.set(key, out);
  return out;
}

// battery capacity (kWh) and the SOC where the system shuts down
export function batteryParams(flow, file = {}) {
  let capKwh = Number(file.batteryKwh) || null, capSource = "file";
  if (!capKwh && flow.capAh) { const v = flow.battV > 100 ? flow.battV : 51.2; capKwh = round((flow.capAh * v) / 1000, 1); capSource = "inverter"; }
  const cutoff = Number(file.cutoffSoc) || 20;
  return { capKwh, capSource, cutoff, suspicious: capSource === "inverter" && flow.capAh === 200 };
}

export function estimateRuntime(flow, prof, bp, nowMs = Date.now()) {
  if (flow.soc === null || !bp.capKwh) return { ok: false, reason: "سعة البطارية غير معروفة — أدخلها في ملف النظام" };
  const { hm } = localParts(nowMs);
  const hNow = Number(hm.slice(0, 2)) + Number(hm.slice(3)) / 60;
  const usable = Math.max(0, ((flow.soc - bp.cutoff) / 100) * bp.capKwh * 0.95);
  const sunUp = hNow >= prof.sunCover && hNow < prof.sunset;
  const solarCovering = (flow.pv || 0) >= (flow.load || 0) * 0.9 && (flow.pv || 0) > 0.2;
  // hours until the sun covers the load again
  let until = prof.sunCover - hNow; if (until <= 0) until += 24;
  if (sunUp && solarCovering) return { ok: true, mode: "solar", soc: flow.soc, usableKwh: round(usable, 1), capKwh: bp.capKwh, cutoff: bp.cutoff, msg: "الألواح تغطي الاستهلاك الآن والبطارية تُشحن" };
  // hour-by-hour drain; the current load weighs in for the next two hours
  let left = usable, t = hNow, need = 0, cutAt = null;
  const cur = Math.max(0, flow.load || 0);
  while (t < hNow + until - 1e-9) {
    const step = Math.min(1 - (t % 1) || 1, hNow + until - t);
    const h = Math.floor(t) % 24;
    const typ = prof.load[h] ?? cur;
    const l = t - hNow < 2 ? 0.6 * cur + 0.4 * typ : typ;
    const e = l * step;
    need += e;
    if (cutAt === null && left - e <= 0) cutAt = t + (l > 0 ? left / l : 0);
    left -= e; t += step;
  }
  const fmt = (x) => { const m = Math.round(((x % 24) + 24) % 24 * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
  const avgNeed = need / until;
  const target = usable / until;
  const external = flow.gridOn || flow.genOn;
  return {
    ok: true, mode: external ? "external" : "battery", soc: flow.soc, capKwh: bp.capKwh, cutoff: bp.cutoff, usableKwh: round(usable, 1),
    hoursToSun: round(until, 1), sunAt: fmt(prof.sunCover), needKwh: round(need, 1), lasts: cutAt === null,
    cutAt: cutAt === null ? null : fmt(cutAt), hoursLeft: round(cutAt === null ? until : cutAt - hNow, 1),
    avgLoadKw: round(avgNeed, 2), targetLoadKw: round(target, 2), currentLoadKw: round(cur, 2),
    reduceKw: cutAt === null ? 0 : round(Math.max(0, avgNeed - target), 2),
    gridOn: flow.gridOn, genOn: flow.genOn, capSuspicious: bp.suspicious,
  };
}

export async function stationLive(id) {
  const [flow, prof, file] = await Promise.all([liveFlow(id), loadProfile(id), rpc("sfile_get", { station_id: Number(id) }).then((r) => r?.data || {}).catch(() => ({}))]);
  if (!flow.ok) return { flow };
  const bp = batteryParams(flow, file);
  if (flow.ts && Date.now() / 1000 - flow.ts > 40 * 60) { flow.stale = true; return { flow, runtime: { ok: false, reason: "النظام غير متصل الآن — لا يمكن حساب مدة البطارية" }, profile: { sunCover: prof.sunCover, sunset: prof.sunset } }; }
  return { flow, runtime: estimateRuntime(flow, prof, bp), profile: { sunCover: prof.sunCover, sunset: prof.sunset, load: prof.load } };
}
