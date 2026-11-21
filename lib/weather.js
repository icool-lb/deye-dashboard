// Plane-of-array irradiance (kWh/m²/day, 25° tilt facing south) and rain per day from Open-Meteo,
// cached per 0.1° grid cell in the DB. Used for expected yield, performance ratio, soiling and forecasts.
import { rpc } from "./db.js";
import { addDays, today } from "./deye.js";

export const TILT = 25, AZIMUTH = 0, PR_REF = 0.8;
const LEB = [33.6, 35.6]; // fallback when a system has no location

export async function stationLL(st) {
  const locs = (await rpc("get_setting", { k: "locations" }).catch(() => null)) || {};
  const o = locs[String(st.id)];
  if (o) return { lat: o[0], lng: o[1], approx: false };
  const la = Number(st.locationLat), ln = Number(st.locationLng);
  if (la && ln) return { lat: la, lng: ln, approx: false };
  return { lat: LEB[0], lng: LEB[1], approx: true };
}
export const cellOf = (lat, lng) => `${(Math.round(lat * 10) / 10).toFixed(1)},${(Math.round(lng * 10) / 10).toFixed(1)}`;

function daily(j) {
  const out = {};
  const h = j.hourly || {};
  (h.time || []).forEach((t, i) => { const d = t.slice(0, 10); const v = Number(h.global_tilted_irradiance?.[i]) || 0; out[d] = out[d] || { poa: 0, precip: 0 }; out[d].poa += v / 1000; });
  const dd = j.daily || {};
  (dd.time || []).forEach((d, i) => { out[d] = out[d] || { poa: 0, precip: 0 }; out[d].precip = Number(dd.precipitation_sum?.[i]) || 0; });
  for (const d of Object.keys(out)) out[d].poa = Math.round(out[d].poa * 100) / 100;
  return out;
}
const Q = `hourly=global_tilted_irradiance&tilt=${TILT}&azimuth=${AZIMUTH}&daily=precipitation_sum&timezone=Asia%2FBeirut`;
async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  return r.json();
}
async function fetchArchive(lat, lng, from, to) {
  return daily(await fetchJson(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${from}&end_date=${to}&${Q}`));
}
// recent days + forecast (archive lags ~5 days)
export async function fetchForecast(lat, lng, pastDays = 7, days = 3) {
  return daily(await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&past_days=${pastDays}&forecast_days=${days}&${Q}`));
}

// irradiance map date -> {poa, precip} for [from, to] (past days only), cached in DB
export async function irradiance(lat, lng, from, to) {
  const cell = cellOf(lat, lng), [cl, cg] = cell.split(",").map(Number);
  const have = {};
  for (const r of (await rpc("irr_get", { cell, from, to }).catch(() => [])) || []) have[r.date] = { poa: r.poa, precip: r.precip };
  const lastPast = addDays(today(), -1);
  const want = []; for (let d = from; d <= to && d <= lastPast; d = addDays(d, 1)) if (!have[d]) want.push(d);
  if (want.length) {
    const fresh = {};
    const recentCut = addDays(today(), -6);
    const old = want.filter((d) => d < recentCut), recent = want.filter((d) => d >= recentCut);
    if (old.length) Object.assign(fresh, await fetchArchive(cl, cg, old[0], old[old.length - 1]));
    if (recent.length) { const f = await fetchForecast(cl, cg, 7, 1); for (const d of recent) if (f[d]) fresh[d] = f[d]; }
    const rows = Object.entries(fresh).filter(([d, v]) => want.includes(d) && v.poa > 0).map(([date, v]) => ({ cell, date, poa: v.poa, precip: v.precip, final: date < recentCut }));
    for (let i = 0; i < rows.length; i += 400) await rpc("irr_upsert", { rows: rows.slice(i, i + 400) }).catch(() => {});
    for (const r of rows) have[r.date] = { poa: r.poa, precip: r.precip };
  }
  return have;
}

// tomorrow (and the day after) expected kWh for a system
export async function forecastKwh(lat, lng, kwp, pr) {
  const f = await fetchForecast(lat, lng, 0, 3);
  return Object.entries(f).filter(([d]) => d > today()).map(([date, v]) => ({ date, poa: v.poa, rain: v.precip, kwh: kwp ? Math.round(kwp * v.poa * (pr || PR_REF) * 10) / 10 : null }));
}
