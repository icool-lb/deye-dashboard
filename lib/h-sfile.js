// System file: customer info, warranties, serials, notes + attached photos/documents.
// GET ?id= ; POST {station_id, data} ; POST {station_id, upload:{name,mime,data(base64)}, ticket_id?} ; POST {del: fileId}
import { handler, DeyeError } from "./deye.js";
import { rpc } from "./db.js";
export default handler(async (q, req) => {
  if (req.method !== "POST") { if (!q.id) throw new DeyeError("id مطلوب"); return await rpc("sfile_get", { station_id: Number(q.id) }); }
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (b.del) return await rpc("file_del", { id: Number(b.del) });
  if (!b.station_id) throw new DeyeError("station_id مطلوب");
  if (b.upload) {
    const d = String(b.upload.data || "");
    if (d.length > 2_800_000) throw new DeyeError("الملف كبير (الحد 2 MB)");
    if (!/^[A-Za-z0-9+/=]+$/.test(d)) throw new DeyeError("ملف غير صالح");
    return await rpc("file_add", { station_id: b.station_id, ticket_id: b.ticket_id || null, name: String(b.upload.name || "file").slice(0, 120), mime: String(b.upload.mime || "application/octet-stream").slice(0, 80), data: d });
  }
  return await rpc("sfile_save", { station_id: b.station_id, data: b.data || {} });
});
