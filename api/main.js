// Single serverless entry (Hobby plan allows max 12 functions). vercel.json rewrites /api/<fn> and /api/cron/<job> here.
const routes = {
  stations: () => import("../lib/h-stations.js"), station: () => import("../lib/h-station.js"),
  devices: () => import("../lib/h-devices.js"), peaks: () => import("../lib/h-peaks.js"), day: () => import("../lib/h-day.js"),
  debug: () => import("../lib/h-debug.js"), evaluate: () => import("../lib/h-evaluate.js"), fleet: () => import("../lib/h-fleet.js"),
  alerts: () => import("../lib/h-alerts.js"), map: () => import("../lib/h-map.js"), report: () => import("../lib/h-report.js"), "tg-setup": () => import("../lib/h-tg-setup.js"),
  "cron-sync": () => import("../lib/h-cron-sync.js"), "cron-alerts": () => import("../lib/h-cron-alerts.js"), "cron-backfill": () => import("../lib/h-cron-backfill.js"),
 settings: () => import("../lib/h-settings.js"), audit: () => import("../lib/h-audit.js"), health: () => import("../lib/h-health.js"),
  soiling: () => import("../lib/h-soiling.js"), control: () => import("../lib/h-control.js"), tickets: () => import("../lib/h-tickets.js"),
  sfile: () => import("../lib/h-sfile.js"), file: () => import("../lib/h-file.js"), portal: () => import("../lib/h-portal.js"),
  smartsoc: () => import("../lib/h-smartsoc.js"), share: () => import("../lib/h-share.js"),
  "cron-settings": () => import("../lib/h-cron-settings.js"), "cron-health": () => import("../lib/h-cron-health.js"),
  "cron-smartsoc": () => import("../lib/h-cron-smartsoc.js"), "cron-monthly": () => import("../lib/h-cron-monthly.js"),  live: () => import("../lib/h-live.js"), "tg-webhook": () => import("../lib/h-tg-webhook.js"), "cron-live": () => import("../lib/h-cron-live.js"),  gridreport: () => import("../lib/h-gridreport.js"), "cron-grid": () => import("../lib/h-cron-grid.js"),  doctor: () => import("../lib/h-doctor.js"),
};
export default async function handler(req, res) {
  const fn = String(req.query.fn || "");
  const load = routes[fn];
  if (!load) return res.status(404).json({ ok: false, error: "unknown endpoint " + fn });
  const mod = await load();
  return mod.default(req, res);
}
