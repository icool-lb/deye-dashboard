// Daily sync (runs ~03:00 Beirut): stations list + last 3 days of daily stats for every recently-online station.
import { stationList, frameRows, dailyTotals, analyzeDays, addDays, today } from "./deye.js";
import { rpc, dayRow, cronAuth } from "./db.js";
async function pool(items, size, fn) { let i = 0; await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const it = items[i++]; try { await fn(it); } catch (e) {} } })); }
export default async function handler(req, res) {
  if (!cronAuth(req, res)) return;
  const stations = await stationList();
  await rpc("upsert_stations", { rows: stations.map((s) => ({ id: s.id, name: s.name, address: s.locationAddress, kwp: s.installedCapacity, status: s.connectionStatus, last: s.lastUpdateTime, raw: s })) });
  const to = addDays(today(), -1), from = addDays(to, -2);
  const recent = stations.filter((s) => Date.now() / 1000 - Number(s.lastUpdateTime || 0) < 4 * 86400);
  let n = 0;
  await pool(recent, 6, async (s) => {
    const [rows, totals] = await Promise.all([frameRows(s.id, from, to), dailyTotals(s.id, from, to)]);
    const days = analyzeDays(rows, totals).filter((d) => d.date >= from && d.date <= to && d.frames > 0);
    if (days.length) { await rpc("upsert_daily", { rows: days.map((d) => dayRow(s.id, d)) }); n += days.length; }
  });
  res.status(200).json({ ok: true, stations: stations.length, synced: recent.length, days: n });
}
