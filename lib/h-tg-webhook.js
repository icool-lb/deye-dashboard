// Telegram webhook: /start owner_<tok> registers the owner; /start s<id>_<tok> subscribes a customer to a system;
// /status shows the live state of the customer's system(s); /stop unsubscribes.
import { rpc } from "./db.js";
import { tgTo } from "./tg.js";
import { ownerTok, hookSecret, parseSub } from "./tgtokens.js";
import { stationLive } from "./live.js";
import { statusText } from "./custalerts.js";

async function stationName(id) {
  const files = await rpc("sfile_get", { station_id: Number(id) }).catch(() => null);
  if (files?.data?.customerName) return files.data.customerName;
  const subs = await rpc("sub_list", { station_id: Number(id) }).catch(() => []);
  return subs?.[0]?.station_name || `#${id}`;
}

export default async function (req, res) {
  if (req.headers["x-telegram-bot-api-secret-token"] !== hookSecret()) return res.status(401).end();
  try {
    const m = (typeof req.body === "string" ? JSON.parse(req.body) : req.body)?.message;
    const chat = m?.chat?.id ? String(m.chat.id) : null, text = (m?.text || "").trim();
    if (!chat || !text) return res.status(200).json({ ok: true });
    const who = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.from?.username || "";
    if (text.startsWith("/start")) {
      const p = text.split(/\s+/)[1] || "";
      if (p === `owner_${ownerTok()}`) {
        const prev = (await rpc("get_setting", { k: "telegram_chats" })) || [];
        await rpc("set_setting", { k: "telegram_chats", v: [...new Set([...prev, chat])] });
        await tgTo(chat, "✅ تم ربط هذه المحادثة بمنصة iCOOL كمالك — ستصلك تنبيهات كل الأنظمة هنا.");
      } else if (parseSub(p)) {
        const id = parseSub(p);
        await rpc("sub_add", { chat_id: chat, station_id: Number(id), name: who });
        const name = await stationName(id);
        await tgTo(chat, `أهلاً ${who} 👋\nتم تفعيل تنبيهات نظام الطاقة الشمسية: <b>${name}</b>\n\nستصلك رسالة عند:\n⚡ انقطاع أو رجوع كهرباء الدولة\n🛠️ تشغيل أو توقف المولد\n🔋 وصول البطارية لنسب منخفضة\n⚠️ إذا كانت البطارية لن تكفي حتى الصباح، مع الحمل المناسب لتخفيفه\n\nاكتب /status لمعرفة حالة النظام الآن، و /stop لإيقاف التنبيهات.\n\niCOOL — COOL YOUR LIFE`);
      } else {
        await tgTo(chat, "أهلاً 👋 هذا بوت iCOOL لمتابعة أنظمة الطاقة الشمسية. استعمل الرابط الذي وصلك من iCOOL لتفعيل تنبيهات نظامك.");
      }
    } else if (text.startsWith("/status")) {
      const subs = (await rpc("sub_list", { chat_id: chat })) || [];
      if (!subs.length) await tgTo(chat, "لا يوجد نظام مرتبط بهذه المحادثة.");
      for (const s of subs) {
        const live = await stationLive(s.station_id).catch(() => null);
        await tgTo(chat, live?.flow?.ok ? statusText(await stationName(s.station_id), live) : "تعذرت قراءة النظام الآن، حاول بعد قليل.");
      }
    } else if (text.startsWith("/stop")) {
      await rpc("sub_del", { chat_id: chat });
      await tgTo(chat, "تم إيقاف التنبيهات. لإعادتها استعمل الرابط من iCOOL مرة أخرى.");
    }
  } catch (e) { /* always 200 so Telegram does not retry forever */ }
  res.status(200).json({ ok: true });
}
