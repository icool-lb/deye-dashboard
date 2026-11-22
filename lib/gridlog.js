// EDL/grid input log per system: when the grid came and went (5-minute inverter history), voltage and frequency
// range while present, and quality counters. One inverter per system (the grid is common to parallel units).
import { call, devicesLatest, stationDevices, addDays, round } from "./deye.js";
import { rpc } from "./db.js";

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const hmOf = (t) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t * 1000));
export const V_LOW = 200, V_HIGH = 245, F_LOW = 49.5, F_HIGH = 50.5, GAP = 20 * 60;

// grid voltage keys reported by this inverter model (single-phase "GridVoltageL1L2", three-phase "GridVoltageL1/2/3"...)
export function gridKeys(dataList) {
  const keys = (dataList || []).map((i) => i.key);
  const v = keys.filter((k) => /grid.?voltage/i.test(k) && !/load|gen/i.test(k)).slice(0, 3);
  const f = keys.find((k) => /^grid.?frequency/i.test(k));
  return v.length ? { v, f: f || null } : null;
}

export function analyzeDay(frames, k, date, dayEnd) {
  const pts = frames.map((fr) => {
    const vs = k.v.map((key) => n(fr[key])).filter((x) => x !== null);
    const vmax = vs.length ? Math.max(...vs) : null, fq = k.f ? n(fr[k.f]) : null;
    const on = (vmax !== null && vmax > 150) && (fq === null || fq > 40);
    return { t: fr.t, on, vs: vs.filter((x) => x > 150), f: fq };
  }).sort((a, b) => a.t - b.t);
  const out = { date, samples: pts.length, onMin: 0, offMin: 0, gapMin: 0, switches: 0, outages: 0, longestOffMin: 0, events: [] };
  if (!pts.length) return { ...out, noData: true };
  const add = (state, a, b) => {
    const min = Math.round((b - a) / 60); if (min <= 0) return;
    out[state === "on" ? "onMin" : state === "off" ? "offMin" : "gapMin"] += min;
    const last = out.events[out.events.length - 1];
    if (last && last.s === state) { last.to = hmOf(b); last.min += min; }
    else out.events.push({ s: state, from: hmOf(a), to: hmOf(b), min });
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], next = pts[i + 1], end = next ? next.t : Math.min(dayEnd, p.t + 300);
    if (next && next.t - p.t > GAP) { add(p.on ? "on" : "off", p.t, p.t + 300); add("gap", p.t + 300, next.t); }
    else add(p.on ? "on" : "off", p.t, end);
  }
  // transitions (gaps do not count as an outage)
  const real = out.events.filter((e) => e.s !== "gap");
  for (let i = 1; i < real.length; i++) if (real[i].s !== real[i - 1].s) { out.switches++; if (real[i].s === "off") out.outages++; }
  out.longestOffMin = Math.max(0, ...out.events.filter((e) => e.s === "off").map((e) => e.min));
  const V = pts.filter((p) => p.on).flatMap((p) => p.vs), F = pts.filter((p) => p.on && p.f !== null).map((p) => p.f);
  const on = pts.filter((p) => p.on);
  Object.assign(out, {
    phases: k.v.length,
    vmin: V.length ? round(Math.min(...V), 1) : null, vmax: V.length ? round(Math.max(...V), 1) : null, vavg: V.length ? round(V.reduce((a, b) => a + b, 0) / V.length, 1) : null,
    fmin: F.length ? round(Math.min(...F), 2) : null, fmax: F.length ? round(Math.max(...F), 2) : null,
    lowVMin: on.filter((p) => p.vs.some((v) => v < V_LOW)).length * 5, highVMin: on.filter((p) => p.vs.some((v) => v > V_HIGH)).length * 5,
    badFMin: on.filter((p) => p.f !== null && (p.f < F_LOW || p.f > F_HIGH)).length * 5,
  });
  return out;
}

export async function gridDay(sn, k, date) {
  const startTs = Date.parse(`${date}T00:00:00+02:00`) / 1000;
  const j = await call("/v1.0/device/history", { deviceSn: sn, granularity: 1, startAt: date, endAt: addDays(date, 1), measurePoints: [...k.v, ...(k.f ? [k.f] : [])] });
  const frames = (j.dataList || []).map((fr) => { const o = { t: n(fr.time) }; for (const it of fr.itemList || []) o[it.key] = it.value; return o; }).filter((o) => o.t);
  return analyzeDay(frames, k, date, Math.min(startTs + 86400, Date.now() / 1000));
}

// pick the inverter to read for a station and its grid keys (cached in settings by the caller)
export async function stationGridSource(id, cache) {
  if (cache[id]) return cache[id];
  const devs = (await stationDevices(id)).filter((d) => /INVERTER/i.test(d.deviceType || ""));
  if (!devs.length) return null;
  const lat = await devicesLatest(devs.map((d) => d.deviceSn));
  for (const d of lat) { const k = gridKeys(d.dataList); if (k) { cache[id] = { sn: d.deviceSn, k }; return cache[id]; } }
  return null;
}

// region name: station file > reverse geocoding of the map location (cached) > Deye address
export async function regionsFor(stations, files, locs) {
  const cache = (await rpc("get_setting", { k: "regions" }).catch(() => null)) || {};
  let fetched = 0;
  for (const s of stations) {
    const id = String(s.id);
    if (files?.[id]?.region || cache[id] !== undefined) continue;
    const o = locs?.[id], la = o ? o[0] : Number(s.locationLat), ln = o ? o[1] : Number(s.locationLng);
    if (!la || !ln || fetched >= 25) continue;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${la}&lon=${ln}&format=json&zoom=12&accept-language=ar`, { headers: { "user-agent": "iCOOL-Monitor/1.0" } });
      const a = (await r.json()).address || {};
      cache[id] = a.village || a.town || a.city || a.suburb || a.municipality || a.county || a.state_district || "";
      fetched++; await new Promise((res) => setTimeout(res, 1100));
    } catch (e) {}
  }
  if (fetched) await rpc("set_setting", { k: "regions", v: cache }).catch(() => {});
  const out = {};
  for (const s of stations) { const id = String(s.id); out[id] = files?.[id]?.region || cache[id] || (s.locationAddress || "").trim() || "غير محدد"; }
  return out;
}
