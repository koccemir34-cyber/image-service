const TELEGRAM_API = "https://api.telegram.org";

const STATES = {
  IDLE: 'idle',
  ONCE_DATE: 'once_date',
  ONCE_TIME: 'once_time',
  ONCE_MESSAGE: 'once_message',
  ONCE_HOURLY: 'once_hourly',
  RECURRING_DAY: 'recurring_day',
  RECURRING_TIME: 'recurring_time',
  RECURRING_MESSAGE: 'recurring_message',
  REMINDER_HOURLY: 'reminder_hourly',
  DELETE_CONFIRM: 'delete_confirm',
  STORY_TEXT: 'story_text',
  STORY_PHOTO: 'story_photo'
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/")     return new Response("🤖 Telegram Hatırlatma Botu Aktif ✅");
    if (url.pathname === "/bot") {
      const update = await request.json().catch(() => null);
      if (update) ctx.waitUntil(handleWebhook(update, env));
      return new Response("ok");
    }
    if (url.pathname === "/cron") { await runCron(env); return new Response("✅ Cron çalıştı"); }
    return new Response("404 Not Found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    await runCron(env);
  }
};

// ── Webhook ───────────────────────────────────────────────────────────────────
async function handleWebhook(update, env) {
  try {
    if (!update.message) return;

    const chatId   = update.message.chat.id;
    const text     = (update.message.text || update.message.caption || "").trim();
    const name     = update.message.from?.first_name || "Kullanıcı";
    const photos   = update.message.photo || null;
    const stateKey = `user:${chatId}:state`;

    let state = { step: STATES.IDLE };
    const saved = await env.REMINDERS.get(stateKey);
    if (saved) state = JSON.parse(saved);

    if (state.step === STATES.IDLE) {
      if (text === "/start")           return send(chatId, startMessage(name), env);
      if (text === "/yardim")          return send(chatId, helpMessage(), env);
      if (text === "/liste")           return handleList(chatId, env);
      if (text === "/basarili")        return handleBasarili(chatId, env);
      if (text.startsWith("/sil"))     return handleDelete(text, chatId, env);
      if (text === "/story" || text.startsWith("/story")) {
        state = { step: STATES.STORY_TEXT, chatId };
        await saveState(chatId, state, env);
        return send(chatId, "📝 *Story Oluştur*\n\nGörsel üzerine yazılacak metni girin:", env);
      }

      if (text === "/tekhatirlat") {
        state = { step: STATES.ONCE_DATE, chatId };
        await env.REMINDERS.put(stateKey, JSON.stringify(state));
        return send(chatId, "📅 *Tek Seferlik Hatırlatma*\n\nLütfen tarihi girin:\n`GG.AA.YYYY` formatında\n\nÖrnek: `21.04.2026`", env);
      }
      if (text === "/herhatirlat") {
        state = { step: STATES.RECURRING_DAY, chatId };
        await env.REMINDERS.put(stateKey, JSON.stringify(state));
        return send(chatId, "🔁 *Aylık Tekrarlı Hatırlatma*\n\nHer ayın hangi gününde hatırlatayım?\n\nSadece gün numarası girin (1-31):\nÖrnek: `15`", env);
      }

      return send(chatId, "📋 Komutlar için `/start` yazın", env);
    }

    switch (state.step) {
      case STATES.ONCE_DATE:         return handleOnceDate(text, chatId, state, env);
      case STATES.ONCE_TIME:         return handleOnceTime(text, chatId, state, env);
      case STATES.ONCE_MESSAGE:      return handleOnceMessage(text, chatId, state, env);
      case STATES.ONCE_HOURLY:       return handleOnceHourly(text, chatId, state, env);
      case STATES.RECURRING_DAY:     return handleRecurringDay(text, chatId, state, env);
      case STATES.RECURRING_TIME:    return handleRecurringTime(text, chatId, state, env);
      case STATES.RECURRING_MESSAGE: return handleRecurringMessage(text, chatId, state, env);
      case STATES.REMINDER_HOURLY:   return handleReminderHourly(text, chatId, state, env);
      case STATES.DELETE_CONFIRM:    return resetState(chatId, env).then(() => send(chatId, "🔄 İşlem iptal edildi.", env));
      case STATES.STORY_TEXT:        return handleStoryText(text, chatId, state, env);
      case STATES.STORY_PHOTO:       return handleStoryPhotoStep(text, chatId, state, env, photos);
    }

    return send(chatId, "⚠️ Beklenmeyen durum. `/start` ile yeniden başlayın.", env);
  } catch (err) {
    console.error("❌ WEBHOOK ERROR:", err);
  }
}

