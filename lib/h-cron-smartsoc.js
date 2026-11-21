// Smart minimum SoC (like Victron BatteryLife): every evening, for systems where it is enabled, set the battery
// reserve (SOC of all 6 time-of-use rows) for tomorrow from the solar forecast vs. the usual daily consumption.
// Sunny tomorrow -> lower reserve (use more battery tonight); cloudy -> keep a higher reserve.
import { stationList, stationDevices, addDays, today, round } from "./deye.js";
import { readSettings } from "./settings.js";
import { sendCommand } from "./control.js";
import { rpc, cronAuth } from "./db.js";
import { stationLL, forecastKwh } from "./weather.js";
import { tgSend, esc } from "./tg.js";

export async function planStation(st, cfg) {
  const kwp = Number(st.installedCapacity) || 0;
  const ll = await stationLL(st);
  const health = (await rpc("health_all").catch(() => []))?.find?.((h) => String(h.station_id) === String(st.id))?.data;
  const fc = (await forecastKwh(ll.lat, ll.lng, kwp, health?.prNow || 0.8))[0];
  const rows = (await rpc("daily", { station_id: Number(st.id), from: addDays(today(), -14), to: addDays(today(), -1) })) || [];
  const loads = rows.map((r) => Number(r.load_kwh)).filter((v) => v > 0);
  const load = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : null;
  if (!fc || !load) return { skip: "لا توجد بيانات توقع أو استهلاك" };
  const ratio = fc.kwh / load;
  const min = Number(cfg.min ?? 20), max = Number(cfg.max ?? 50);
  let target = ratio >= 1.3 ? min : ratio <= 0.6 ? max : max - ((ratio - 0.6) / 0.7) * (max - min);
  target = Math.round(target / 5) * 5;
  return { target, forecastKwh: fc.kwh, date: fc.date, loadKwh: round(load, 1), ratio: round(ratio, 2) };
}

export default async function handler(req, res) {
  if (!cronAuth(req, res)) return;
  const cfgAll = (await rpc("get_setting", { k: "smart_soc" })) || {};
  const ids = Object.keys(cfgAll).filter((k) => cfgAll[k]?.enabled);
  const stations = ids.length ? await stationList() : [];
  const log = [];
  for (const id of ids) {
    const st = stations.find((s) => String(s.id) === id); if (!st) continue;
    try {
      const plan = await planStation(st, cfgAll[id]);
      if (plan.skip) { log.push({ id, name: st.name, ...plan }); continue; }
      const invs = (await stationDevices(id)).filter((d) => /INVERTER/i.test(d.deviceType || ""));
      const settings = await Promise.all(invs.map((d) => readSettings(d.deviceSn).then((s) => ({ sn: d.deviceSn, s })).catch(() => null)));
      const ok = settings.filter(Boolean);
      if (!ok.length) { log.push({ id, name: st.name, skip: "تعذرت قراءة الإعدادات" }); continue; }
      if (ok.some((x) => x.s.touAction !== "on")) { log.push({ id, name: st.name, skip: "Time of Use مطفأ" }); continue; }
      const cur = Math.min(...ok[0].s.timeUseSettingItems.map((x) => Number(x.soc)));
      if (Math.abs(cur - plan.target) < 5) { log.push({ id, name: st.name, ...plan, current: cur, changed: false }); continue; }
      const r = [];
      for (const x of ok) {
        const items = x.s.timeUseSettingItems.map((it) => ({ ...it, soc: plan.target }));
        r.push(...(await sendCommand({ cmd: "touUpdate", sns: [x.sn], value: items, stationId: id, before: { soc: x.s.timeUseSettingItems.map((i) => i.soc) }, user: "Smart SoC" })).results);
      }
      log.push({ id, name: st.name, ...plan, current: cur, changed: true, ok: r.every((x) => x.ok) });
    } catch (e) { log.push({ id, name: st.name, error: e.message }); }
  }
  await rpc("set_setting", { k: "smart_soc_log", v: { at: new Date().toISOString(), log } });
  const ch = log.filter((l) => l.changed);
  if (ch.length) await tgSend(`🔋 <b>Smart SoC — احتياط البطارية لبكرا</b>\n` + ch.map((l) => `• ${esc(l.name)}: ${l.current}% ← ${l.target}% (توقع ${l.forecastKwh} kWh مقابل استهلاك ${l.loadKwh} kWh)${l.ok ? "" : " ⚠️ فشل"}`).join("\n")).catch(() => {});
  res.status(200).json({ ok: true, log });
}
