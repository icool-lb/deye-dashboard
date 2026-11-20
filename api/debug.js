import { handler, call } from "./_deye.js";
export default handler(async () => {
  const j = await call("/v1.0/station/list", { page: 1, size: 5 });
  return { total: j.total, sample: (j.stationList || []).slice(0, 2) };
});
