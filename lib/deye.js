// Shared Deye Cloud OpenAPI client (server side only — secrets never reach the browser).
import crypto from "node:crypto";

const BASE = (process.env.DEYE_BASE_URL || "https://eu1-developer.deyecloud.com").replace(/\/+$/, "");
export const TZ = process.env.STATION_TZ || "Asia/Beirut";
// Station frame power values come in W on most accounts; set DEYE_POWER_UNIT=kW if numbers look 1000x off.
const POWER_DIV = (process.env.DEYE_POWER_UNIT || "W").toLowerCase() === "kw" ? 1 : 1000;

let tokenCache = { token: null, exp: 0 };

export class DeyeError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

function loginBody() {
  const login = (process.env.DEYE_EMAIL || process.env.DEYE_USERNAME || "").trim();
  const pwHash = process.env.DEYE_PASSWORD_SHA256 ||
    (process.env.DEYE_PASSWORD ? crypto.createHash("sha256").update(process.env.DEYE_PASSWORD, "utf8").digest("hex") : "");
  if (!process.env.DEYE_APP_ID || !process.env.DEYE_APP_SECRET || !login || !pwHash) {
    throw new DeyeError("إعدادات Deye ناقصة: أضف DEYE_EMAIL و DEYE_PASSWORD في Vercel ثم Redeploy", "CONFIG");
  }
  const body = { appSecret: process.env.DEYE_APP_SECRET, password: pwHash.toLowerCase() };
  if (login.includes("@")) body.email = login; else if (/^\+?\d{6,}$/.test(login)) body.mobile = login; else body.username = login;
  if (process.env.DEYE_COMPANY_ID) body.companyId = String(process.env.DEYE_COMPANY_ID).trim();
  return body;
}

async function post(path, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method: "POST", headers, body: JSON.stringify(body || {}) });
  if (!res.ok) throw new DeyeError(`Deye HTTP ${res.status} on ${path}`, String(res.status));
  return res.json();
}

let tokenPromise = null;
async function getToken(force = false) {
  if (!force && tokenCache.token && Date.now() < tokenCache.exp - 120_000) return tokenCache.token;
  if (!tokenPromise) tokenPromise = login().finally(() => { tokenPromise = null; });
  return tokenPromise;
}
async function login() {
  const j = await post(`/v1.0/account/token?appId=${encodeURIComponent(process.env.DEYE_APP_ID || "")}`, loginBody());
  let t = j.accessToken || j.data?.accessToken;
  if (!j.success || !t) throw new DeyeError(`فشل تسجيل الدخول إلى Deye: ${j.msg || "unknown"}`, j.code);
  if (t.toLowerCase().startsWith("bearer ")) t = t.slice(7);
  tokenCache = { token: t, exp: Date.now() + (Number(j.expiresIn) || 3600) * 1000 };
  return t;
}

export async function callGet(path) {
  const go = async (force) => {
    const res = await fetch(BASE + path, { headers: { authorization: `Bearer ${await getToken(force)}` } });
    if (!res.ok) throw new DeyeError(`Deye HTTP ${res.status} on ${path}`, String(res.status));
    return res.json();
  };
  let j = await go(false);
  if (!j.success && /token|auth|login/i.test(j.msg || "")) j = await go(true);
  if (!j.success) throw new DeyeError(`${path}: ${j.msg || "error"} (${j.code ?? "?"})`, j.code);
  return j;
}

export async function call(path, body) {
  let j = await post(path, body, await getToken());
  if (!j.success && /token|auth|login/i.test(j.msg || "")) j = await post(path, body, await getToken(true));
  if (!j.success) throw new DeyeError(`${path}: ${j.msg || "error"} (${j.code ?? "?"})`, j.code);
  return j;
}

// ---------- endpoints ----------
export async function stationList() {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const j = await call("/v1.0/station/list", { page, size: 200 });
    const items = Array.isArray(j.stationList) ? j.stationList : [];
    out.push(...items);
    if (items.length < 200 || out.length >= Number(j.total || 0)) break;
  }
  return out;
}

export const stationLatest = (id) => call("/v1.0/station/latest", { stationId: Number(id) });

