// Owner: live power flow + battery runtime for one station. GET ?id=
import { handler, DeyeError } from "./deye.js";
import { stationLive } from "./live.js";
export default handler(async (q) => { if (!q.id) throw new DeyeError("id مطلوب"); return await stationLive(q.id); });
