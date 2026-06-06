// Shared reminder creation flow handlers
// Extracted from worker.js and generate_worker.mjs to eliminate duplication.
// These step-by-step handlers for /tekhatirlat and /herhatirlat flows
// were nearly identical in both files.

import { send } from './telegram.js';
import { saveState, resetState, cryptoRandomId } from './state.js';

// ── Tek seferlik hatirlatma akisi ─────────────────────────────────────────────

export async function handleOnceDate(text, chatId, state, env) {
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return send(chatId, "❌ *Format Hatalı!* `GG.AA.YYYY` — Örnek: `21.04.2026`", env);
  const [, day, month, year] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (isNaN(date.getTime()) || date.getDate() !== day || date.getMonth() !== month - 1)
    return send(chatId, "❌ *Geçersiz Tarih!*", env);
  state.parsedDate = { day, month, year };
  state.step = 'once_time';
  await saveState(chatId, state, env);
  return send(chatId, `✅ Tarih: *${day}.${month}.${year}*\n\n⏰ Saati girin: \`SS:DD\` — Örnek: \`14:30\``, env);
}

export async function handleOnceTime(text, chatId, state, env) {
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return send(chatId, "❌ *Format Hatalı!* `SS:DD` — Örnek: `14:30`", env);
  const [, hour, minute] = match.map(Number);
  if (hour > 23 || minute > 59) return send(chatId, "❌ *Geçersiz Saat!* 00-23 / 00-59 arası olmalı.", env);
  state.parsedTime = { hour, minute, string: `${hour}:${String(minute).padStart(2,'0')}` };
  state.step = 'once_message';
  await saveState(chatId, state, env);
  return send(chatId, `✅ Saat: *${state.parsedTime.string}*\n\n📝 Hatırlatılacak mesajı yazın:`, env);
}

export async function handleOnceMessage(text, chatId, state, env) {
  if (!text || text.length < 3) return send(chatId, "❌ Mesaj en az 3 karakter olmalı.", env);
  state.message = text;
  state.step = 'once_hourly';
  await saveState(chatId, state, env);
  return send(chatId, `✅ Mesaj: *${text}*\n\n🔄 Saat başı hatırlatayım mı? \`E\` / \`H\``, env);
}

export async function handleOnceHourly(text, chatId, state, env) {
  const hourly = text.trim().toUpperCase() === 'E';
  const { day, month, year } = state.parsedDate;
  const { hour, minute }     = state.parsedTime;
  const remindDate = new Date(Date.UTC(year, month - 1, day, hour - 3, minute));
  if (remindDate < new Date()) {
    await resetState(chatId, env);
    return send(chatId, "❌ *Geçmiş tarih!* Lütfen yeni bir hatırlatma oluşturun.", env);
  }
  const reminderId = cryptoRandomId(8);
  await env.REMINDERS.put(`once:${chatId}:${reminderId}`, JSON.stringify({
    type: "once", chatId, msg: state.message,
    targetTime: remindDate.getTime(), hourly, sent: false, createdAt: Date.now()
  }));
  await resetState(chatId, env);
  return send(chatId, `✅ *Hatırlatma Kuruldu!*\n🆔 \`${reminderId}\`\n📅 ${day}.${month}.${year} ${hour}:${String(minute).padStart(2,'0')}\n📝 ${state.message}${hourly ? '\n🔄 Saat başı: *AKTİF*' : ''}`, env);
}

// ── Tekrarli hatirlatma akisi ─────────────────────────────────────────────────

export async function handleRecurringDay(text, chatId, state, env) {
  const day = parseInt(text);
  if (!day || day < 1 || day > 31) return send(chatId, "❌ 1-31 arası bir sayı girin.", env);
  state.targetDay = day;
  state.step = 'recurring_time';
  await saveState(chatId, state, env);
  return send(chatId, `✅ Her ayın *${day}.* günü\n\n⏰ Saati girin: \`SS:DD\` — Örnek: \`10:00\``, env);
}

export async function handleRecurringTime(text, chatId, state, env) {
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return send(chatId, "❌ *Format Hatalı!* `SS:DD` — Örnek: `10:00`", env);
  const [, hour, minute] = match.map(Number);
  if (hour > 23 || minute > 59) return send(chatId, "❌ *Geçersiz Saat!*", env);
  state.parsedTime = { hour, minute, string: `${hour}:${String(minute).padStart(2,'0')}` };
  state.step = 'recurring_message';
  await saveState(chatId, state, env);
  return send(chatId, `✅ Saat: *${state.parsedTime.string}*\n\n📝 Hatırlatılacak mesajı yazın:`, env);
}

export async function handleRecurringMessage(text, chatId, state, env) {
  if (!text || text.length < 3) return send(chatId, "❌ Mesaj en az 3 karakter olmalı.", env);
  state.message = text;
  state.step = 'reminder_hourly';
  await saveState(chatId, state, env);
  return send(chatId, `✅ Mesaj: *${text}*\n\n🔄 Saat başı hatırlatayım mı? \`E\` / \`H\``, env);
}

export async function handleReminderHourly(text, chatId, state, env) {
  const hourly = text.trim().toUpperCase() === 'E';
  const reminderId = cryptoRandomId(8);
  await env.REMINDERS.put(`rec:${chatId}:${reminderId}`, JSON.stringify({
    type: "recurring", chatId, msg: state.message,
    targetDay: state.targetDay, targetTime: state.parsedTime.string,
    hourly, lastSent: null, createdAt: Date.now()
  }));
  await resetState(chatId, env);
  return send(chatId, `✅ *Aylık Hatırlatma Kuruldu!*\n🆔 \`${reminderId}\`\n🔁 Her ayın ${state.targetDay}. günü ${state.parsedTime.string}\n📝 ${state.message}${hourly ? '\n🔄 Saat başı: *AKTİF*' : ''}\n⚠️ 2 gün ve 1 gün öncesinde otomatik ön hatırlatma!`, env);
}
