import { handler } from "./deye.js";
import { rpc } from "./db.js";
export default handler(async () => ({ alerts: await rpc("open_alerts") }));
