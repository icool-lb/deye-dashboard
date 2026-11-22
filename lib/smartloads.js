// Smart load shedding: decide which customer loads (eWeLink switches) to turn off / back on from the live state,
// the battery-runtime estimate and the weather. Only loads the platform turned off are turned back on.
import { setSwitch } from "./ewelink.js";
import { rpc } from "./db.js";

// loads: [{ id, outlet, name, kw, priority, shedOnRuntime, shedBelowSoc, solarOnly }]
export function decide(loads, live, prevShed = {}) {
  const f = live.flow || {}, r = live.runtime || {};
  const external = f.gridOn || f.genOn;
  const surplus = (f.pv || 0) - (f.load || 0); // negative = deficit
  const want = {}; // id:outlet -> "off" | "on" | undefined (leave)
  const key = (l) => `${l.id}:${l.outlet ?? ""}`;
  const sorted = [...loads].sort((a, b) => (a.priority || 9) - (b.priority || 9));
  // 1) battery will not last until morning -> shed by priority until the needed reduction is covered
  if (r.ok && r.mode === "battery" && !r.lasts) {
    let need = r.reduceKw || 0;
    for (const l of sorted) { if (!l.shedOnRuntime || need <= 0) continue; want[key(l)] = { act: "off", why: `البطارية لن تكفي للصباح (تفصل ${r.cutAt})` }; need -= Number(l.kw) || 0.5; }
  }
  // 2) battery below a load's threshold while on battery
  for (const l of sorted) if (l.shedBelowSoc && !external && f.soc !== null && f.soc <= l.shedBelowSoc && !want[key(l)]) want[key(l)] = { act: "off", why: `البطارية ${f.soc}% (أقل من ${l.shedBelowSoc}%)` };
  // 3) solar-only loads (water heater, pump): on only with real solar surplus or the grid
  for (const l of sorted) if (l.solarOnly && !want[key(l)]) {
    const isShed = !!prevShed[key(l)];
    const extra = isShed ? 0 : Number(l.kw) || 0; // while running, its own draw is part of the load
    if (external || surplus + extra >= (Number(l.kw) || 0.5) * 0.9) { if (isShed) want[key(l)] = { act: "on", why: external ? "الدولة/المولد موجودة" : "فائض من الألواح" }; }
    else want[key(l)] = { act: "off", why: "لا يوجد فائض من الألواح" };
  }
  // 4) restore what we shed when the reason is gone
  for (const l of sorted) {
    const k = key(l);
    if (prevShed[k] && !want[k]) {
      const ok = external || (r.ok && (r.mode === "solar" || r.lasts)) && (!l.shedBelowSoc || (f.soc ?? 0) >= l.shedBelowSoc + 10);
      if (ok) want[k] = { act: "on", why: external ? "رجعت الكهرباء" : "البطارية تكفي الآن" };
    }
  }
  return want;
}

export async function applyLoads(stationId, loads, live, state) {
  const prev = state.shed || {};
  const want = decide(loads, live, prev);
  const done = [];
  for (const l of loads) {
    const k = `${l.id}:${l.outlet ?? ""}`, w = want[k];
    if (!w) continue;
    if (w.act === "off" && prev[k]) continue;
    if (w.act === "on" && !prev[k]) continue;
    try {
      await setSwitch(l.id, w.act === "on", l.outlet);
      if (w.act === "off") prev[k] = Date.now(); else delete prev[k];
      done.push({ name: l.name, act: w.act, why: w.why });
      await rpc("control_add", { station_id: Number(stationId), device_sn: `ewelink:${l.id}`, cmd: `load-${w.act}`, label: `${w.act === "off" ? "فصل" : "تشغيل"} ${l.name}`, payload: { why: w.why }, status: "done", by_user: "Smart Loads" }).catch(() => {});
    } catch (e) { done.push({ name: l.name, act: w.act, error: e.message }); }
  }
  state.shed = prev;
  return done;
}
