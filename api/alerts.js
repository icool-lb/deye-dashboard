import { handler } from "./_deye.js";
import { rpc } from "./_db.js";
export default handler(async () => ({ alerts: await rpc("open_alerts") }));
