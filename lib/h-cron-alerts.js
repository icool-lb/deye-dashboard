// Every 30 min (Supabase pg_cron): offline detection + Deye alarms → DB → Telegram.
import { stationList, call } from "./deye.js";
import { rpc, cronAuth } from "./db.js";
import { tgSend, esc } from "./tg.js";
async function pool(items, size, fn) { let i = 0; await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const it = items[i++]; try { await fn(it); } catch (e) {} } })); }
export default async function handler(req, res) {
  if (!cronAuth(req, res)) return;
  const now = Date.now() / 1000;
  const stations = await stationList();
  await rpc("upsert_stations", { rows: stations.map((s) => ({ id: s.id, name: s.name, address: s.locationAddress, kwp: s.installedCapacity, status: s.connectionStatus, last: s.lastUpdateTime, raw: s })) });
  const rows = [];
  // offline: stopped reporting in the last 7 days (older outages are known already and not alerted)
  const offline = [], online = [];
  for (const s of stations) {
    const age = now - Number(s.lastUpdateTime || 0);
    if (age > 2 * 3600 && age < 7 * 86400) { offline.push(s); rows.push({ station_id: s.id, source: "offline", code: "OFFLINE", level: "bad", message: "النظام توقف عن إرسال البيانات", started_at: new Date(Number(s.lastUpdateTime) * 1000).toISOString() }); }
    else if (age <= 2 * 3600) online.push(s);
    if (age <= 2 * 3600 && String(s.connectionStatus).includes("PARTIAL")) rows.push({ station_id: s.id, source: "partial", code: "PARTIAL", level: "warn", message: "جهاز من أجهزة النظام مفصول (اتصال جزئي)", started_at: new Date(Math.floor(now / 86400) * 86400 * 1000).toISOString() });
  }
  // Deye alarm lists (last 2 hours) for online stations
  await pool(online, 6, async (s) => {
    const j = await call("/v1.0/station/alertList", { stationId: s.id, page: 1, size: 50, startTimestamp: Math.floor(now - 2 * 3600), endTimestamp: Math.floor(now) });
    for (const a of j.stationAlertItems || []) rows.push({
      station_id: s.id, device_sn: a.deviceSn || a.sn || "", source: "deye", code: String(a.alertCode ?? a.code ?? a.alertId ?? ""),
      level: /fault|error|紧急|critical/i.test(JSON.stringify(a)) ? "bad" : "warn",
      message: a.alertName || a.alertMsg || a.description || JSON.stringify(a).slice(0, 200),
      started_at: new Date(Number(a.startTimestamp || a.alertTime || now) * (Number(a.startTimestamp || a.alertTime || now) > 1e11 ? 1 : 1000)).toISOString(),
      ended_at: a.endTimestamp ? new Date(Number(a.endTimestamp) * (Number(a.endTimestamp) > 1e11 ? 1 : 1000)).toISOString() : null,
    });
  });
  const up = rows.length ? await rpc("upsert_alerts", { rows }) : { new: 0 };
  // close offline/partial alerts for stations that came back
  await rpc("close_alerts", { source: "offline", station_ids: online.map((s) => s.id) });
  await rpc("close_alerts", { source: "partial", station_ids: online.filter((s) => !String(s.connectionStatus).includes("PARTIAL")).map((s) => s.id) });
  // notify
  const pending = await rpc("pending_alerts");
  let sent = 0;
  if (pending.length && process.env.TELEGRAM_TOKEN) {
    const icon = { bad: "🔴", warn: "🟠", info: "🔵" };
    const lines = pending.slice(0, 30).map((a) => `${icon[a.level] || "⚪"} <b>${esc(a.station_name || a.station_id)}</b> — ${esc(a.message)}${a.device_sn ? ` <code>${esc(a.device_sn)}</code>` : ""}`);
    const r = await tgSend(`⚡ <b>iCOOL Monitor</b> — ${pending.length} تنبيه جديد\n\n${lines.join("\n")}${pending.length > 30 ? `\n… و${pending.length - 30} غيرها` : ""}`);
    if (r.ok && r.sent) { await rpc("mark_notified", { ids: pending.map((a) => a.id) }); sent = pending.length; }
  }
  res.status(200).json({ ok: true, online: online.length, offline: offline.length, alerts: rows.length, new: up.new, sent });
}