// ── Mesajlar ──────────────────────────────────────────────────────────────────
function startMessage(name) {
  return `
🤖 Merhaba *${name}*!

🏗️ *Selhattin Koç İnşaat Taahhüt Botu*

📋 *Kullanılabilir Komutlar:*
/yardim - Yardım mesajı
/tekhatirlat - Tek seferlik hatırlatma oluştur
/herhatirlat - Her ay tekrar eden hatırlatma oluştur
/liste - Tüm hatırlatmalarını listele
/story - Instagram hikaye görseli oluştur (adım adım)
  `.trim();
}

function helpMessage() {
  return `
📌 */tekhatirlat* — Tek seferlik hatırlatma
📌 */herhatirlat* — Aylık tekrarlı hatırlatma
📌 */liste* — Hatırlatmaları listele
📌 */sil <ID>* — Hatırlatma sil
📌 */basarili* — Saat başı hatırlatmayı durdur

📌 */story* — Instagram hikaye görseli oluştur
1\. `/story` yaz
2\. Metni gir
3\. Fotoğraf gönder veya *Hayır* yaz
4\. Görsel hazır ✅
  `.trim();
}

// ── Liste ─────────────────────────────────────────────────────────────────────
async function handleList(chatId, env) {
  try {
    const list          = await env.REMINDERS.list({ prefix: `once:${chatId}:` });
    const recurringList = await env.REMINDERS.list({ prefix: `rec:${chatId}:` });
    const allReminders  = [...list.keys, ...recurringList.keys];

    if (allReminders.length === 0)
      return send(chatId, "📭 *Henüz hiç hatırlatman yok!*\n\n/tekhatirlat veya /herhatirlat ile oluşturabilirsin.", env);

    let message = "📋 *Aktif Hatırlatmaların:*\n\n";

    for (const key of list.keys) {
      const data = JSON.parse(await env.REMINDERS.get(key.name));
      if (data.sent && !data.hourlyActive) continue;
      const date = new Date(data.targetTime);
      const ds = `${date.getDate()}.${date.getMonth()+1}.${date.getFullYear()} ${date.getHours()}:${String(date.getMinutes()).padStart(2,'0')}`;
      message += `🔹 *\`ID: ${key.name.split(':')[2]}\`*\n   📅 ${ds}${data.hourly ? ' 🔄' : ''}\n   📝 ${data.msg}\n\n`;
    }
    for (const key of recurringList.keys) {
      const data = JSON.parse(await env.REMINDERS.get(key.name));
      message += `🔁 *\`ID: ${key.name.split(':')[2]}\`*\n   🗓️ Her ayın ${data.targetDay}. günü, ${data.targetTime}${data.hourly ? ' 🔄' : ''}\n   📝 ${data.msg}\n\n`;
    }

    message += `\n💡 *Silmek için:* \`/sil <ID>\` yaz`;
    return send(chatId, message, env);
  } catch (err) {
    return send(chatId, "⚠️ Liste yüklenirken hata oluştu.", env);
  }
}

