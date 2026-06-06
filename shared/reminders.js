// Shared reminder handler utilities
// Extracted from worker.js and generate_worker.mjs to eliminate duplication.
// These functions were nearly identical in both files.

import { send } from './telegram.js';

export async function handleList(chatId, env) {
  try {
    const list          = await env.REMINDERS.list({ prefix: `once:${chatId}:` });
    const recurringList = await env.REMINDERS.list({ prefix: `rec:${chatId}:` });
    const allReminders  = [...list.keys, ...recurringList.keys];

    if (allReminders.length === 0)
      return send(chatId, "📭 *Henüz hiç hatırlatman yok!*\n\n/tekhatirlat veya /herhatirlat ile oluşturabilirsin.", env);

    let message = "📋 *Aktif Hatırlatmaların:*\n\n";

    for (const key of list.keys) {
      try {
        const raw = await env.REMINDERS.get(key.name);
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (data.sent && !data.hourlyActive) continue;
        const date = new Date(data.targetTime);
        const ds = `${date.getDate()}.${date.getMonth()+1}.${date.getFullYear()} ${date.getHours()}:${String(date.getMinutes()).padStart(2,'0')}`;
        message += `🔹 *\`ID: ${key.name.split(':')[2]}\`*\n   📅 ${ds}${data.hourly ? ' 🔄' : ''}\n   📝 ${data.msg}\n\n`;
      } catch (e) {
        console.error("❌ Corrupt reminder entry:", key.name, e);
      }
    }
    for (const key of recurringList.keys) {
      try {
        const raw = await env.REMINDERS.get(key.name);
        if (!raw) continue;
        const data = JSON.parse(raw);
        message += `🔁 *\`ID: ${key.name.split(':')[2]}\`*\n   🗓️ Her ayın ${data.targetDay}. günü, ${data.targetTime}${data.hourly ? ' 🔄' : ''}\n   📝 ${data.msg}\n\n`;
      } catch (e) {
        console.error("❌ Corrupt recurring entry:", key.name, e);
      }
    }

    message += `\n💡 *Silmek için:* \`/sil <ID>\` yaz`;
    return send(chatId, message, env);
  } catch (err) {
    console.error("❌ handleList error:", err);
    return send(chatId, "⚠️ Liste yüklenirken hata oluştu.", env);
  }
}

export async function handleDelete(text, chatId, env) {
  const reminderId = text.replace('/sil', '').trim();
  if (!reminderId) return send(chatId, "❌ *Kullanım:* `/sil <ID>`", env);

  for (const prefix of [`once:${chatId}:`, `rec:${chatId}:`]) {
    const key  = prefix + reminderId;
    const data = await env.REMINDERS.get(key);
    if (data) {
      await env.REMINDERS.delete(key);
      await cleanupCountdownFlags(key, env);
      return send(chatId, `✅ *\`${reminderId}\`* silindi. 🗑️`, env);
    }
  }
  return send(chatId, `❌ *\`${reminderId}\`* bulunamadı. /liste ile kontrol et.`, env);
}

export async function cleanupCountdownFlags(baseKey, env) {
  try {
    const flags = await env.REMINDERS.list({ prefix: `${baseKey}:cd` });
    for (const flag of flags.keys) await env.REMINDERS.delete(flag.name);
  } catch (e) {
    console.error("❌ cleanupCountdownFlags failed for", baseKey, e);
  }
}

export async function handleBasarili(chatId, env) {
  const onceList = await env.REMINDERS.list({ prefix: `once:${chatId}:` });
  const recList  = await env.REMINDERS.list({ prefix: `rec:${chatId}:` });
  let confirmed  = 0;

  for (const key of [...onceList.keys, ...recList.keys]) {
    const raw = await env.REMINDERS.get(key.name);
    if (!raw) continue;
    const data = JSON.parse(raw);
    if (data.awaitingConfirmation) {
      data.awaitingConfirmation = false;
      data.hourlyActive = false;
      await env.REMINDERS.put(key.name, JSON.stringify(data));
      confirmed++;
    }
  }

  return confirmed > 0
    ? send(chatId, "✅ *Tamamlandı!* Saat başı hatırlatma durduruldu. 👍", env)
    : send(chatId, "⚠️ Şu an onay bekleyen aktif hatırlatma yok.", env);
}
