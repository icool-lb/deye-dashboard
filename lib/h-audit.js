// Fleet settings audit from the last stored reads (refreshed nightly by cron-settings).
import { handler } from "./deye.js";
import { auditStation } from "./settings.js";
import { rpc } from "./db.js";
export default handler(async () => {
  const rows = (await rpc("settings_all")) || [];
  const by = {};
  for (const r of rows) (by[r.station_id] = by[r.station_id] || { id: r.station_id, name: r.station_name, inverters: [], readAt: r.read_at }).inverters.push({ sn: r.sn, info: r.info || {}, settings: r.data, error: r.data ? null : r.error });
  const items = Object.values(by).map((s) => { const f = auditStation(s.inverters); return { ...s, findings: f, bad: f.filter((x) => x.lvl === "bad").length, warn: f.filter((x) => x.lvl === "warn").length }; })
    .sort((a, b) => b.bad - a.bad || b.warn - a.warn);
  return { items };
});
