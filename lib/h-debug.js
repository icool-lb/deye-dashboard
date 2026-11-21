// Read-only probe for development: only whitelisted read endpoints.
import { handler, call, callGet, DeyeError } from "./deye.js";
const READ = ["/v1.0/config/battery", "/v1.0/config/system", "/v1.0/config/tou", "/v1.0/strategy/dynamicControl/read", "/v1.0/strategy/dynamicControl/readResult", "/v1.0/device/measurePoints", "/v1.0/station/device", "/v1.0/device/latest", "/v1.0/station/latest"];
export default handler(async (q) => {
  if (!q.path) { const j = await call("/v1.0/station/list", { page: 1, size: 5 }); return { total: j.total, sample: (j.stationList || []).slice(0, 2) }; }
  if (/^\/v1\.0\/order\/\d+$/.test(q.path)) return { r: await callGet(q.path) };
  if (!READ.includes(q.path)) throw new DeyeError("path not allowed");
  return { r: await call(q.path, JSON.parse(q.body || "{}")) };
});
