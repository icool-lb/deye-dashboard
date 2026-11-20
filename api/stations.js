import { handler, stationList } from "./_deye.js";
export default handler(async () => ({ stations: await stationList() }));
