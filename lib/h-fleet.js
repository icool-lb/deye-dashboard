import { handler, stationList } from "./deye.js";
import { evaluateFleet } from "./eval.js";
// Performance ranking of all online stations over the last 7 days.
export default handler(async (q) => {
  const stations = await stationList();
  return await evaluateFleet(stations, Math.min(14, Math.max(3, Number(q.days) || 7)));
});
