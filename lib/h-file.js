// Serve a stored file: /api/file?id=&k=ACCESS_CODE (or portal token for customer-visible files is not offered).
import { guard } from "./deye.js";
import { rpc } from "./db.js";
export default async function (req, res) {
  if (!guard(req, res)) return;
  const f = await rpc("file_get", { id: Number(req.query.id) }).catch(() => null);
  if (!f) return res.status(404).json({ ok: false, error: "not found" });
  const mime = /^[\w.+-]+\/[\w.+-]+$/.test(f.mime || "") ? f.mime : "application/octet-stream";
  res.setHeader("content-type", mime);
  res.setHeader("content-disposition", `${/^image\/|pdf$/.test(mime) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name || "file")}`);
  res.setHeader("cache-control", "private, max-age=3600");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("content-security-policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.status(200).send(Buffer.from(f.data, "base64"));
}
