// Tokens for Telegram deep links (owner registration, customer subscription) and the webhook secret.
import crypto from "node:crypto";
import { portalToken } from "./portal.js";
const h = (s) => crypto.createHmac("sha256", process.env.DB_SECRET || process.env.ACCESS_CODE || "x").update(s).digest("base64url");
export const ownerTok = () => h("tg-owner").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
export const hookSecret = () => h("tg-hook").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
export const subPayload = (id) => `s${id}_${portalToken(id).replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}`;
export function parseSub(p) { const m = /^s(\d+)_([A-Za-z0-9]{12})$/.exec(p || ""); return m && subPayload(m[1]) === p ? m[1] : null; }
