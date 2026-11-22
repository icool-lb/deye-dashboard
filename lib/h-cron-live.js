// Every 5 minutes: for stations with subscribed customers, read the live state and send alerts on Telegram.
import { stationList } from "./deye.js";
import { stationLive } from "./live.js";
import { rpc, cronAuth } from "./db.js";
import { tgTo } from "./tg.js";
import { diff, DEFAULT_PREFS } from "./custalerts.js";
import { applyLoads } from "./smartloads.js";
import { configured } from "./ewelink.js";
import { esc } from "./tg.js";
async function pool(items, size, fn) { let i = 0; await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const it = items[i++]; try { await fn(it); } catch (e) {} } })); }
export default async function handler(req, res) {
  if (!cronAuth(req, res)) return;
  try {
    const subs = (await rpc("sub_list")) || [];
    const files = (await rpc("sfile_all")) || {};
    const loadIds = configured() ? Object.keys(files).filter((k) => (files[k]?.loads || []).length && files[k]?.loadsOn !== false) : [];
    const ids = [...new Set([...subs.map((s) => String(s.station_id)), ...loadIds])];
    if (!ids.length) return res.status(200).json({ ok: true, stations: 0 });
    const [prev, sts] = await Promise.all([rpc("lstate_get", { ids }), stationList()]);
    let sent = 0;
    await pool(ids, 5, async (id) => {
      const live = await stationLive(id); if (!live.flow?.ok) return;
      const file = files?.[id] || {}, prefs = { ...DEFAULT_PREFS, ...(file.alerts || {}) };
      const name = file.customerName || sts.find((s) => String(s.id) === id)?.name || id;
      const { msgs, state } = diff(name, live, prev?.[id] || {}, prefs);
      if (loadIds.includes(id)) {
        const acts = await applyLoads(id, file.loads, live, state).catch(() => []);
        const okActs = acts.filter((a) => !a.error);
        if (okActs.length) msgs.push(`<b>${esc(name)}</b>\n🔌 تحكم ذكي بالأحمال:\n` + okActs.map((a) => `${a.act === "off" ? "⏸️ فُصل" : "▶️ شُغّل"} ${esc(a.name)} — ${esc(a.why)}`).join("\n"));
      }
      for (const m of msgs) for (const s of subs.filter((x) => String(x.station_id) === id)) { await tgTo(s.chat_id, m).catch(() => {}); sent++; }
      await rpc("lstate_set", { station_id: Number(id), state });
    });
    res.status(200).json({ ok: true, stations: ids.length, sent });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
}
