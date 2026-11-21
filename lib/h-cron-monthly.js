// 1st of each month: Telegram message to the owner with one-tap WhatsApp links to send each customer their
// monthly report + live portal link.
import { stationList, addDays, today } from "./deye.js";
import { rpc, cronAuth } from "./db.js";
import { portalToken } from "./portal.js";
import { tgSend, esc } from "./tg.js";
const BASE = process.env.PUBLIC_URL || "https://icool-deye-monitor.vercel.app";
const AR = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
export const phoneLb = (p) => { let d = String(p || "").replace(/\D/g, ""); if (!d) return null; if (d.startsWith("00")) d = d.slice(2); if (d.startsWith("0")) d = d.slice(1); if (d.length <= 8) d = "961" + d; return d.length >= 10 ? d : null; };
export function customerLinks(st, file, month) {
  const t = portalToken(st.id);
  const report = `${BASE}/api/report?id=${st.id}&month=${month}&price=${file.price || 0.3}&t=${t}`;
  const portal = `${BASE}/c.html?s=${st.id}&t=${t}`;
  const name = file.customerName || st.ownerName || "";
  const [y, m] = month.split("-").map(Number);
  const text = `مرحباً ${name}،\nتقرير نظام الطاقة الشمسية لشهر ${AR[m - 1]} ${y}:\n${report}\n\nمتابعة النظام مباشرة:\n${portal}\n\niCOOL — COOL YOUR LIFE`;
  const phone = phoneLb(file.phone || st.contactPhone);
  return { report, portal, wa: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`, phone };
}
export default async function handler(req, res) {
  if (!cronAuth(req, res)) return;
  const month = addDays(`${today().slice(0, 7)}-01`, -1).slice(0, 7);
  const files = (await rpc("sfile_all")) || {};
  const sts = (await stationList()).filter((s) => Date.now() / 1000 - Number(s.lastUpdateTime || 0) < 35 * 86400 && files[s.id]?.monthlyReport !== false);
  const lines = sts.map((s) => { const l = customerLinks(s, files[s.id] || {}, month); return `• <a href="${esc(l.wa)}">${esc((files[s.id]?.customerName) || s.name)}</a>${l.phone ? "" : " (بدون رقم)"}`; });
  for (let i = 0; i < lines.length; i += 40) await tgSend(`📄 <b>تقارير ${month}</b> — اضغط على اسم الزبون لإرسال التقرير على واتساب:\n` + lines.slice(i, i + 40).join("\n")).catch(() => {});
  res.status(200).json({ ok: true, month, customers: sts.length });
}
