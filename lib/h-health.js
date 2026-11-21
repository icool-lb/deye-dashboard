// Panel health for one station: PR vs real irradiance, soiling, rain effect, degradation, forecast.
import { handler, stationList, DeyeError } from "./deye.js";
import { stationHealth } from "./health.js";
import { rpc } from "./db.js";
export default handler(async (q) => {
  if (!q.id) throw new DeyeError("id مطلوب");
  const st = (await stationList()).find((s) => String(s.id) === String(q.id));
  if (!st) throw new DeyeError("النظام غير موجود");
  const h = await stationHealth(st);
  if (h.ok) await rpc("health_upsert", { station_id: st.id, data: { ...h, monthly: undefined } }).catch(() => {});
  return { health: h };
});
