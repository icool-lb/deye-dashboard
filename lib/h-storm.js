// Storm/wind risk around all systems (for the map). GET -> cells with risk and the systems inside them.
import { handler } from "./deye.js";
import { stormScan } from "./storm.js";
export default handler(async (q) => {
  const r = await stormScan(Math.min(24, Math.max(3, Number(q.hours) || 6)));
  return { at: r.at, cells: r.cells.map(({ hours, ...c }) => ({ ...c, stations: c.stations.map((s) => ({ id: s.id, name: s.name })) })) };
});
