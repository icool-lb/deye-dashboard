import { handler, frameRows, dailyTotals, analyzeDays, addDays, today, isDate, DeyeError } from "./deye.js";
// Daily analysis over up to ~2 years: peak consumption (and time), PV/import peaks, base load, P95, SOC range, energies.
export default handler(async (q) => {
  if (!q.id) throw new DeyeError("id required");
  const to = isDate(q.to) ? q.to : today();
  let from = isDate(q.from) ? q.from : addDays(to, -6);
  if (from > to) from = to;
  if (addDays(from, 731) < to) from = addDays(to, -731);
  const [rows, totals] = await Promise.all([frameRows(q.id, from, to), dailyTotals(q.id, from, to)]);
  const days = analyzeDays(rows, totals).filter((d) => d.date >= from && d.date <= to && (d.frames > 0 || d.loadKwh || d.pvKwh));
  const withPeak = days.filter((d) => d.peakLoad);
  const top = withPeak.reduce((b, d) => (!b || d.peakLoad.kw > b.peakLoad.kw ? d : b), null);
  return {
    from, to, days,
    summary: {
      maxPeakLoad: top ? { kw: top.peakLoad.kw, date: top.date, at: top.peakLoad.at } : null,
      avgDailyPeak: withPeak.length ? +(withPeak.reduce((s, d) => s + d.peakLoad.kw, 0) / withPeak.length).toFixed(2) : null,
      totalLoadKwh: +days.reduce((s, d) => s + (d.loadKwh || 0), 0).toFixed(1),
      totalPvKwh: +days.reduce((s, d) => s + (d.pvKwh || 0), 0).toFixed(1),
      totalImportKwh: +days.reduce((s, d) => s + (d.importKwh || 0), 0).toFixed(1),
    },
  };
});
