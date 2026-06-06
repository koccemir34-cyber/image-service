// Pure utility functions extracted from worker.js for testability

export const STATES = {
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

export const TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
export const TR_DAYS   = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];

export function parseDate(text) {
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return { ok: false, error: 'format' };
  const [, day, month, year] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (isNaN(date.getTime()) || date.getDate() !== day || date.getMonth() !== month - 1)
    return { ok: false, error: 'invalid' };
  return { ok: true, day, month, year };
}

export function parseTime(text) {
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { ok: false, error: 'format' };
  const [, hour, minute] = match.map(Number);
  if (hour > 23 || minute > 59) return { ok: false, error: 'range' };
  return { ok: true, hour, minute, string: `${hour}:${String(minute).padStart(2, '0')}` };
}

export function validateMessage(text) {
  if (!text || text.length < 3) return { ok: false, error: 'too_short' };
  return { ok: true };
}

export function validateRecurringDay(text) {
  const day = parseInt(text);
  if (!day || day < 1 || day > 31) return { ok: false, error: 'range' };
  return { ok: true, day };
}

export function validateStoryText(text) {
  if (!text || text.length < 2) return { ok: false, error: 'too_short' };
  if (text.length > 500) return { ok: false, error: 'too_long', length: text.length };
  return { ok: true };
}

export function isSkipWord(text) {
  return ['hayır', 'hayir', 'h', 'geç', 'gec', 'atla', 'yok'].includes(text.trim().toLowerCase());
}

export function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk)
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function cryptoRandomId(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  for (let i = 0; i < len; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

export function resolveRoute(pathname) {
  if (pathname === '/') return 'home';
  if (pathname === '/bot') return 'bot';
  if (pathname === '/cron') return 'cron';
  return 'not_found';
}

export function helpMessage() {
  return `
📌 */tekhatirlat* — Tek seferlik hatırlatma
📌 */herhatirlat* — Aylık tekrarlı hatırlatma
📌 */liste* — Hatırlatmaları listele
📌 */sil <ID>* — Hatırlatma sil
📌 */basarili* — Saat başı hatırlatmayı durdur

📌 */brifing* — Günlük sabah brifingi aç (her gün 08:00)
📌 */brifingkapat* — Günlük sabah brifingi kapat

📌 */story* — Instagram hikaye görseli oluştur
1. \`/story\` yaz
2. Metni gir
3. Fotoğraf gönder veya *Hayır* yaz
4. Görsel hazır ✅

📌 */exifdegis* — Fotoğrafın EXIF bilgilerini gerçekçi kamera verisiyle değiştir
1. \`/exifdegis\` yaz
2. Fotoğrafı gönder → EXIF güncellenmiş fotoğraf hazır ✅
  `.trim();
}
