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
  STORY_TEXT: 'story_text',
  STORY_PHOTO: 'story_photo',
  EXIF_PHOTO: 'exif_photo',
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
    if (update.callback_query) return handleCallbackQuery(update.callback_query, env);
    if (!update.message) return;

    const chatId   = update.message.chat.id;
    const text     = (update.message.text || update.message.caption || "").trim();
    const name     = update.message.from?.first_name || "Kullanıcı";
    const photos   = update.message.photo || null;
    const stateKey = `user:${chatId}:state`;

    let state = { step: STATES.IDLE };
    const saved = await env.REMINDERS.get(stateKey);
    if (saved) {
      try {
        state = JSON.parse(saved);
      } catch (parseErr) {
        console.error("❌ Corrupt state for", stateKey, parseErr);
        await env.REMINDERS.delete(stateKey);
        state = { step: STATES.IDLE };
      }
    }

    // Global komutlar — state ne olursa olsun çalışır
    if (text === "/basarili") return handleBasarili(chatId, env);
    if (text === "/start") {
      await resetState(chatId, env);
      return sendStart(chatId, name, env);
    }
    if (text === "/exifdegis") {
      state = { step: STATES.EXIF_PHOTO, chatId };
      await saveState(chatId, state, env);
      return send(chatId, "📷 *EXIF Değiştir*\n\nFotoğrafı gönder, gerçekçi kamera bilgileriyle (marka, model, tarih, ISO, enstantane) yeniden paketleyeyim.", env);
    }

    if (state.step === STATES.IDLE) {
      if (text === "/yardim")          return send(chatId, helpMessage(), env);
      if (text === "/liste")           return handleList(chatId, env);
      if (text.startsWith("/sil"))     return handleDelete(text, chatId, env);
      if (text === "/brifing")             return handleBrifingAktif(chatId, env);
      if (text === "/brifingkapat")        return handleBrifingKapat(chatId, env);
      if (text === "/story" || text === "/story_sk" || text === "/story_remaz") {
        const brand = text === "/story_remaz" ? "remaz" : "selhattin";
        state = { step: STATES.STORY_TEXT, chatId, brand };
        await saveState(chatId, state, env);
        warmupImageService(env);
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
      case STATES.STORY_TEXT:        return handleStoryText(text, chatId, state, env);
      case STATES.STORY_PHOTO:       return handleStoryPhotoStep(text, chatId, state, env, photos);
      case STATES.EXIF_PHOTO:        return handleExifPhoto(chatId, state, env, photos);
    }

    return send(chatId, "⚠️ Beklenmeyen durum. `/start` ile yeniden başlayın.", env);
  } catch (err) {
    console.error("❌ WEBHOOK ERROR:", err);
    try {
      const chatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
      if (chatId) await send(chatId, "⚠️ Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin veya `/start` ile yeniden başlayın.", env);
    } catch (_) { /* best-effort notification */ }
  }
}

// ── Mesajlar ──────────────────────────────────────────────────────────────────
async function sendStart(chatId, name, env) {
  const text = `🤖 Merhaba *${name}*!\n\nNe yapmak istersiniz?`;
  const keyboard = [
    [
      { text: "📸 SK Story",    callback_data: "/story_sk"    },
      { text: "📸 Remaz Story", callback_data: "/story_remaz" }
    ],
    [
      { text: "⏰ Tek Hatırlatma",   callback_data: "/tekhatirlat"  },
      { text: "🔁 Aylık Hatırlatma", callback_data: "/herhatirlat"  }
    ],
    [
      { text: "📋 Liste",       callback_data: "/liste"    },
      { text: "📷 EXIF Değiştir", callback_data: "/exifdegis" }
    ],
    [
      { text: "📅 Brifing Aç",   callback_data: "/brifing"      },
      { text: "🔕 Brifing Kapat", callback_data: "/brifingkapat" }
    ]
  ];
  return sendWithKeyboard(chatId, text, keyboard, env);
}

