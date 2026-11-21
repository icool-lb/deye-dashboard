// POST {cmd, sns[], value, stationId, before} -> send order(s) and follow status. GET ?log[=stationId] -> history.
import { handler, DeyeError } from "./deye.js";
import { sendCommand, COMMANDS } from "./control.js";
import { rpc } from "./db.js";
export default handler(async (q, req) => {
  if (req.method !== "POST") return { log: await rpc("control_list", q.station ? { station_id: Number(q.station) } : {}), commands: Object.fromEntries(Object.entries(COMMANDS).map(([k, v]) => [k, v[2]])) };
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (b.confirm !== "YES") throw new DeyeError("يلزم تأكيد الأمر");
  return await sendCommand({ cmd: b.cmd, sns: b.sns, value: b.value, stationId: b.stationId, before: b.before });
});
