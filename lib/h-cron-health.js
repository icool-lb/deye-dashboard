// Nightly: panel health for every station with data; Telegram summary of systems that need cleaning (weekly, Mondays).
import { stationList, today } from "./deye.js";
import { stationHealth } from "./health.js";
import { rpc, cronAuth } from "./db.js";
import { tgSend, esc } from "./tg.js";
async function pool(items, size, fn) { let i = 0; await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const it = items[i++]; try { await fn(it); } catch (e) {} } })); }
export default async function handler(req, res) {
  if (!cronAuth(req, res)) return;
  const t0 = Date.now();
  const sts = (await stationList()).filter((s) => Number(s.installedCapacity) > 0 && Date.now() / 1000 - Number(s.lastUpdateTime || 0) < 60 * 86400);
  const out = [];
  await pool(sts, 5, async (s) => {
    if (Date.now() - t0 > 270000) return;
    const h = await stationHealth(s);
    if (h.ok) { await rpc("health_upsert", { station_id: s.id, data: { ...h, monthly: undefined } }); out.push({ s, h }); }
  });
  const dirty = out.filter((x) => x.h.soilingPct >= 8).sort((a, b) => b.h.lossKwhMonth - a.h.lossKwhMonth);
  if (dirty.length && (new Date().getUTCDay() === 1 || req.query.notify)) {
    await tgSend(`🧽 <b>أنظمة تحتاج تنظيف (${dirty.length})</b>\n` + dirty.slice(0, 15).map((x) => `• ${esc(x.s.name)} — أقل ${x.h.soilingPct}% · ~${x.h.lossKwhMonth} kWh/شهر`).join("\n")).catch(() => {});
  }
  res.status(200).json({ ok: true, stations: sts.length, done: out.length, dirty: dirty.length, ms: Date.now() - t0, date: today() });
}
