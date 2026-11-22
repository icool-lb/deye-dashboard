// eWeLink OAuth redirect target: exchanges the code for tokens, then sends the owner back to the platform.
import { exchange, stateTok } from "./ewelink.js";
export default async function (req, res) {
  const q = req.query || {};
  if (q.state !== stateTok() || !q.code) return res.status(400).send("رابط غير صالح");
  try { await exchange(String(q.code), String(q.region || "eu")); res.redirect(302, "/?ewelink=ok"); }
  catch (e) { res.status(500).send("فشل ربط eWeLink: " + String(e.message).replace(/[<>&]/g, "")); }
}
