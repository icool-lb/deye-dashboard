// After sending /start to the bot from Telegram, open this endpoint once to register your chat(s).
import { handler } from "./deye.js";
import { rpc } from "./db.js";
import { tgSend } from "./tg.js";
export default handler(async (q) => {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) return { error: "TELEGRAM_TOKEN غير مضاف بعد" };
  const j = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates`)).json();
  const chats = [...new Set((j.result || []).map((u) => (u.message || u.channel_post || {}).chat?.id).filter(Boolean).map(String))];
  const prev = (await rpc("get_setting", { k: "telegram_chats" })) || [];
  const all = [...new Set([...prev, ...chats])];
  await rpc("set_setting", { k: "telegram_chats", v: all });
  const t = await tgSend("✅ تم ربط هذه المحادثة بمنصة iCOOL Monitor — ستصلك التنبيهات هنا.");
  return { chats: all, test: t };
});
