import { handler, stationLatest, DeyeError } from "./_deye.js";
export default handler(async (q) => {
  if (!q.id) throw new DeyeError("id مطلوب");
  return { latest: await stationLatest(q.id) };
});
