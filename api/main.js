// Single serverless entry (Hobby plan allows max 12 functions). vercel.json rewrites /api/<fn> and /api/cron/<job> here.
const routes = {
  stations: () => import("../lib/h-stations.js"), station: () => import("../lib/h-station.js"),
  devices: () => import("../lib/h-devices.js"), peaks: () => import("../lib/h-peaks.js"), day: () => import("../lib/h-day.js"),
  debug: () => import("../lib/h-debug.js"), evaluate: () => import("../lib/h-evaluate.js"), fleet: () => import("../lib/h-fleet.js"),
  alerts: () => import("../lib/h-alerts.js"), report: () => import("../lib/h-report.js"), "tg-setup": () => import("../lib/h-tg-setup.js"),
  "cron-sync": () => import("../lib/h-cron-sync.js"), "cron-alerts": () => import("../lib/h-cron-alerts.js"), "cron-backfill": () => import("../lib/h-cron-backfill.js"),
};
export default async function handler(req, res) {
  const fn = String(req.query.fn || "");
  const load = routes[fn];
  if (!load) return res.status(404).json({ ok: false, error: "unknown endpoint " + fn });
  const mod = await load();
  return mod.default(req, res);
}
