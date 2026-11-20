import { handler, stationList } from "./deye.js";
export default handler(async () => ({ stations: await stationList() }));
