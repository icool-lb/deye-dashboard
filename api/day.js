import { handler, frameRows, today, isDate } from "./_deye.js";
// 5-minute curve for one day.
export default handler(async (q) => {
  const date = isDate(q.date) ? q.date : today();
  const rows = (await frameRows(q.id, date, date)).filter((r) => r.date === date);
  return { date, rows };
});
