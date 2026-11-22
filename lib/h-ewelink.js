// Owner: eWeLink account link + device list + manual on/off test. GET ?op=status|login|devices ; POST {id, outlet, on}
import { handler, DeyeError } from "./deye.js";
import { status, loginUrl, devices, setSwitch, configured, REDIRECT } from "./ewelink.js";
export default handler(async (q, req) => {
  if (req.method === "POST") {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (!b.id) throw new DeyeError("id مطلوب");
    await setSwitch(String(b.id), !!b.on, b.outlet ?? null);
    return { done: true };
  }
  if (q.op === "login") { if (!configured()) throw new DeyeError("EWELINK_APPID / EWELINK_SECRET غير مضافة بعد"); return { url: loginUrl(), redirect: REDIRECT }; }
  if (q.op === "devices") return { devices: await devices() };
  return { ...(await status()), redirect: REDIRECT };
});