async function handleCallbackQuery(query, env) {
  const chatId = query.message.chat.id;
  const name   = query.from?.first_name || "Kullanıcı";

  // Telegram spinner'ını kapat
  fetch(`${TELEGRAM_API}/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: query.id })
  }).catch(e => console.error("❌ answerCallbackQuery failed:", e));

  // Butona basıldığında mevcut akışı sıfırla, komutu çalıştır
  await resetState(chatId, env);
  return handleWebhook({
    message: { chat: { id: chatId }, from: query.from, text: query.data, photo: null }
  }, env);
}

function helpMessage() {
  return `
📌 */tekhatirlat* — Tek seferlik hatırlatma
📌 */herhatirlat* — Aylık tekrarlı hatırlatma
📌 */liste* — Hatırlatmaları listele
📌 */sil <ID>* — Hatırlatma sil
📌 */basarili* — Saat başı hatırlatmayı durdur

📌 */brifing* — Günlük sabah brifingi aç (her gün 08:00)
📌 */brifingkapat* — Günlük sabah brifingi kapat

📌 */story* — Instagram hikaye görseli oluştur
1\. `/story` yaz
2\. Metni gir
3\. Fotoğraf gönder veya *Hayır* yaz
4\. Görsel hazır ✅

📌 */exifdegis* — Fotoğrafın EXIF bilgilerini gerçekçi kamera verisiyle değiştir
1\. `/exifdegis` yaz
2\. Fotoğrafı gönder → EXIF güncellenmiş fotoğraf hazır ✅
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
  } catch (e) {
    console.error("❌ cleanupCountdownFlags failed for", baseKey, e);
  }
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

// ── Brifing ───────────────────────────────────────────────────────────────────
const TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const TR_DAYS   = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];

async function handleBrifingAktif(chatId, env) {
  await env.REMINDERS.put(`brifing:${chatId}`, JSON.stringify({ chatId }));
  const msg = await buildBrifingMessage(chatId, env);
  return send(chatId, `✅ *Günlük brifing aktif!* Her sabah 08:00'de gelecek.\n\n${msg}`, env);
}

async function handleBrifingKapat(chatId, env) {
  await env.REMINDERS.delete(`brifing:${chatId}`);
  return send(chatId, "🔕 Günlük brifing kapatıldı.", env);
}

async function buildBrifingMessage(chatId, env) {
  const now   = new Date();
  const nowTR = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const day   = nowTR.getUTCDate();
  const month = nowTR.getUTCMonth();
  const year  = nowTR.getUTCFullYear();
  const dow   = nowTR.getUTCDay();
  const nowMs = now.getTime();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  let msg = `📋 *Günlük Brifing*\n📅 ${day} ${TR_MONTHS[month]} ${year}, ${TR_DAYS[dow]}\n`;

  // Yaklaşan tek seferlik hatırlatmalar (7 gün içinde)
  const onceList = await env.REMINDERS.list({ prefix: `once:${chatId}:` });
  const upcoming = [];
  for (const key of onceList.keys) {
    try {
      const raw = await env.REMINDERS.get(key.name);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (!data.sent && data.targetTime > nowMs && data.targetTime <= nowMs + weekMs) {
        upcoming.push(data);
      }
    } catch (e) {
      console.error("❌ Corrupt briefing once entry:", key.name, e);
    }
  }

  if (upcoming.length > 0) {
    upcoming.sort((a, b) => a.targetTime - b.targetTime);
    msg += `\n⏰ *Bu Haftaki Hatırlatmalar:*\n`;
    for (const r of upcoming) {
      const d = new Date(r.targetTime + 3 * 60 * 60 * 1000);
      msg += `🔹 ${d.getUTCDate()}.${d.getUTCMonth()+1} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} — ${r.msg}\n`;
    }
  }

  // Bu ay içinde gelecek tekrarlı hatırlatmalar
  const recList = await env.REMINDERS.list({ prefix: `rec:${chatId}:` });
  const recItems = [];
  for (const key of recList.keys) {
    try {
      const raw = await env.REMINDERS.get(key.name);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (data.targetDay >= day) recItems.push(data);
    } catch (e) {
      console.error("❌ Corrupt briefing rec entry:", key.name, e);
    }
  }

  if (recItems.length > 0) {
    recItems.sort((a, b) => a.targetDay - b.targetDay);
    msg += `\n🔁 *Bu Ay Tekrarlı:*\n`;
    for (const r of recItems) {
      msg += `🔁 ${r.targetDay}. gün ${r.targetTime} — ${r.msg}\n`;
    }
  }

  if (upcoming.length === 0 && recItems.length === 0) {
    msg += `\n✨ Bu hafta için planlanmış hatırlatma yok.\n`;
  }

  msg += `\n📸 *Bugünkü Instagram içeriğini paylaşmayı unutma!*`;
  return msg;
}

