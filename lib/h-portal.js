// Customer portal API (read-only, one station): /api/portal?s=ID&t=TOKEN&fn=info|now|day|month
import { stationList, stationLatest, frameRows, today, isDate, addDays, round } from "./deye.js";
import { portalOk, portalToken } from "./portal.js";
import { guard } from "./deye.js";
import { rpc } from "./db.js";
import { stationLL, forecastKwh } from "./weather.js";
export default async function (req, res) {
  res.setHeader("cache-control", "no-store");
  const q = req.query || {};
  try {
    if (q.fn === "link") { // owner only: get the customer link
      if (!guard(req, res)) return;
      return res.status(200).json({ ok: true, path: `/c.html?s=${encodeURIComponent(q.s)}&t=${portalToken(q.s)}` });
    }
    if (!portalOk(q.s, q.t)) return res.status(401).json({ ok: false, error: "الرابط غير صالح" });
    const id = q.s;
    if (q.fn === "now") return res.status(200).json({ ok: true, latest: await stationLatest(id) });
    if (q.fn === "day") { const date = isDate(q.date) ? q.date : today(); const rows = (await frameRows(id, date, date)).filter((r) => r.date === date).map((r) => ({ hm: r.hm, pv: r.pv, load: r.load, soc: r.soc })); return res.status(200).json({ ok: true, date, rows }); }
    if (q.fn === "month") {
      const to = addDays(today(), -1), from = addDays(to, -364);
      const rows = (await rpc("daily", { station_id: Number(id), from, to })) || [];
      const months = {};
      for (const r of rows) { const m = r.date.slice(0, 7); const o = months[m] = months[m] || { m, pv: 0, load: 0, imp: 0, days: 0 }; o.pv += Number(r.pv_kwh) || 0; o.load += Number(r.load_kwh) || 0; o.imp += Number(r.import_kwh) || 0; o.days++; }
      return res.status(200).json({ ok: true, months: Object.values(months).map((o) => ({ ...o, pv: round(o.pv, 0), load: round(o.load, 0), imp: round(o.imp, 0) })) });
    }
    const st = (await stationList()).find((s) => String(s.id) === String(id));
    if (!st) return res.status(404).json({ ok: false, error: "غير موجود" });
    let forecast = [];
    try { const ll = await stationLL(st); forecast = await forecastKwh(ll.lat, ll.lng, Number(st.installedCapacity) || 0); } catch (e) {}
    const file = (await rpc("sfile_get", { station_id: Number(id) }).catch(() => null))?.data || {};
    return res.status(200).json({ ok: true, station: { id: st.id, name: file.customerName || st.name, kwp: st.installedCapacity, status: st.connectionStatus, lastUpdateTime: st.lastUpdateTime, start: st.startOperatingTime }, forecast, price: file.price || 0.3 });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
}
