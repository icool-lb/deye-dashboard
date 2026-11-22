// Every 30 min: thunderstorm / strong wind warning to the owner and subscribed customers (once per area per 6 h).
// Optional "storm mode" per system (Smart SoC settings): raise the battery reserve before the storm.
import { stormScan, stormText } from "./storm.js";
import { rpc, cronAuth } from "./db.js";
import { tgSend, tgTo, esc } from "./tg.js";
import { stationDevices } from "./deye.js";
import { readSettings } from "./settings.js";
import { sendCommand } from "./control.js";
export default async function handler(req, res) {
  if (!cronAuth(req, res)) return;
  try {
    const scan = await stormScan(6);
    const state = (await rpc("get_setting", { k: "storm_state" }).catch(() => null)) || {};
    const now = Date.now(), fresh = scan.risky.filter((c) => !state[c.key] || now - state[c.key] > 6 * 3600e3 || (c.level === "high" && state[c.key + ":lvl"] !== "high"));
    if (!fresh.length) return res.status(200).json({ ok: true, risky: scan.risky.length, sent: 0 });
    const subs = (await rpc("sub_list").catch(() => [])) || [];
    const files = (await rpc("sfile_all").catch(() => ({}))) || {};
    const smart = (await rpc("get_setting", { k: "smart_soc" }).catch(() => ({}))) || {};
    let sent = 0; const prepped = [];
    for (const c of fresh) {
      state[c.key] = now; state[c.key + ":lvl"] = c.level || "wind";
      for (const s of c.stations) {
        for (const sub of subs.filter((x) => String(x.station_id) === s.id)) { await tgTo(sub.chat_id, stormText(c, esc(files?.[s.id]?.customerName || s.name))).catch(() => {}); sent++; }
        const cfg = smart[s.id];
        if (cfg?.stormMode && (c.level === "high" || c.level === "watch") && s.online) {
          try {
            const invs = (await stationDevices(s.id)).filter((d) => /INVERTER/i.test(d.deviceType || ""));
            for (const d of invs) {
              const st = await readSettings(d.deviceSn); if (st.touAction !== "on") continue;
              const target = Number(cfg.max ?? 50);
              if (Math.min(...st.timeUseSettingItems.map((i) => Number(i.soc))) >= target) continue;
              await sendCommand({ cmd: "touUpdate", sns: [d.deviceSn], value: st.timeUseSettingItems.map((i) => ({ ...i, soc: target })), stationId: s.id, before: { soc: st.timeUseSettingItems.map((i) => i.soc) }, user: "Storm mode" });
            }
            prepped.push(s.name);
          } catch (e) {}
        }
      }
    }
    const lines = fresh.map((c) => `• ${c.level === "high" ? "⛈️" : c.level ? "🌩️" : "💨"} ${c.stations.map((s) => esc(s.name)).slice(0, 6).join("، ")}${c.stations.length > 6 ? ` +${c.stations.length - 6}` : ""} — ${c.startsIn !== null ? `خلال ${c.startsIn} س` : ""}${c.wind ? ` رياح ${c.gustMax} كم/س` : ""}`);
    await tgSend(`⛈️ <b>إنذار طقس للأنظمة</b>\n${lines.join("\n")}${prepped.length ? `\n🔋 وضع العاصفة: رُفع احتياط البطارية في ${prepped.map(esc).join("، ")}` : ""}`).catch(() => {});
    await rpc("set_setting", { k: "storm_state", v: Object.fromEntries(Object.entries(state).filter(([k, v]) => k.includes(":lvl") || now - v < 48 * 3600e3)) });
    res.status(200).json({ ok: true, risky: scan.risky.length, fresh: fresh.length, sent, prepped });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
}
