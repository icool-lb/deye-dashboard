// Work orders: GET ?station=&status=active|open|done ; POST {id?, station_id, title, details, status, priority, assignee, note, source, alert_id}
import { handler, DeyeError } from "./deye.js";
import { rpc } from "./db.js";
export default handler(async (q, req) => {
  if (req.method !== "POST") return { tickets: await rpc("ticket_list", { ...(q.station ? { station_id: Number(q.station) } : {}), ...(q.status ? { status: q.status } : {}) }) };
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (!b.id && !(b.title || "").trim()) throw new DeyeError("عنوان التذكرة مطلوب");
  if (b.status && !["open", "in_progress", "done"].includes(b.status)) throw new DeyeError("حالة غير صالحة");
  const p = {}; for (const k of ["id", "station_id", "title", "details", "status", "priority", "assignee", "note", "source", "alert_id"]) if (b[k] !== undefined && b[k] !== "") p[k] = b[k];
  return await rpc("ticket_save", p);
});
