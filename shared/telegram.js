// Shared Telegram API utilities
// Extracted from worker.js and generate_worker.mjs to eliminate duplication.

export const TELEGRAM_API = "https://api.telegram.org";

export async function send(chatId, text, env) {
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
    });
    if (!res.ok) console.error("❌ Telegram API Error:", await res.text());
  } catch (e) {
    console.error("❌ SEND ERROR:", e);
  }
  return new Response("ok");
}

export async function sendWithKeyboard(chatId, text, keyboard, env) {
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard }
      })
    });
    if (!res.ok) console.error("❌ Telegram API Error:", await res.text());
  } catch (e) {
    console.error("❌ SENDKBD ERROR:", e);
  }
  return new Response("ok");
}
