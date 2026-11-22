// Doctor Deye: GET ?id= runs the deep diagnosis (30–90 s) and stores it; GET ?id=&last=1 returns the last report.
import { handler, stationList, DeyeError } from "./deye.js";
import { doctor } from "./doctor.js";
import { rpc } from "./db.js";
export default handler(async (q) => {
  if (!q.id) throw new DeyeError("id مطلوب");
  if (q.last) return { report: await rpc("get_setting", { k: `doctor:${q.id}` }).catch(() => null) };
  const st = (await stationList()).find((s) => String(s.id) === String(q.id));
  if (!st) throw new DeyeError("النظام غير موجود");
  const report = await doctor(st);
  const { series, ...b } = report.battery || {};
  await rpc("set_setting", { k: `doctor:${q.id}`, v: { ...report, battery: { ...b, series: (series || []).slice(-60) } } }).catch(() => {});
  return { report };
});
