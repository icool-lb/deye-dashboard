// Nightly: read live settings of every online inverter and store them (for the fleet audit).
import { stationList, stationDevices } from "./deye.js";
import { readSettings } from "./settings.js";
import { rpc, cronAuth } from "./db.js";
async function pool(items, size, fn) { let i = 0; await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const it = items[i++]; try { await fn(it); } catch (e) {} } })); }
export default async function handler(req, res) {
  if (!cronAuth(req, res)) return;
  const t0 = Date.now();
  const online = (await stationList()).filter((s) => Date.now() / 1000 - Number(s.lastUpdateTime || 0) < 3 * 3600 && !/NO_DEVICE|ALL_OFFLINE/.test(s.connectionStatus || ""));
  const invs = [];
  await pool(online, 8, async (s) => { for (const d of await stationDevices(s.id)) if (/INVERTER/i.test(d.deviceType || "")) invs.push({ sn: d.deviceSn, station_id: s.id }); });
  let ok = 0, fail = 0; const rows = [];
  await pool(invs, 8, async (i) => {
    if (Date.now() - t0 > 250000) return;
    try { rows.push({ ...i, data: await readSettings(i.sn, 20000) }); ok++; } catch (e) { rows.push({ ...i, data: null, error: e.message }); fail++; }
  });
  for (let k = 0; k < rows.length; k += 100) await rpc("settings_upsert", { rows: rows.slice(k, k + 100) });
  res.status(200).json({ ok: true, stations: online.length, inverters: invs.length, read: ok, failed: fail, ms: Date.now() - t0 });
}
