// Hourly: grid (EDL) log for today (and yesterday right after midnight) for every online system. ?days=N backfills.
import { stationList, today, addDays } from "./deye.js";
import { rpc, cronAuth } from "./db.js";
import { gridDay, stationGridSource } from "./gridlog.js";
async function pool(items, size, fn) { let i = 0; await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const it = items[i++]; try { await fn(it); } catch (e) {} } })); }
export default async function handler(req, res) {
  if (!cronAuth(req, res)) return;
  try {
    const t0 = Date.now(), q = req.query || {};
    const days = Math.min(14, Math.max(0, Number(q.days) || 0));
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    const dates = days ? Array.from({ length: days }, (_, i) => addDays(today(), -days + i + 1)) : hour < 3 ? [addDays(today(), -1), today()] : [today()];
    const maxAge = (days + 2) * 86400;
    const sts = (await stationList()).filter((s) => Date.now() / 1000 - Number(s.lastUpdateTime || 0) < maxAge && !/NO_DEVICE/.test(s.connectionStatus || ""));
    const cache = (await rpc("get_setting", { k: "grid_src" }).catch(() => null)) || {};
    const n0 = Object.keys(cache).length;
    const tasks = [];
    await pool(sts, 6, async (s) => { const src = await stationGridSource(s.id, cache); if (src) for (const d of dates) tasks.push({ s, src, d }); });
    if (Object.keys(cache).length !== n0) await rpc("set_setting", { k: "grid_src", v: cache }).catch(() => {});
    const rows = []; let fail = 0;
    await pool(tasks, 6, async ({ s, src, d }) => {
      if (Date.now() - t0 > 270000) return;
      try { const r = await gridDay(src.sn, src.k, d); if (!r.noData) rows.push({ station_id: s.id, date: d, sn: src.sn, data: r }); } catch (e) { fail++; }
    });
    for (let i = 0; i < rows.length; i += 50) await rpc("grid_upsert", { rows: rows.slice(i, i + 50) });
    res.status(200).json({ ok: true, dates, stations: sts.length, tasks: tasks.length, saved: rows.length, failed: fail, ms: Date.now() - t0 });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
}
