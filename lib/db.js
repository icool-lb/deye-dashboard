// Supabase access through the secured monitor_rpc function (server side only).
const V2 = new Set(["settings_upsert", "settings_all", "irr_get", "irr_upsert", "health_upsert", "health_all", "control_add", "control_list", "ticket_list", "ticket_save", "sfile_get", "sfile_save", "sfile_all", "file_add", "file_get", "file_del"]);
const V3 = new Set(["sub_add", "sub_del", "sub_list", "lstate_get", "lstate_set"]);
export async function rpc(op, payload = {}) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_KEY, secret = process.env.DB_SECRET;
  if (!url || !key || !secret) throw new Error("Supabase not configured");
  const r = await fetch(`${url}/rest/v1/rpc/${V3.has(op) ? "monitor_rpc3" : V2.has(op) ? "monitor_rpc2" : "monitor_rpc"}`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ secret, op, payload }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`DB ${op}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
export const dayRow = (stationId, d) => ({
  station_id: stationId, date: d.date, peak_kw: d.peakLoad?.kw ?? null, peak_at: d.peakLoad?.at ?? null,
  p95_kw: d.p95Load, base_kw: d.baseLoad, avg_kw: d.avgLoad, load_kwh: d.loadKwh, pv_kwh: d.pvKwh,
  import_kwh: d.importKwh, export_kwh: d.exportKwh, soc_min: d.socMin, soc_max: d.socMax,
  pv_peak_kw: d.peakPv?.kw ?? null, frames: d.frames,
});
export function cronAuth(req, res) {
  const s = process.env.CRON_SECRET;
  const got = (req.headers.authorization || "").replace(/^Bearer /, "") || req.query?.key;
  if (s && got === s) return true;
  const code = process.env.ACCESS_CODE; // the owner can trigger jobs from the UI
  if (code && req.headers["x-access-code"] === code) return true;
  res.status(401).json({ ok: false, error: "unauthorized" });
  return false;
}
