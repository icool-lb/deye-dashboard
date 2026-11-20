// Map data: station coordinates from Deye plus manual overrides saved in Supabase (setting "locations").
import { guard } from "./deye.js";
import { rpc } from "./db.js";
export default async function (req, res) {
  res.setHeader("cache-control", "no-store");
  if (!guard(req, res)) return;
  try {
    const q = req.query || {};
    let locs = (await rpc("get_setting", { k: "locations" })) || {};
    if (q.set) {
      const id = String(q.set).replace(/\D/g, "");
      if (!id) throw new Error("id مطلوب");
      if (q.clear) delete locs[id];
      else {
        const lat = +q.lat, lng = +q.lng;
        if (!(lat > 27 && lat < 40 && lng > 30 && lng < 42)) throw new Error("الإحداثيات خارج المنطقة");
        locs[id] = [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6];
      }
      await rpc("set_setting", { k: "locations", v: locs });
    }
    res.status(200).json({ ok: true, locs });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
}
