const TELEGRAM_API = 'https://api.telegram.org';
const MAX_TEXT_LENGTH = 950;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

const STEPS = {
  STORY_TEXT: 'story_text',
  STORY_PHOTO: 'story_photo',
  SETTINGS_LIKES: 'settings_likes',
  SETTINGS_COMMENTS: 'settings_comments',
  SETTINGS_REPOSTS: 'settings_reposts'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return Response.json({ ok: true, service: 'SK Story webhook active' });
    }

    if (url.pathname === '/health') {
      return Response.json({ ok: true, worker: 'skstory-cloudflare-7x24' });
    }

    if (url.pathname === '/bot' && request.method === 'POST') {
      const webhookSecret = String(env.WEBHOOK_SECRET || '');
      const incomingSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';

      if (!webhookSecret || incomingSecret !== webhookSecret) {
        return new Response('forbidden', { status: 403 });
      }

      const update = await request.json().catch(() => null);
      if (!update) return new Response('bad request', { status: 400 });

      // Keep the webhook request alive while the PNG is rendered. This avoids a
      // short background-task deadline during an occasional Render cold start.
      await handleUpdate(update, env);
      return new Response('ok');
    }

    return new Response('not found', { status: 404 });
  },

  async scheduled(_controller, env, ctx) {
    // Render's free instance sleeps after inactivity. A ten-minute health ping
    // keeps this existing image service warm while the Worker remains stateless.
    ctx.waitUntil(warmImageService(env));
  }
};

async function handleUpdate(update, env) {
  try {
    const message = update?.message;
    if (!message?.chat || !message?.from) return;

    const chatId = String(message.chat.id);
    const userId = String(message.from.id);
    const key = `${chatId}:${userId}`;
    const text = typeof message.text === 'string' ? message.text : '';
    const normalizedText = normalize(text);

    if (isCommand(normalizedText, '/start')) {
      await clearSession(key, env);
      return sendMessage(chatId, [
        'Merhaba.',
        '',
        '/skstory yaz, metni gönder, ardından fotoğrafı gönder.',
        'Fotoğraf yoksa “Foto yok” yaz.',
        '',
        'Etkileşim sayılarını ayarlamak için /ayarlar,',
        'tekrar rastgele yapmak için /ayarlarsifirla yaz.'
      ].join('\n'), env, removeKeyboard());
    }

    if (isCancel(normalizedText)) {
      await clearSession(key, env);
      return sendMessage(chatId, 'İşlem iptal edildi.', env, removeKeyboard());
    }

    if (isCommand(normalizedText, '/ayarlarsifirla') || isCommand(normalizedText, '/ayarlarsıfırla')) {
      await env.REMINDERS.put(settingsKey(key), JSON.stringify({ mode: 'random', updatedAt: new Date().toISOString() }));
      await clearSession(key, env);
      return sendMessage(chatId, [
        '🎲 Etkileşim ayarları sıfırlandı.',
        '',
        'Bundan sonraki görsellerde beğeni 80–10.000; yorum/yanıt ve repost ise 1–300 arasında daha doğal oranlarla rastgele üretilecek.'
      ].join('\n'), env, removeKeyboard());
    }

    if (isCommand(normalizedText, '/ayarlar')) {
      await saveSession(key, { flow: 'settings', step: STEPS.SETTINGS_LIKES }, env);
      return sendMessage(chatId, [
        '📊 Görsel etkileşim ayarları',
        '',
        '1/3 — Beğeni sayısı kaç olsun?',
        '',
        '0 ile 999.999 arasında bir sayı yaz.',
        'Örnek: 2500, 10.000 veya 2.5K',
        '',
        'İptal için “İptal” veya /iptal yaz.'
      ].join('\n'), env, oneTimeKeyboard([['İptal']]));
    }

    if (isCommandInvocation(text, '/skstory')) {
      const immediateText = commandRemainder(text, '/skstory');

      if (immediateText) {
        if (immediateText.length > MAX_TEXT_LENGTH) {
          return sendMessage(chatId, `Metin çok uzun. En fazla ${MAX_TEXT_LENGTH} karakter olabilir.`, env);
        }

        await saveSession(key, { flow: 'story', step: STEPS.STORY_PHOTO, text: immediateText }, env);
        return sendMessage(chatId, 'Metni aldım. Fotoğraf varsa şimdi gönder. Yoksa “Foto yok” yaz.', env, oneTimeKeyboard([['Foto yok'], ['İptal']]));
      }

      await saveSession(key, { flow: 'story', step: STEPS.STORY_TEXT }, env);
      return sendMessage(chatId, [
        'SK Story için metni gönder.',
        '',
        'Gönderdiğin satır ve paragraf düzeni görselde mümkün olduğunca korunur.'
      ].join('\n'), env, oneTimeKeyboard([['İptal']]));
    }

    const session = await getSession(key, env);

    if (!session) {
      return sendMessage(chatId, 'Görsel oluşturmak için /skstory yaz. Etkileşim sayılarını ayarlamak için /ayarlar yaz.', env);
    }

    if (session.flow === 'settings') {
      return handleSettingsInput({ chatId, key, text, session, env });
    }

    if (session.flow === 'story') {
      return handleStoryInput({ chatId, key, message, text, normalizedText, session, env });
    }
  } catch (error) {
    console.error('Webhook error:', error);
  }
}