export async function stationDevices(id) {
  const j = await call("/v1.0/station/device", { page: 1, size: 100, stationIds: [Number(id)] });
  return Array.isArray(j.deviceListItems) ? j.deviceListItems : [];
}

export async function devicesLatest(sns) {
  const out = [];
  for (let i = 0; i < sns.length; i += 10) {
    const j = await call("/v1.0/device/latest", { deviceList: sns.slice(i, i + 10) });
    out.push(...(j.deviceDataList || []));
  }
  return out;
}

// ~5-minute power frames between two local dates (inclusive), fetched in 90-day chunks
// (4 in parallel) and normalized per chunk to keep memory low on long ranges.
async function framesChunk(id, from, to) {
  const startTs = Math.floor(zonedMidnight(from) / 1000);
  const endTs = Math.floor(zonedMidnight(addDays(to, 1)) / 1000) - 1;
  try {
    const j = await call("/v1.0/station/history/power", { stationId: Number(id), startTimestamp: startTs, endTimestamp: endTs });
    return normalizeFrames(j.stationDataItems || []);
  } catch (e) { /* fall back to per-day frames */ }
  const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const out = [];
  for (let i = 0; i < days.length; i += 4) {
    const chunk = await Promise.all(days.slice(i, i + 4).map((d) =>
      call("/v1.0/station/history", { stationId: Number(id), granularity: 1, startAt: d, endAt: addDays(d, 1) })
        .then((j) => normalizeFrames(j.stationDataItems || [])).catch(() => [])));
    chunk.forEach((c) => out.push(...c));
  }
  return out;
}

export async function frameRows(id, from, to) {
  const ranges = [];
  for (let s = from; s <= to; s = addDays(s, 90)) ranges.push([s, minDate(addDays(s, 89), to)]);
  const parts = [];
  for (let i = 0; i < ranges.length; i += 4) {
    parts.push(...(await Promise.all(ranges.slice(i, i + 4).map(([a, b]) => framesChunk(id, a, b)))));
  }
  const rows = parts.flat();
  rows.sort((a, b) => a.ts - b.ts);
  return rows;
}

// Daily energy totals (kWh), endAt exclusive, 30 days per call, 4 calls in parallel.
export async function dailyTotals(id, from, to) {
  const ranges = [];
  for (let s = from; s <= to; s = addDays(s, 30)) ranges.push([s, minDate(addDays(s, 29), to)]);
  const out = [];
  for (let i = 0; i < ranges.length; i += 4) {
    const res = await Promise.all(ranges.slice(i, i + 4).map(([a, b]) =>
      call("/v1.0/station/history", { stationId: Number(id), granularity: 2, startAt: a, endAt: addDays(b, 1) })
        .then((j) => j.stationDataItems || []).catch(() => [])));
    res.forEach((r) => out.push(...r));
  }
  return out;
}

// ---------- analysis ----------
const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
const kw = (v) => (num(v) === null ? null : num(v) / POWER_DIV);
// Deye daily totals are occasionally negative/garbage; fall back to integrated frames then.
const pos = (v) => { const n = num(v); return n === null || n < 0 || n > 1e6 ? null : n; };

export function normalizeFrames(items) {
  const map = new Map();
  for (const it of items) {
    let ts = num(it.timeStamp ?? it.time);
    if (ts === null) continue;
    if (ts > 1e11) ts = ts / 1000;
    const { date, hm } = localParts(ts * 1000);
    map.set(ts, {
      ts, date, hm,
      load: kw(it.consumptionPower), pv: kw(it.generationPower),
      grid: kw(it.wirePower), buy: kw(it.purchasePower), sell: kw(it.gridPower),
      bat: kw(it.batteryPower), chg: kw(it.chargePower), dis: kw(it.dischargePower),
      soc: num(it.batterySOC),
    });
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

function peak(rows, key) {
  let best = null;
  for (const r of rows) if (r[key] !== null && (best === null || r[key] > best[key])) best = r;
  return best ? { kw: round(best[key], 2), at: best.hm } : null;
}

function energy(rows, key) {
  // trapezoid integration in kWh, ignoring gaps longer than 20 min
  let e = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i], dt = (b.ts - a.ts) / 3600;
    if (dt <= 0 || dt > 1 / 3 || a[key] === null || b[key] === null) continue;
    e += ((Math.max(a[key], 0) + Math.max(b[key], 0)) / 2) * dt;
  }
  return round(e, 2);
}