async function sendDailyBrifing(env) {
  const nowTR    = new Date(new Date().getTime() + 3 * 60 * 60 * 1000);
  const hour     = nowTR.getUTCHours();
  const dateKey  = `${nowTR.getUTCFullYear()}-${nowTR.getUTCMonth()}-${nowTR.getUTCDate()}`;
  if (hour !== 8) return;

  const subs = await env.REMINDERS.list({ prefix: 'brifing:' });
  for (const key of subs.keys) {
    if (key.name.split(':').length !== 2) continue; // sadece brifing:{chatId}
    const sentKey = `${key.name}:sent:${dateKey}`;
    if (await env.REMINDERS.get(sentKey)) continue;
    try {
      const raw = await env.REMINDERS.get(key.name);
      if (!raw) continue;
      const data = JSON.parse(raw);
      const msg  = await buildBrifingMessage(data.chatId, env);
      await send(data.chatId, msg, env);
      await env.REMINDERS.put(sentKey, '1', { expirationTtl: 86400 });
    } catch (e) {
      console.error("❌ sendDailyBrifing failed for", key.name, e);
    }
  }
}

// ── Servis ısıtma ─────────────────────────────────────────────────────────────
function warmupImageService(env) {
  fetch(`${env.IMAGE_SERVICE_URL}/`).catch(e => console.error("❌ Image service warmup failed:", e));
}

// ── Story ─────────────────────────────────────────────────────────────────────

// Adım 1: metni al, fotoğraf adımına geç
async function handleStoryText(text, chatId, state, env) {
  if (!text || text.length < 2)
    return send(chatId, "❌ Metin çok kısa, tekrar girin:", env);
  if (text.length > 500)
    return send(chatId, `❌ Metin çok uzun (${text.length}/500 karakter). Lütfen kısaltın:`, env);
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
  await generateAndSendStory(state.storyText, chatId, env, hasPhoto ? photos : null, state.brand || "selhattin");
}

