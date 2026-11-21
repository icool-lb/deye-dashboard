// Owner: customer links (portal, monthly report, WhatsApp) for one station. GET ?id=&month=
import { handler, stationList, addDays, today, DeyeError } from "./deye.js";
import { rpc } from "./db.js";
import { customerLinks } from "./h-cron-monthly.js";
export default handler(async (q) => {
  const st = (await stationList()).find((s) => String(s.id) === String(q.id)); if (!st) throw new DeyeError("غير موجود");
  const file = (await rpc("sfile_get", { station_id: Number(q.id) }))?.data || {};
  const month = /^\d{4}-\d{2}$/.test(q.month || "") ? q.month : addDays(`${today().slice(0, 7)}-01`, -1).slice(0, 7);
  return { month, ...customerLinks(st, file, month) };
});
