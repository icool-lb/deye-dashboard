// Fleet panel-health list (from the nightly cron): who needs cleaning, PR, degradation, tomorrow's forecast.
import { handler } from "./deye.js";
import { rpc } from "./db.js";
export default handler(async () => {
  const rows = (await rpc("health_all")) || [];
  const items = rows.map((r) => ({ id: r.station_id, name: r.name, kwp: r.kwp, updated: r.updated_at, ...(r.data || {}) }))
    .filter((r) => r.ok).sort((a, b) => (b.lossKwhMonth || 0) - (a.lossKwhMonth || 0));
  return { items };
});
