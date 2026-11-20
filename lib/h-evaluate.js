import { handler, DeyeError } from "./deye.js";
import { evaluateStation } from "./eval.js";
// Full performance evaluation of one station (last N days, default 30).
export default handler(async (q) => {
  if (!q.id) throw new DeyeError("id required");
  const days = Math.min(90, Math.max(7, Number(q.days) || 30));
  return await evaluateStation(q.id, { days });
});