// ── Sil ───────────────────────────────────────────────────────────────────────
async function handleDelete(text, chatId, env) {
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

async function cleanupCountdownFlags(baseKey, env) {
  try {
    const flags = await env.REMINDERS.list({ prefix: `${baseKey}:cd` });
    for (const flag of flags.keys) await env.REMINDERS.delete(flag.name);
  } catch (e) {}
}

// ── Başarılı ──────────────────────────────────────────────────────────────────
async function handleBasarili(chatId, env) {
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

// ── Story ─────────────────────────────────────────────────────────────────────

// Adım 1: metni al, fotoğraf adımına geç
async function handleStoryText(text, chatId, state, env) {
  if (!text || text.length < 2)
    return send(chatId, "❌ Metin çok kısa, tekrar girin:", env);
  state.storyText = text;
  state.step = STATES.STORY_PHOTO;
  await saveState(chatId, state, env);
  return send(chatId, `✅ Metin kaydedildi.\n\n📸 Şimdi bir *fotoğraf gönderin* ya da fotoğrafsız devam etmek için *Hayır* yazın.`, env);
}

// Adım 2: fotoğraf al (ya da geç) ve üret
async function handleStoryPhotoStep(text, chatId, state, env, photos) {
  const hasPhoto = photos && photos.length > 0;
  const skip     = ['hayır', 'hayir', 'h', 'geç', 'gec', 'atla', 'yok'].includes(text.trim().toLowerCase());
  if (!hasPhoto && !skip)
    return send(chatId, "📸 Fotoğraf gönderin veya *Hayır* yazın.", env);
  await resetState(chatId, env);
  await generateAndSendStory(state.storyText, chatId, env, hasPhoto ? photos : null);
}

// Ortak üretim fonksiyonu
async function generateAndSendStory(storyText, chatId, env, photos) {
  await send(chatId, "⏳ Görsel oluşturuluyor...", env);
  try {
    let photoB64 = null;
    if (photos && photos.length > 0) {
      const largest = photos[photos.length - 1];
      const fileRes  = await fetch(`${TELEGRAM_API}/bot${env.BOT_TOKEN}/getFile?file_id=${largest.file_id}`);
      const fileData = await fileRes.json();
      if (fileData.ok) {
        const photoRes = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${fileData.result.file_path}`);
        photoB64 = bufToB64(await photoRes.arrayBuffer());
      }
    }

    const imgRes = await fetch(`${env.IMAGE_SERVICE_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-secret': env.IMAGE_SECRET },
      body: JSON.stringify({ text: storyText, photoB64 })
    });
    if (!imgRes.ok) throw new Error(`Image service: ${imgRes.status}`);

    const pngBuf = await imgRes.arrayBuffer();
    const form   = new FormData();
    form.append('chat_id',  String(chatId));
    form.append('document', new Blob([pngBuf], { type: 'image/png' }), 'story.png');
    form.append('caption',  "✅ Story görseliniz hazır! Instagram'a yükleyebilirsiniz.");

    const tgRes = await fetch(`${TELEGRAM_API}/bot${env.BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
    if (!tgRes.ok) {
      console.error("❌ sendDocument error:", await tgRes.text());
      await send(chatId, "⚠️ Görsel gönderilemedi. Tekrar deneyin.", env);
    }
  } catch (err) {
    console.error("❌ STORY ERROR:", err);
    await send(chatId, "⚠️ Görsel oluşturulurken hata oluştu.", env);
  }
}

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk)
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

// ── Tek seferlik hatırlatma akışı ─────────────────────────────────────────────
async function handleOnceDate(text, chatId, state, env) {
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return send(chatId, "❌ *Format Hatalı!* `GG.AA.YYYY` — Örnek: `21.04.2026`", env);
  const [, day, month, year] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (isNaN(date.getTime()) || date.getDate() !== day || date.getMonth() !== month - 1)
    return send(chatId, "❌ *Geçersiz Tarih!*", env);
  state.parsedDate = { day, month, year };
  state.step = STATES.ONCE_TIME;
  await saveState(chatId, state, env);
  return send(chatId, `✅ Tarih: *${day}.${month}.${year}*\n\n⏰ Saati girin: \`SS:DD\` — Örnek: \`14:30\``, env);
}

async function handleOnceTime(text, chatId, state, env) {
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return send(chatId, "❌ *Format Hatalı!* `SS:DD` — Örnek: `14:30`", env);
  const [, hour, minute] = match.map(Number);
  if (hour > 23 || minute > 59) return send(chatId, "❌ *Geçersiz Saat!* 00-23 / 00-59 arası olmalı.", env);
  state.parsedTime = { hour, minute, string: `${hour}:${String(minute).padStart(2,'0')}` };
  state.step = STATES.ONCE_MESSAGE;
  await saveState(chatId, state, env);
  return send(chatId, `✅ Saat: *${state.parsedTime.string}*\n\n📝 Hatırlatılacak mesajı yazın:`, env);
}

async function handleOnceMessage(text, chatId, state, env) {
  if (!text || text.length < 3) return send(chatId, "❌ Mesaj en az 3 karakter olmalı.", env);
  state.message = text;
  state.step = STATES.ONCE_HOURLY;
  await saveState(chatId, state, env);
  return send(chatId, `✅ Mesaj: *${text}*\n\n🔄 Saat başı hatırlatayım mı? \`E\` / \`H\``, env);
}

async function handleOnceHourly(text, chatId, state, env) {
  const hourly = text.trim().toUpperCase() === 'E';
  const { day, month, year } = state.parsedDate;
  const { hour, minute }     = state.parsedTime;
  const remindDate = new Date(year, month - 1, day, hour, minute);
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

// ── Tekrarlı hatırlatma akışı ─────────────────────────────────────────────────
async function handleRecurringDay(text, chatId, state, env) {
  const day = parseInt(text);
  if (!day || day < 1 || day > 31) return send(chatId, "❌ 1-31 arası bir sayı girin.", env);
  state.targetDay = day;
  state.step = STATES.RECURRING_TIME;
  await saveState(chatId, state, env);
  return send(chatId, `✅ Her ayın *${day}.* günü\n\n⏰ Saati girin: \`SS:DD\` — Örnek: \`10:00\``, env);
}

async function handleRecurringTime(text, chatId, state, env) {
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return send(chatId, "❌ *Format Hatalı!* `SS:DD` — Örnek: `10:00`", env);
  const [, hour, minute] = match.map(Number);
  if (hour > 23 || minute > 59) return send(chatId, "❌ *Geçersiz Saat!*", env);
  state.parsedTime = { hour, minute, string: `${hour}:${String(minute).padStart(2,'0')}` };
  state.step = STATES.RECURRING_MESSAGE;
  await saveState(chatId, state, env);
  return send(chatId, `✅ Saat: *${state.parsedTime.string}*\n\n📝 Hatırlatılacak mesajı yazın:`, env);
}

async function handleRecurringMessage(text, chatId, state, env) {
  if (!text || text.length < 3) return send(chatId, "❌ Mesaj en az 3 karakter olmalı.", env);
  state.message = text;
  state.step = STATES.REMINDER_HOURLY;
  await saveState(chatId, state, env);
  return send(chatId, `✅ Mesaj: *${text}*\n\n🔄 Saat başı hatırlatayım mı? \`E\` / \`H\``, env);
}

async function handleReminderHourly(text, chatId, state, env) {
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

// ── State yönetimi ────────────────────────────────────────────────────────────
async function saveState(chatId, state, env) {
  await env.REMINDERS.put(`user:${chatId}:state`, JSON.stringify(state));
}
async function resetState(chatId, env) {
  await env.REMINDERS.delete(`user:${chatId}:state`);
}
function cryptoRandomId(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  for (let i = 0; i < len; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

// ── Cron ──────────────────────────────────────────────────────────────────────
async function runCron(env) {
  const list         = await env.REMINDERS.list();
  const now          = new Date();
  const today        = now.getDate();
  const currentMonth = now.getMonth();
  const currentYear  = now.getFullYear();
  const nowMinutes   = now.getHours() * 60 + now.getMinutes();
  const todayStr     = now.toDateString();

  for (const key of list.keys) {
    if (key.name.startsWith('user:') || key.name.includes(':cd')) continue;
    let data;
    try { data = JSON.parse(await env.REMINDERS.get(key.name)); }
    catch (e) { continue; }

    if (data.type === "once") {
      if (!data.sent && data.targetTime <= now.getTime()) {
        const msg = data.hourly
          ? `⏰ ${data.msg}\n\n🔔 Tamamlandıysa */basarili* yazın, yoksa saatte bir hatırlatmaya devam edeceğim.`
          : `⏰ ${data.msg}`;
        await send(data.chatId, msg, env);
        data.sent = true;
        if (data.hourly) { data.hourlyActive = true; data.awaitingConfirmation = true; data.lastHourlyAt = Date.now(); }
        await env.REMINDERS.put(key.name, JSON.stringify(data));
      }
      if (data.hourlyActive && data.awaitingConfirmation && Date.now() - (data.lastHourlyAt || 0) >= 3600000) {
        await send(data.chatId, `🔄 ${data.msg}\n\n🔔 Tamamlandıysa */basarili* yazın.`, env);
        data.lastHourlyAt = Date.now();
        await env.REMINDERS.put(key.name, JSON.stringify(data));
      }
    }

    if (data.type === "recurring") {
      const [tH, tM]     = data.targetTime.split(':').map(Number);
      const targetMinutes = tH * 60 + tM;

      if (data.targetDay > 2 && today === data.targetDay - 2) {
        const fk = `${key.name}:cd2:${currentYear}-${currentMonth}`;
        if (!(await env.REMINDERS.get(fk))) { await send(data.chatId, `📅 *2 gün kaldı:* ${data.msg}`, env); await env.REMINDERS.put(fk, "1"); }
      }
      if (data.targetDay > 1 && today === data.targetDay - 1) {
        const fk = `${key.name}:cd1:${currentYear}-${currentMonth}`;
        if (!(await env.REMINDERS.get(fk))) { await send(data.chatId, `📅 *1 gün kaldı:* ${data.msg}`, env); await env.REMINDERS.put(fk, "1"); }
      }

      if (today === data.targetDay) {
        if (nowMinutes >= targetMinutes && data.lastSent !== todayStr) {
          const msg = data.hourly
            ? `🔁 ${data.msg}\n\n🔔 Tamamlandıysa */basarili* yazın, yoksa saatte bir hatırlatmaya devam edeceğim.`
            : `🔁 ${data.msg}`;
          await send(data.chatId, msg, env);
          data.lastSent = todayStr;
          if (data.hourly) { data.hourlyActive = true; data.awaitingConfirmation = true; data.lastHourlyAt = Date.now(); }
          await env.REMINDERS.put(key.name, JSON.stringify(data));
        }
        if (data.hourly && data.hourlyActive && data.awaitingConfirmation && Date.now() - (data.lastHourlyAt || 0) >= 3600000) {
          await send(data.chatId, `🔄 ${data.msg}\n\n🔔 Tamamlandıysa */basarili* yazın.`, env);
          data.lastHourlyAt = Date.now();
          await env.REMINDERS.put(key.name, JSON.stringify(data));
        }
      }
    }
  }
}

// ── Telegram send ─────────────────────────────────────────────────────────────
async function send(chatId, text, env) {
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