// Ortak üretim fonksiyonu — 3 stili paralel üretip album olarak gönderir
async function generateAndSendStory(storyText, chatId, env, photos, brand = "selhattin") {
  await send(chatId, "⏳ Görsel oluşturuluyor...", env);
  try {
    let photoB64 = null, photoWidth = null, photoHeight = null;
    if (photos && photos.length > 0) {
      const largest = photos[photos.length - 1];
      photoWidth  = largest.width;
      photoHeight = largest.height;
      const fileRes  = await fetch(`${TELEGRAM_API}/bot${env.BOT_TOKEN}/getFile?file_id=${largest.file_id}`);
      const fileData = await fileRes.json();
      if (fileData.ok && fileData.result?.file_path) {
        const photoRes = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${fileData.result.file_path}`);
        if (!photoRes.ok) {
          console.error("❌ Photo download failed:", photoRes.status);
          await send(chatId, "⚠️ Fotoğraf indirilemedi, fotoğrafsız devam ediliyor.", env);
        } else {
          photoB64 = bufToB64(await photoRes.arrayBuffer());
        }
      } else {
        console.error("❌ getFile failed:", JSON.stringify(fileData));
        await send(chatId, "⚠️ Fotoğraf alınamadı, fotoğrafsız devam ediliyor.", env);
      }
    }

    const imgRes = await fetch(`${env.IMAGE_SERVICE_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-secret': env.IMAGE_SECRET },
      body: JSON.stringify({ text: storyText, photoB64, photoWidth, photoHeight, brand })
    });
    if (!imgRes.ok) throw new Error(`Image service: ${imgRes.status}`);
    const pngBuf = await imgRes.arrayBuffer();

    const form = new FormData();
    form.append('chat_id',  String(chatId));
    form.append('document', new Blob([pngBuf], { type: 'image/png' }), 'story.png');
    form.append('caption',  "✅ Story görseliniz hazır!");
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

// ── EXIF Değiştir ─────────────────────────────────────────────────────────────
async function handleExifPhoto(chatId, state, env, photos) {
  if (!photos || photos.length === 0)
    return send(chatId, "📸 Lütfen bir fotoğraf gönderin (dosya olarak değil, fotoğraf olarak).", env);

  try {
    const largest  = photos[photos.length - 1];
    const fileRes  = await fetch(`${TELEGRAM_API}/bot${env.BOT_TOKEN}/getFile?file_id=${largest.file_id}`);
    const fileData = await fileRes.json();
    if (!fileData.ok || !fileData.result?.file_path) {
      console.error("❌ EXIF getFile failed:", JSON.stringify(fileData));
      await resetState(chatId, env);
      return send(chatId, "⚠️ Fotoğraf alınamadı. Tekrar deneyin.", env);
    }
    const photoRes = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${fileData.result.file_path}`);
    if (!photoRes.ok) {
      console.error("❌ EXIF photo download failed:", photoRes.status);
      await resetState(chatId, env);
      return send(chatId, "⚠️ Fotoğraf indirilemedi. Tekrar deneyin.", env);
    }
    const imageB64 = bufToB64(await photoRes.arrayBuffer());

    const imgRes = await fetch(`${env.IMAGE_SERVICE_URL}/exif`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-secret': env.IMAGE_SECRET || '' },
      body: JSON.stringify({ imageB64 }),
    });
    if (!imgRes.ok) throw new Error(`Image service: ${imgRes.status}`);

    const cameraName = imgRes.headers.get('X-Camera') || 'Kamera';
    const jpegBuf    = await imgRes.arrayBuffer();

    const form = new FormData();
    form.append('chat_id',  String(chatId));
    form.append('document', new Blob([jpegBuf], { type: 'image/jpeg' }), 'photo_exif.jpg');
    form.append('caption',  `✅ *EXIF güncellendi!*\n📷 ${cameraName}`);
    form.append('parse_mode', 'Markdown');

    const tgRes = await fetch(`${TELEGRAM_API}/bot${env.BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
    if (!tgRes.ok) {
      console.error("❌ sendDocument EXIF error:", await tgRes.text());
      await send(chatId, "⚠️ Fotoğraf gönderilemedi. Tekrar deneyin.", env);
    }
  } catch (err) {
    console.error("❌ EXIF ERROR:", err);
    await send(chatId, "⚠️ EXIF güncellenirken hata oluştu.", env);
  } finally {
    await resetState(chatId, env);
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
  await sendDailyBrifing(env);

  const list         = await env.REMINDERS.list();
  const now          = new Date();
  const nowTR        = new Date(now.getTime() + 3 * 60 * 60 * 1000); // UTC+3 (Türkiye)
  const today        = nowTR.getUTCDate();
  const currentMonth = nowTR.getUTCMonth();
  const currentYear  = nowTR.getUTCFullYear();
  const nowMinutes   = nowTR.getUTCHours() * 60 + nowTR.getUTCMinutes();
  const todayStr     = `${currentYear}-${currentMonth}-${today}`;

  for (const key of list.keys) {
    if (key.name.startsWith('user:') || key.name.startsWith('brifing:') || key.name.includes(':cd')) continue;
    let data;
    try { data = JSON.parse(await env.REMINDERS.get(key.name)); }
    catch (e) { console.error("❌ Corrupt cron entry:", key.name, e); continue; }

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

async function sendWithKeyboard(chatId, text, keyboard, env) {
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