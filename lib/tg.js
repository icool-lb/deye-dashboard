// Telegram notifications. Needs TELEGRAM_TOKEN; chat id comes from TELEGRAM_CHAT_ID or settings (set via /api/tg-setup).
import { rpc } from "./db.js";
export async function tgChats() {
  if (process.env.TELEGRAM_CHAT_ID) return process.env.TELEGRAM_CHAT_ID.split(",").map((x) => x.trim()).filter(Boolean);
  const v = await rpc("get_setting", { k: "telegram_chats" }).catch(() => null);
  return Array.isArray(v) ? v : [];
}
export async function tgSend(text) {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) return { ok: false, error: "no token" };
  const chats = await tgChats();
  const out = [];
  for (const chat_id of chats) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    out.push(await r.json());
  }
  return { ok: true, sent: out.length };
}
export const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
