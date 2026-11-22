// Smart SoC config per station. GET ?id= -> config + preview plan + last run ; POST {id, enabled, min, max}
import { handler, stationList, DeyeError } from "./deye.js";
import { rpc } from "./db.js";
import { planStation } from "./h-cron-smartsoc.js";
export default handler(async (q, req) => {
  const all = (await rpc("get_setting", { k: "smart_soc" })) || {};
  if (req.method === "POST") {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const id = String(b.id || ""); if (!/^\d+$/.test(id)) throw new DeyeError("id مطلوب");
    const min = Math.round(Number(b.min)), max = Math.round(Number(b.max));
    if (!(min >= 10 && max <= 90 && min < max)) throw new DeyeError("الحد الأدنى بين 10 و الأعلى حتى 90، والأدنى أقل من الأعلى");
    all[id] = { enabled: !!b.enabled, min, max, stormMode: !!b.stormMode };
    await rpc("set_setting", { k: "smart_soc", v: all });
    return { config: all[id] };
  }
  const cfg = all[String(q.id)] || { enabled: false, min: 20, max: 50 };
  const st = (await stationList()).find((s) => String(s.id) === String(q.id));
  const plan = st ? await planStation(st, cfg).catch((e) => ({ skip: e.message })) : null;
  const last = await rpc("get_setting", { k: "smart_soc_log" });
  return { config: cfg, plan, last: last ? { at: last.at, entry: (last.log || []).find((l) => String(l.id) === String(q.id)) } : null };
});