async function handleSettingsInput({ chatId, key, text, session, env }) {
  const value = parseCount(text);

  if (value === null) {
    return sendMessage(chatId, 'Geçerli bir sayı yaz. 0 ile 999.999 arasında olmalı. Örnek: 2500, 10.000 veya 2.5K', env);
  }

  if (session.step === STEPS.SETTINGS_LIKES) {
    await saveSession(key, { flow: 'settings', step: STEPS.SETTINGS_COMMENTS, likes: value }, env);
    return sendMessage(chatId, `❤️ Beğeni: ${formatCount(value)}\n\n2/3 — Yorum / yanıt sayısı kaç olsun?\n\nÖrnek: 85`, env);
  }

  if (session.step === STEPS.SETTINGS_COMMENTS) {
    await saveSession(key, { flow: 'settings', step: STEPS.SETTINGS_REPOSTS, likes: session.likes, comments: value }, env);
    return sendMessage(chatId, `💬 Yorum / yanıt: ${formatCount(value)}\n\n3/3 — Repost sayısı kaç olsun?\n\nÖrnek: 34`, env);
  }

  if (session.step === STEPS.SETTINGS_REPOSTS) {
    const settings = {
      mode: 'manual',
      likes: session.likes,
      comments: session.comments,
      reposts: value,
      updatedAt: new Date().toISOString()
    };

    await env.REMINDERS.put(settingsKey(key), JSON.stringify(settings));
    await clearSession(key, env);

    return sendMessage(chatId, [
      '✅ Etkileşim ayarları kaydedildi.',
      '',
      `❤️ Beğeni: ${formatCount(settings.likes)}`,
      `💬 Yorum / yanıt: ${formatCount(settings.comments)}`,
      `🔁 Repost: ${formatCount(settings.reposts)}`,
      '',
      'Yeni oluşturacağın tüm SK Story görsellerinde bu sayılar kullanılacak.'
    ].join('\n'), env, removeKeyboard());
  }
}

