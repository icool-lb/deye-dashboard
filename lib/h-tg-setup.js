// Owner: connect the Telegram bot (webhook) and get the link that registers the owner's chat.
import { handler } from "./deye.js";
import { rpc } from "./db.js";
import { tgApi } from "./tg.js";
import { ownerTok, hookSecret } from "./tgtokens.js";
const BASE = process.env.PUBLIC_URL || "https://icool-deye-monitor.vercel.app";
export default handler(async () => {
  if (!process.env.TELEGRAM_TOKEN) return { configured: false, error: "TELEGRAM_TOKEN غير مضاف بعد" };
  const me = await tgApi("getMe");
  if (!me.ok) return { configured: false, error: "Token غير صالح: " + (me.description || "") };
  const hook = await tgApi("setWebhook", { url: `${BASE}/api/tg-webhook`, secret_token: hookSecret(), allowed_updates: ["message"] });
  await tgApi("setMyCommands", { commands: [{ command: "status", description: "حالة النظام الآن" }, { command: "stop", description: "إيقاف التنبيهات" }] });
  await rpc("set_setting", { k: "tg_bot", v: me.result.username });
  const chats = (await rpc("get_setting", { k: "telegram_chats" })) || [];
  return { configured: true, bot: me.result.username, webhook: hook.ok, ownerLink: `https://t.me/${me.result.username}?start=owner_${ownerTok()}`, ownerChats: chats.length };
});
