import { handler, stationLatest, DeyeError } from "./deye.js";
export default handler(async (q) => {
  if (!q.id) throw new DeyeError("id مطلوب");
  return { latest: await stationLatest(q.id) };
});
