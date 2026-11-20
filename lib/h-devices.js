import { handler, stationDevices, devicesLatest, DeyeError } from "./deye.js";
export default handler(async (q) => {
  if (!q.id) throw new DeyeError("id مطلوب");
  const devices = await stationDevices(q.id);
  const sns = devices.map((d) => d.deviceSn).filter(Boolean);
  const latest = sns.length ? await devicesLatest(sns).catch(() => []) : [];
  return { devices, latest };
});
