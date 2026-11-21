// Live settings of all inverters of one station (read from the inverters) + audit; stored for the fleet audit.
import { handler, DeyeError } from "./deye.js";
import { stationSettings } from "./settings.js";
import { rpc } from "./db.js";
export default handler(async (q) => {
  if (!q.id) throw new DeyeError("id مطلوب");
  const r = await stationSettings(q.id);
  await rpc("settings_upsert", { rows: r.inverters.map((i) => ({ sn: i.sn, station_id: Number(q.id), data: i.settings || null, info: i.info, error: i.error || null })) }).catch(() => {});
  return r;
});
