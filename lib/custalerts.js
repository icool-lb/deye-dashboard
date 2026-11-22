// Customer alerts: compare the live snapshot with the last one and produce messages (grid/EDL, generator,
// battery levels, battery-runtime warning, offline).
import { esc } from "./tg.js";
export const DEFAULT_PREFS = { battLevels: [50, 30, 20], grid: true, gen: true, runtime: true, offline: true, full: false };
const f1 = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 1 }));

export function statusText(name, live) {
  const f = live.flow, r = live.runtime || {};
  const lines = [`<b>${esc(name)}</b>`,
    `☀️ الألواح ${f1(f.pv)} kW · 🏠 الاستهلاك ${f1(f.load)} kW`,
    `🔋 البطارية ${f.soc ?? "—"}%${f.bat > 0.05 ? ` (تفرّغ ${f1(f.bat)} kW)` : f.bat < -0.05 ? ` (تشحن ${f1(-f.bat)} kW)` : ""}`,
    `⚡ الدولة: ${f.gridOn ? "موجودة ✅" : "مقطوعة ❌"} · 🛠️ المولد: ${f.genOn ? "يعمل" : "متوقف"}`];
  if (r.ok) lines.push(runtimeLine(r));
  return lines.join("\n");
}
export function runtimeLine(r) {
  if (r.mode === "solar") return "☀️ الألواح تغطي الاستهلاك والبطارية تُشحن.";
  const pre = r.mode === "external" ? "إذا انقطعت الكهرباء الآن: " : "";
  if (r.lasts) return `✅ ${pre}البطارية تكفي حتى الصباح (${r.sunAt}) على الاستهلاك المعتاد.`;
  return `⚠️ ${pre}البطارية تكفي حتى حوالي <b>${r.cutAt}</b> فقط (تفصل عند ${r.cutoff}%). ليصمد النظام حتى ${r.sunAt} خفّف الاستهلاك إلى حوالي <b>${f1(r.targetLoadKw)} kW</b> (المعتاد ${f1(r.avgLoadKw)} kW، الآن ${f1(r.currentLoadKw)} kW).`;
}

export function diff(name, live, prev = {}, prefs = DEFAULT_PREFS, nowMs = Date.now()) {
  const f = live.flow, r = live.runtime || {}, msgs = [], st = { ...prev };
  const N = `<b>${esc(name)}</b>\n`;
  const fresh = f.ts && (nowMs / 1000 - f.ts) < 40 * 60;
  if (!fresh) {
    if (prefs.offline && !prev.offline && prev.ts) msgs.push(`${N}📡 النظام غير متصل بالإنترنت منذ أكثر من 40 دقيقة — لا تصل بيانات.`);
    st.offline = true; return { msgs, state: st };
  }
  if (prev.offline && prefs.offline) msgs.push(`${N}📡 عاد الاتصال بالنظام.`);
  st.offline = false;
  if (prev.ts && f.ts === prev.ts) return { msgs, state: st }; // no new reading
  const first = prev.gridOn === undefined;
  if (!first && prefs.grid && f.gridOn !== prev.gridOn) msgs.push(f.gridOn ? `${N}⚡ رجعت كهرباء الدولة.` : `${N}🔌 انقطعت كهرباء الدولة.${f.genOn ? "" : ` النظام على البطارية (${f.soc}%).`}${r.ok && !f.genOn ? "\n" + runtimeLine(r) : ""}`);
  if (!first && prefs.gen && f.genOn !== prev.genOn) msgs.push(f.genOn ? `${N}🛠️ اشتغل المولد.` : `${N}🛠️ توقف المولد.${!f.gridOn ? ` النظام على البطارية (${f.soc}%).` : ""}`);
  // battery levels (falling through a level), re-armed after rising 5% above it
  const fired = new Set(prev.fired || []);
  if (f.soc !== null) {
    for (const L of [...(prefs.battLevels || [])].sort((a, b) => b - a)) {
      if (f.soc <= L && !fired.has(L) && prev.soc !== undefined && prev.soc > L) { msgs.push(`${N}🔋 البطارية وصلت ${f.soc}%.${r.ok && r.mode !== "solar" ? "\n" + runtimeLine(r) : ""}`); fired.add(L); break; }
      if (f.soc >= L + 5) fired.delete(L);
    }
    for (const L of prefs.battLevels || []) if (f.soc <= L && prev.soc === undefined) fired.add(L);
    if (prefs.full && f.soc >= 100 && (prev.soc ?? 100) < 100) msgs.push(`${N}🔋 البطارية مشحونة 100%.`);
  }
  // runtime warning, once per night (re-sent if the cut time moves more than an hour earlier)
  if (prefs.runtime && r.ok && r.mode === "battery" && !r.lasts) {
    const night = new Date(nowMs + 6 * 3600e3).toISOString().slice(0, 10);
    const cutH = r.hoursLeft;
    if (prev.rtNight !== night || (prev.rtLeft !== undefined && cutH < prev.rtLeft - 1)) { msgs.push(`${N}${runtimeLine(r)}`); st.rtNight = night; st.rtLeft = cutH; }
  }
  Object.assign(st, { ts: f.ts, soc: f.soc, gridOn: f.gridOn, genOn: f.genOn, fired: [...fired] });
  return { msgs, state: st };
}
