// Grid (EDL) report. GET ?from&to -> per-system summary + per-region summary; GET ?id&from&to -> daily timeline.
import { handler, stationList, today, addDays, isDate, round } from "./deye.js";
import { rpc } from "./db.js";
import { regionsFor, V_LOW, V_HIGH } from "./gridlog.js";
export default handler(async (q) => {
  const to = isDate(q.to) ? q.to : today(), from = isDate(q.from) ? q.from : addDays(to, -6);
  const rows = (await rpc("grid_range", { from, to, ...(q.id ? { station_id: Number(q.id) } : {}) })) || [];
  if (q.id) return { from, to, days: rows.map((r) => ({ date: r.date, ...r.data })) };
  const [sts, files, locs] = await Promise.all([stationList(), rpc("sfile_all").catch(() => ({})), rpc("get_setting", { k: "locations" }).catch(() => ({}))]);
  const by = {};
  for (const r of rows) (by[r.station_id] = by[r.station_id] || []).push(r.data);
  const ids = Object.keys(by);
  const regions = await regionsFor(sts.filter((s) => ids.includes(String(s.id))), files, locs);
  const mn = (a) => (a.length ? Math.min(...a) : null), mx = (a) => (a.length ? Math.max(...a) : null), sm = (a) => a.reduce((x, y) => x + (y || 0), 0);
  const items = ids.map((id) => {
    const d = by[id], st = sts.find((s) => String(s.id) === id) || {};
    const covered = sm(d.map((x) => x.onMin + x.offMin));
    return {
      id, name: files?.[id]?.customerName || st.name || id, region: regions[id], days: d.length,
      onPct: covered ? round((sm(d.map((x) => x.onMin)) / covered) * 100, 0) : null,
      onHoursDay: covered ? round((sm(d.map((x) => x.onMin)) / covered) * 24, 1) : null,
      outages: sm(d.map((x) => x.outages)), switches: sm(d.map((x) => x.switches)), longestOffH: round(mx(d.map((x) => x.longestOffMin)) / 60, 1),
      vmin: mn(d.map((x) => x.vmin).filter((v) => v !== null)), vmax: mx(d.map((x) => x.vmax).filter((v) => v !== null)),
      fmin: mn(d.map((x) => x.fmin).filter((v) => v !== null)), fmax: mx(d.map((x) => x.fmax).filter((v) => v !== null)),
      lowVH: round(sm(d.map((x) => x.lowVMin)) / 60, 1), highVH: round(sm(d.map((x) => x.highVMin)) / 60, 1), badFH: round(sm(d.map((x) => x.badFMin)) / 60, 1),
      gapH: round(sm(d.map((x) => x.gapMin)) / 60, 1), phases: d[0]?.phases || 1,
    };
  }).sort((a, b) => (a.region || "").localeCompare(b.region || "", "ar") || a.name.localeCompare(b.name));
  const reg = {};
  for (const it of items) { const r = (reg[it.region] = reg[it.region] || { region: it.region, systems: 0, hours: [], vmin: [], vmax: [], outages: 0 }); r.systems++; if (it.onHoursDay !== null) r.hours.push(it.onHoursDay); if (it.vmin !== null) r.vmin.push(it.vmin); if (it.vmax !== null) r.vmax.push(it.vmax); r.outages += it.outages; }
  const regionsSum = Object.values(reg).map((r) => ({ region: r.region, systems: r.systems, onHoursDay: r.hours.length ? round(sm(r.hours) / r.hours.length, 1) : null, vmin: mn(r.vmin), vmax: mx(r.vmax), outages: r.outages })).sort((a, b) => (b.onHoursDay ?? -1) - (a.onHoursDay ?? -1));
  return { from, to, vLow: V_LOW, vHigh: V_HIGH, items, regions: regionsSum };
});