export function analyzeDays(rows, totals) {
  const byDay = new Map();
  for (const r of rows) { if (!byDay.has(r.date)) byDay.set(r.date, []); byDay.get(r.date).push(r); }
  const totMap = new Map();
  for (const t of totals) {
    const d = t.year && t.month && t.day ? `${t.year}-${pad(t.month)}-${pad(t.day)}` : (t.time ? localParts(num(t.time) > 1e11 ? num(t.time) : num(t.time) * 1000).date : null);
    if (d) totMap.set(d, t);
  }
  const dates = [...new Set([...byDay.keys(), ...totMap.keys()])].sort();
  return dates.map((date) => {
    const rs = byDay.get(date) || [], t = totMap.get(date) || {};
    const loads = rs.map((r) => r.load).filter((v) => v !== null).sort((a, b) => a - b);
    const night = rs.filter((r) => r.hm >= "00:00" && r.hm < "05:00" && r.load !== null).map((r) => r.load);
    const socs = rs.map((r) => r.soc).filter((v) => v !== null);
    const over = (thr) => rs.filter((r) => r.load !== null && r.load >= thr).length * 5;
    const pk = peak(rs, "load");
    return {
      date, frames: rs.length,
      peakLoad: pk, peakPv: peak(rs, "pv"), peakImport: peak(rs, "buy"), peakExport: peak(rs, "sell"),
      peakCharge: peak(rs, "chg"), peakDischarge: peak(rs, "dis"),
      avgLoad: loads.length ? round(loads.reduce((a, b) => a + b, 0) / loads.length, 2) : null,
      baseLoad: night.length ? round(Math.min(...night), 2) : (loads.length ? round(loads[Math.floor(loads.length * 0.05)], 2) : null),
      p95Load: loads.length ? round(loads[Math.min(loads.length - 1, Math.floor(loads.length * 0.95))], 2) : null,
      minutesAbove80pct: pk ? over(pk.kw * 0.8) : 0,
      socMin: socs.length ? Math.min(...socs) : null, socMax: socs.length ? Math.max(...socs) : null,
      loadKwh: pos(t.consumptionValue) ?? energy(rs, "load"),
      pvKwh: pos(t.generationValue) ?? energy(rs, "pv"),
      importKwh: pos(t.purchaseValue) ?? energy(rs, "buy"),
      exportKwh: pos(t.gridValue) ?? energy(rs, "sell"),
      chargeKwh: pos(t.chargeValue) ?? energy(rs, "chg"),
      dischargeKwh: pos(t.dischargeValue) ?? energy(rs, "dis"),
    };
  });
}

// ---------- dates in station time zone ----------
const pad = (n) => String(n).padStart(2, "0");
export const round = (v, d = 2) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function localParts(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}
function tzOffsetMs(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000;
}
export function zonedMidnight(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const off = tzOffsetMs(guess - tzOffsetMs(guess));
  return guess - off;
}
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
const minDate = (a, b) => (a < b ? a : b);
export const today = () => localParts(Date.now()).date;
export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// ---------- request helpers ----------
export function guard(req, res) {
  const code = process.env.ACCESS_CODE;
  if (!code) return true;
  const given = req.headers["x-access-code"] || req.query?.k || "";
  const a = Buffer.from(String(given)), b = Buffer.from(code);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  res.status(401).json({ ok: false, error: "رمز الدخول غير صحيح" });
  return false;
}

export function handler(fn) {
  return async (req, res) => {
    res.setHeader("cache-control", "no-store");
    if (!guard(req, res)) return;
    try { res.status(200).json({ ok: true, ...(await fn(req.query || {}, req)) }); }
    catch (e) { res.status(e.code === "CONFIG" ? 500 : 502).json({ ok: false, error: e.message }); }
  };
}