async function handleStoryInput({ chatId, key, message, text, normalizedText, session, env }) {
  if (session.step === STEPS.STORY_TEXT) {
    const storyText = text.trim();

    if (!storyText) return sendMessage(chatId, 'Metin boş olamaz. Tekrar yaz.', env);
    if (storyText.length > MAX_TEXT_LENGTH) return sendMessage(chatId, `Metin çok uzun. En fazla ${MAX_TEXT_LENGTH} karakter olabilir.`, env);

    await saveSession(key, { flow: 'story', step: STEPS.STORY_PHOTO, text: storyText }, env);
    return sendMessage(chatId, 'Metni aldım. Fotoğraf varsa şimdi gönder. Yoksa “Foto yok” yaz.', env, oneTimeKeyboard([['Foto yok'], ['İptal']]));
  }

  if (session.step !== STEPS.STORY_PHOTO) return;

  if (isNoPhoto(normalizedText)) {
    return generateAndSend({ chatId, key, storyText: session.text, photo: null, env });
  }

  const file = getImageFile(message);

  if (!file) {
    if (message.document && !String(message.document.mime_type || '').startsWith('image/')) {
      return sendMessage(chatId, 'Bu dosya görsel değil. PNG/JPG olarak gönder.', env);
    }

    return sendMessage(chatId, 'Fotoğraf gönderebilirsin. Fotoğraf yoksa “Foto yok” yaz.', env);
  }

  if (Number(file.file_size || 0) > MAX_PHOTO_BYTES) {
    return sendMessage(chatId, 'Fotoğraf çok büyük. En fazla 12 MB görsel gönder.', env);
  }

  return generateAndSend({ chatId, key, storyText: session.text, photo: file, env });
}

