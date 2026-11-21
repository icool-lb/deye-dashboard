// Customer portal tokens: one per station, derived from the server secret (no storage, cannot be guessed).
import crypto from "node:crypto";
export const portalToken = (id) => crypto.createHmac("sha256", process.env.DB_SECRET || process.env.ACCESS_CODE || "x").update(`portal:${id}`).digest("base64url").slice(0, 22);
export function portalOk(id, t) {
  if (!id || !t) return false;
  const a = Buffer.from(portalToken(id)), b = Buffer.from(String(t));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
