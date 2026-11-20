// History backfill into the DB: processes the next few stations (up to 2 years each) per call.
// Called repeatedly by Supabase pg_cron until the cursor reaches the end.
import { stationList, frameRows, dailyTotals, analyzeDays, addDays, today } from "./deye.js";
import { rpc, dayRow, cronAuth } from "./db.js";
export default async function handler(req, res) {
  if (!cronAuth(req, res)) return;
  const per = Math.min(5, Number(req.query.n) || 2);
  const done = (await rpc("get_setting", { k: "backfill_done" })) || [];
  const stations = (await stationList()).sort((a, b) => a.id - b.id);
  const next = stations.filter((s) => !done.includes(s.id)).slice(0, per);
  const out = [];
  for (const s of next) {
    const last = Number(s.lastUpdateTime || 0);
    if (!last) { done.push(s.id); continue; }
    const to = new Date(Math.min(Date.now() - 864e5, last * 1000)).toISOString().slice(0, 10);
    const from = addDays(to, -730);
    for (let a = from; a <= to; a = addDays(a, 183)) {
      const b = addDays(a, 182) < to ? addDays(a, 182) : to;
      const [rows, totals] = await Promise.all([frameRows(s.id, a, b), dailyTotals(s.id, a, b)]);
      const days = analyzeDays(rows, totals).filter((d) => d.date >= a && d.date <= b && d.frames > 0);
      for (let i = 0; i < days.length; i += 200) await rpc("upsert_daily", { rows: days.slice(i, i + 200).map((d) => dayRow(s.id, d)) });
      out.push({ id: s.id, a, b, days: days.length });
    }
    done.push(s.id);
    await rpc("set_setting", { k: "backfill_done", v: done });
  }
  res.status(200).json({ ok: true, processed: next.map((s) => s.id), remaining: stations.length - done.length, out });
}
