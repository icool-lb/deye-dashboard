// Owner: customer links (portal, monthly report, WhatsApp) for one station. GET ?id=&month=
import { handler, stationList, addDays, today, DeyeError } from "./deye.js";
import { rpc } from "./db.js";
import { customerLinks } from "./h-cron-monthly.js";
import { subPayload } from "./tgtokens.js";
export default handler(async (q) => {
  const st = (await stationList()).find((s) => String(s.id) === String(q.id)); if (!st) throw new DeyeError("غير موجود");
  const file = (await rpc("sfile_get", { station_id: Number(q.id) }))?.data || {};
  const month = /^\d{4}-\d{2}$/.test(q.month || "") ? q.month : addDays(`${today().slice(0, 7)}-01`, -1).slice(0, 7);
  const bot = await rpc("get_setting", { k: "tg_bot" }).catch(() => null);
  const links = customerLinks(st, file, month);
  const tg = bot ? `https://t.me/${bot}?start=${subPayload(st.id)}` : null;
  const subs = (await rpc("sub_list", { station_id: Number(st.id) }).catch(() => [])) || [];
  let waAlerts = null;
  if (tg) { const text = `مرحباً ${file.customerName || st.ownerName || ""}،\nلتصلك تنبيهات نظام الطاقة الشمسية على تلغرام (انقطاع الدولة، المولد، البطارية، وهل تكفي البطارية للصباح) اضغط هذا الرابط ثم Start:\n${tg}\n\niCOOL — COOL YOUR LIFE`; waAlerts = links.phone ? `https://wa.me/${links.phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`; }
  return { month, ...links, tg, waAlerts, subscribers: subs.map((s) => ({ name: s.name, since: s.created_at })) };
});