async function generateAndSend({ chatId, key, storyText, photo, env }) {
  try {
    await sendChatAction(chatId, 'upload_photo', env);
    await sendMessage(chatId, '⏳ SK Story hazırlanıyor...', env, removeKeyboard());

    const [photoB64, engagementSettings] = await Promise.all([
      photo ? downloadTelegramPhoto(photo.file_id, env) : Promise.resolve(null),
      getEngagementSettings(key, env)
    ]);

    const response = await fetch(`${String(env.IMAGE_SERVICE_URL).replace(/\/$/, '')}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-secret': String(env.IMAGE_SECRET || '')
      },
      body: JSON.stringify({
        text: storyText,
        photoB64,
        engagementSettings
      })
    });

    if (!response.ok) {
      throw new Error(`Image service ${response.status}: ${await response.text()}`);
    }

    const image = await response.arrayBuffer();
    await sendPhoto(chatId, image, env);
    await clearSession(key, env);
  } catch (error) {
    console.error('Generate error:', error);
    await clearSession(key, env);
    await sendMessage(chatId, '⚠️ Görsel oluşturulurken hata oluştu. Birkaç dakika sonra tekrar dene.', env, removeKeyboard());
  }
}

async function downloadTelegramPhoto(fileId, env) {
  const metaRes = await fetch(`${TELEGRAM_API}/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const meta = await metaRes.json();

  if (!meta?.ok || !meta?.result?.file_path) {
    throw new Error('Telegram fotoğraf bağlantısı alınamadı.');
  }

  const photoRes = await fetch(`${TELEGRAM_API}/file/bot${env.BOT_TOKEN}/${meta.result.file_path}`);
  if (!photoRes.ok) throw new Error(`Telegram fotoğraf indirilemedi: ${photoRes.status}`);

  const bytes = new Uint8Array(await photoRes.arrayBuffer());
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new Error('Fotoğraf boyutu sınırı aşıyor.');

  return bytesToBase64(bytes);
}

async function getEngagementSettings(key, env) {
  const raw = await env.REMINDERS.get(settingsKey(key));
  if (!raw) return null;

  try {
    const data = JSON.parse(raw);
    return data?.mode === 'manual' || data?.mode === 'random' ? data : null;
  } catch {
    return null;
  }
}

async function getSession(key, env) {
  const raw = await env.REMINDERS.get(sessionKey(key));
  if (!raw) return null;

  try { return JSON.parse(raw); } catch { return null; }
}

async function saveSession(key, data, env) {
  await env.REMINDERS.put(sessionKey(key), JSON.stringify(data), { expirationTtl: 7200 });
}

async function clearSession(key, env) {
  await env.REMINDERS.delete(sessionKey(key));
}

function sessionKey(key) { return `skstory:session:${key}`; }
function settingsKey(key) { return `skstory:engagement:${key}`; }

function commandRemainder(text, command) {
  const expression = new RegExp(`^${escapeRegExp(command)}(?:@[A-Za-z0-9_]+)?(?:\\s+|$)`, 'iu');
  return String(text || '').replace(expression, '').trim();
}

function isCommand(text, command) {
  return new RegExp(`^${escapeRegExp(command)}(?:@[A-Za-z0-9_]+)?\\s*$`, 'iu').test(String(text || '').trim());
}

function isCommandInvocation(text, command) {
  return new RegExp(`^${escapeRegExp(command)}(?:@[A-Za-z0-9_]+)?(?:\\s|$)`, 'iu').test(String(text || '').trim());
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('tr-TR');
}

function isCancel(text) {
  return ['iptal', '/iptal', 'cancel', '/cancel'].includes(text);
}

function isNoPhoto(text) {
  return ['foto yok', 'fotoğraf yok', 'resim yok', 'yok', 'geç', 'skip'].includes(text);
}

function getImageFile(message) {
  if (Array.isArray(message.photo) && message.photo.length) return message.photo[message.photo.length - 1];
  if (message.document && String(message.document.mime_type || '').startsWith('image/')) return message.document;
  return null;
}

function parseCount(input) {
  const raw = String(input || '').trim().replace(/\s+/g, '');
  if (!raw) return null;

  let value = null;
  if (/^\d+$/.test(raw)) value = Number(raw);
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) value = Number(raw.replace(/\./g, ''));
  else if (/^\d{1,3}(?:,\d{3})+$/.test(raw)) value = Number(raw.replace(/,/g, ''));
  else {
    const compact = raw.match(/^(\d+(?:[.,]\d+)?)\s*([kKbB])$/u);
    if (compact) value = Math.round(Number(compact[1].replace(',', '.')) * 1000);
  }

  return Number.isSafeInteger(value) && value >= 0 && value <= 999999 ? value : null;
}

function formatCount(value) {
  const count = Number(value) || 0;
  if (count >= 1000) {
    const thousand = count / 1000;
    return `${thousand.toFixed(thousand >= 10 ? 0 : 1).replace('.0', '')} B`;
  }
  return String(count);
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function warmImageService(env) {
  try {
    const response = await fetch(`${String(env.IMAGE_SERVICE_URL).replace(/\/$/, '')}/health`, {
      headers: { 'x-secret': String(env.IMAGE_SECRET || '') },
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (!response.ok) console.warn('Image service warm-up returned', response.status);
  } catch (error) {
    console.warn('Image service warm-up failed:', error?.message || error);
  }
}

async function sendMessage(chatId, text, env, replyMarkup = null) {
  const body = { chat_id: chatId, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return telegramApi('sendMessage', body, env);
}

async function sendChatAction(chatId, action, env) {
  return telegramApi('sendChatAction', { chat_id: chatId, action }, env);
}

async function sendPhoto(chatId, image, env) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('photo', new Blob([image], { type: 'image/png' }), 'skstory.png');
  form.append('caption', '✅ SK Story hazır.');

  const response = await fetch(`${TELEGRAM_API}/bot${env.BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    body: form
  });

  if (!response.ok) throw new Error(`Telegram sendPhoto ${response.status}: ${await response.text()}`);
}

async function telegramApi(method, payload, env) {
  const response = await fetch(`${TELEGRAM_API}/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    console.error(`Telegram ${method} error:`, await response.text());
  }
}

function oneTimeKeyboard(rows) {
  return { keyboard: rows, resize_keyboard: true, one_time_keyboard: true };
}

function removeKeyboard() {
  return { remove_keyboard: true };
}
