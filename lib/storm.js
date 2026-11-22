// Thunderstorm / strong-wind early warning per system location from Open-Meteo hourly forecasts (free, global):
// WMO weather codes 95/96/99 = thunderstorm, CAPE = atmospheric instability, wind gusts for panel structures.
import { stationList } from "./deye.js";
import { rpc } from "./db.js";

const CELL = 0.25;
const cellKey = (la, ln) => `${(Math.round(la / CELL) * CELL).toFixed(2)},${(Math.round(ln / CELL) * CELL).toFixed(2)}`;

export async function stationsWithLL() {
  const [sts, locs] = await Promise.all([stationList(), rpc("get_setting", { k: "locations" }).catch(() => ({}))]);
  return sts.map((s) => {
    const o = locs?.[String(s.id)], la = o ? o[0] : Number(s.locationLat), ln = o ? o[1] : Number(s.locationLng);
    return la && ln ? { id: String(s.id), name: s.name, lat: la, lng: ln, online: Date.now() / 1000 - Number(s.lastUpdateTime || 0) < 3 * 86400 } : null;
  }).filter(Boolean);
}

export async function stormScan(hours = 6) {
  const st = await stationsWithLL();
  const cells = {};
  for (const s of st) { const k = cellKey(s.lat, s.lng); (cells[k] = cells[k] || { key: k, lat: Number(k.split(",")[0]), lng: Number(k.split(",")[1]), stations: [] }).stations.push(s); }
  const list = Object.values(cells);
  for (let i = 0; i < list.length; i += 50) {
    const part = list.slice(i, i + 50);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${part.map((c) => c.lat).join(",")}&longitude=${part.map((c) => c.lng).join(",")}&hourly=weather_code,cape,precipitation_probability,precipitation,wind_gusts_10m&forecast_hours=${hours}&timezone=Asia%2FBeirut`;
    const r = await fetch(url); if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
    let j = await r.json(); if (!Array.isArray(j)) j = [j];
    part.forEach((c, k) => {
      const h = j[k]?.hourly || {}; const T = h.time || [];
      const hrs = T.map((t, x) => ({ t: t.slice(11, 16), code: h.weather_code?.[x], cape: h.cape?.[x] || 0, pop: h.precipitation_probability?.[x] || 0, mm: h.precipitation?.[x] || 0, gust: h.wind_gusts_10m?.[x] || 0 }));
      const thunder = hrs.findIndex((x) => x.code >= 95);
      const unstable = hrs.findIndex((x) => x.cape >= 1200 && x.pop >= 50);
      const gustMax = Math.max(0, ...hrs.map((x) => x.gust));
      c.level = thunder >= 0 ? (thunder <= 2 ? "high" : "watch") : unstable >= 0 ? "possible" : null;
      c.startsIn = thunder >= 0 ? thunder : unstable >= 0 ? unstable : null;
      c.startsAt = c.startsIn !== null ? hrs[c.startsIn]?.t : null;
      c.hail = hrs.some((x) => x.code === 96 || x.code === 99);
      c.gustMax = Math.round(gustMax); c.wind = gustMax >= 70;
      c.capeMax = Math.round(Math.max(0, ...hrs.map((x) => x.cape))); c.rainMm = Math.round(hrs.reduce((a, x) => a + x.mm, 0));
      c.hours = hrs;
    });
  }
  return { at: new Date().toISOString(), cells: list, risky: list.filter((c) => c.level || c.wind) };
}

export function stormText(c, name) {
  const when = c.startsIn === 0 ? "الآن / خلال الساعة القادمة" : `خلال حوالي ${c.startsIn} ساعة (${c.startsAt})`;
  const head = c.level === "high" || c.level === "watch" ? `⛈️ عاصفة رعدية متوقعة ${when}${c.hail ? " مع احتمال بَرَد" : ""}` : c.level === "possible" ? `🌩️ أجواء غير مستقرة واحتمال عواصف رعدية ${when}` : "";
  const wind = c.wind ? `💨 رياح قوية حتى ${c.gustMax} كم/س` : "";
  return [name ? `<b>${name}</b>` : "", head, wind,
    "نصائح: افصل الأجهزة الحساسة عن الكهرباء، لا تلمس الألواح أو الكابلات أثناء البرق، وتأكد أن البطارية مشحونة في حال انقطعت الكهرباء." + (c.wind ? " تأكد من تثبيت الألواح والهيكل." : "")]
    .filter(Boolean).join("\n");
}
