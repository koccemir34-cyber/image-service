import express from 'express';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontBuffer = readFileSync(join(__dirname, 'inter.ttf'));
const LOGO_B64   = readFileSync(join(__dirname, 'logo_b64.txt'), 'utf8').trim();
const SECRET     = process.env.IMAGE_SECRET || '';
const WEBSITE    = 'selhattinkoc.web.app';

const emojiCache = new Map();

const app = express();
app.use(express.json({ limit: '15mb' }));

app.get('/', (_, res) => res.send('Image service active ✅'));

app.post('/generate', async (req, res) => {
  if (SECRET && req.headers['x-secret'] !== SECRET)
    return res.status(401).json({ error: 'unauthorized' });

  const { text, photoB64, photoWidth, photoHeight } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (text.length > 600) return res.status(400).json({ error: 'text too long' });

  try {
    const svg = await buildSvg(text, photoB64 || null, photoWidth || null, photoHeight || null);
    const resvg = new Resvg(svg, {
      font: {
        loadSystemFonts: false,
        fontBuffers: [fontBuffer],
        defaultFontFamily: 'Inter',
        sansSerifFamily: 'Inter',
      },
      fitTo: { mode: 'original' }
    });
    const png = resvg.render().asPng();
    res.set('Content-Type', 'image/png');
    res.send(Buffer.from(png));
  } catch (e) {
    console.error('Generate error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/oncesonra', (req, res) => {
  if (SECRET && req.headers['x-secret'] !== SECRET)
    return res.status(401).json({ error: 'unauthorized' });

  const { konum, baslik, satir1, satir2, onceB64, sonraB64 } = req.body;
  if (!konum || !baslik || !satir1 || !satir2 || !onceB64 || !sonraB64)
    return res.status(400).json({ error: 'missing fields' });

  try {
    const svg   = buildOncesonraSvg(konum, baslik, satir1, satir2, onceB64, sonraB64);
    const resvg = new Resvg(svg, {
      font: {
        loadSystemFonts: false,
        fontBuffers: [fontBuffer],
        defaultFontFamily: 'Inter',
        sansSerifFamily: 'Inter',
      },
      fitTo: { mode: 'original' }
    });
    const png = resvg.render().asPng();
    res.set('Content-Type', 'image/png');
    res.send(Buffer.from(png));
  } catch (e) {
    console.error('Oncesonra error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log('Ready on port', process.env.PORT || 3000)
);

// ── Emoji ────────────────────────────────────────────────────────────────────
// Tek codepoint yerine grapheme cluster kullanıyoruz:
// ZWJ dizileri (👨‍💻), bayrak çiftleri (🇹🇷), variation selector (❤️)
// hepsini doğru şekilde tek birim olarak gruplayacak.
const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u;
const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

function isEmojiCluster(g) {
  return EMOJI_RE.test(g);
}

async function fetchEmoji(emoji) {
  if (emojiCache.has(emoji)) return emojiCache.get(emoji);
  // FE0F (variation selector) çıkar, ZWJ (200d) bırak
  const codepoints = [...emoji]
    .map(c => c.codePointAt(0).toString(16))
    .filter(cp => cp !== 'fe0f')
    .join('-');
  try {
    const res = await fetch(
      `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${codepoints}.png`
    );
    if (!res.ok) { emojiCache.set(emoji, null); return null; }
    const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    emojiCache.set(emoji, `data:image/png;base64,${b64}`);
    return emojiCache.get(emoji);
  } catch {
    emojiCache.set(emoji, null);
    return null;
  }
}

function segmentLine(text) {
  const segments = [];
  let textChunk = '';
  for (const { segment } of graphemeSegmenter.segment(text)) {
    if (isEmojiCluster(segment)) {
      if (textChunk) { segments.push({ type: 'text', value: textChunk }); textChunk = ''; }
      segments.push({ type: 'emoji', value: segment });
    } else {
      textChunk += segment;
    }
  }
  if (textChunk) segments.push({ type: 'text', value: textChunk });
  return segments;
}

function displayLen(s) {
  let len = 0;
  for (const { segment } of graphemeSegmenter.segment(s)) {
    len += isEmojiCluster(segment) ? 2 : segment.length;
  }
  return len;
}

function wrapText(text, max) {
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (displayLen(cand) <= max) { cur = cand; continue; }
    if (cur) lines.push(cur);
    if (displayLen(w) > max) {
      let chunk = '';
      for (const { segment } of graphemeSegmenter.segment(w)) {
        if (displayLen(chunk + segment) > max) { lines.push(chunk); chunk = segment; }
        else chunk += segment;
      }
      if (chunk) cur = chunk;
    } else { cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// ── SVG ─────────────────────────────────────────────────────────────────────
async function buildSvg(rawText, photoB64, photoWidth, photoHeight) {
  const W      = 1080;
  const CARD_W = 1040;
  const CARD_X = (W - CARD_W) / 2;   // 20px kenar boşluğu
  const RX     = 22;
  const ACC_W  = 10;                  // sol kırmızı accent bar genişliği
  const PAD    = 58;                  // iç padding (accent bar sonrası)
  const TEXT_X = CARD_X + ACC_W + PAD;
  const TEXT_W = CARD_W - ACC_W - PAD * 2;

  const AVA_R  = 62;
  const avaCX  = TEXT_X + AVA_R;
  const FS     = 54;
  const LH     = 88;
  const MAX_CH = 23;
  const CHAR_W = FS * 0.57;
  const EMOJI_SZ = FS * 1.05;

  // Fotoğraf boyutları — gerçek en/boy oranını koru, max 900px
  const PHOTO_H   = photoB64
    ? (photoWidth && photoHeight
        ? Math.min(Math.round(TEXT_W * photoHeight / photoWidth), 900)
        : 460)
    : 0;
  const PHOTO_GAP = photoB64 ? 44 : 0;
  const PHOTO_BOT = photoB64 ? 24 : 0;

  // Metin satırları
  const paragraphs = rawText.split('\n');
  const lines = [];
  for (let p = 0; p < paragraphs.length; p++) {
    lines.push(...wrapText(paragraphs[p].trim(), MAX_CH));
    if (p < paragraphs.length - 1) lines.push(null);
  }

  const allEmoji = new Set();
  for (const l of lines) {
    if (!l) continue;
    for (const s of segmentLine(l)) if (s.type === 'emoji') allEmoji.add(s.value);
  }
  await Promise.all([...allEmoji].map(fetchEmoji));

  // Boyutlar
  const PROF_H    = AVA_R * 2;
  const SEP_GAP   = 36;
  const SEP_H     = 2;
  const TEXT_GAP  = 50;
  const TEXT_H    = lines.reduce((a, l) => a + (l === null ? LH * 0.6 : LH), 0);
  const FOOT_AREA = 90;   // footer bölge yüksekliği (gri arka plan)
  const FOOT_PAD  = 28;

  const CARD_H = Math.max(
    800,
    PROF_H + SEP_GAP + SEP_H + TEXT_GAP +
    TEXT_H + PHOTO_GAP + PHOTO_H + PHOTO_BOT +
    PAD * 2 + FOOT_AREA
  );

  const CARD_Y = 90;
  const H = Math.max(1920, CARD_Y + CARD_H + 90);

  const avaCY   = CARD_Y + PAD + AVA_R;
  const nameX   = avaCX + AVA_R + 22;
  const nameY   = avaCY - 14;
  const subY    = avaCY + 20;
  const handleY = avaCY + 52;
  const LOGO_SZ = 66;
  const logoX   = CARD_X + CARD_W - PAD - LOGO_SZ;
  const logoY   = CARD_Y + PAD + (AVA_R - LOGO_SZ / 2);
  const sepY    = CARD_Y + PAD + PROF_H + SEP_GAP;

  const footAreaY = CARD_Y + CARD_H - FOOT_AREA;

  // Metin elementleri
  let curY = sepY + SEP_H + TEXT_GAP + FS * 0.82;
  const els = [];

  for (const line of lines) {
    if (line === null) { curY += LH * 0.6; continue; }

    const segs     = segmentLine(line);
    const hasEmoji = segs.some(s => s.type === 'emoji');

    if (!hasEmoji) {
      els.push(
        `<text x="${TEXT_X}" y="${Math.round(curY)}"
          font-family="Inter" font-size="${FS}" font-weight="700"
          fill="#0F172A">${escapeXml(line)}</text>`
      );
    } else {
      let x = TEXT_X;
      for (const seg of segs) {
        if (seg.type === 'text' && seg.value) {
          els.push(
            `<text x="${Math.round(x)}" y="${Math.round(curY)}"
              font-family="Inter" font-size="${FS}" font-weight="700"
              fill="#0F172A">${escapeXml(seg.value)}</text>`
          );
          x += seg.value.length * CHAR_W;
        } else if (seg.type === 'emoji') {
          const dataUrl = emojiCache.get(seg.value);
          if (dataUrl) {
            els.push(
              `<image x="${Math.round(x)}" y="${Math.round(curY - EMOJI_SZ * 0.82)}"
                width="${Math.round(EMOJI_SZ)}" height="${Math.round(EMOJI_SZ)}"
                href="${dataUrl}"/>`
            );
          }
          x += EMOJI_SZ + 4;
        }
      }
    }
    curY += LH;
  }

  // Fotoğraf
  const textEndY = sepY + SEP_H + TEXT_GAP + TEXT_H;
  const photoY   = textEndY + PHOTO_GAP;

  const photoClip = photoB64 ? `
    <clipPath id="photoClip">
      <rect x="${TEXT_X}" y="${Math.round(photoY)}"
            width="${TEXT_W}" height="${PHOTO_H}" rx="14" ry="14"/>
    </clipPath>` : '';

  const photoImg = photoB64 ? `
  <image x="${TEXT_X}" y="${Math.round(photoY)}"
         width="${TEXT_W}" height="${PHOTO_H}"
         href="data:image/jpeg;base64,${photoB64}"
         clip-path="url(#photoClip)"
         preserveAspectRatio="xMidYMid slice"/>` : '';

  const now = new Date();
  const dateStr = `${now.getDate().toString().padStart(2,'0')}.${(now.getMonth()+1).toString().padStart(2,'0')}.${now.getFullYear()}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
     xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <clipPath id="cardClip">
      <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_W}" height="${CARD_H}"
            rx="${RX}" ry="${RX}"/>
    </clipPath>
    <clipPath id="ava">
      <circle cx="${avaCX}" cy="${avaCY}" r="${AVA_R}"/>
    </clipPath>
    ${photoClip}

    <!-- Arka plan -->
    <linearGradient id="bg" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0%"   stop-color="#0D1117"/>
      <stop offset="100%" stop-color="#131820"/>
    </linearGradient>

    <!-- Sol accent bar (dikey) -->
    <linearGradient id="accentV" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#EF4444"/>
      <stop offset="100%" stop-color="#991B1B"/>
    </linearGradient>

    <!-- Üst accent şerit (yatay) -->
    <linearGradient id="accentH" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#B91C1C"/>
      <stop offset="100%" stop-color="#EF4444"/>
    </linearGradient>

    <!-- Ayırıcı çizgi -->
    <linearGradient id="sep" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#E2E8F0"/>
      <stop offset="50%"  stop-color="#CBD5E1"/>
      <stop offset="100%" stop-color="#E2E8F0"/>
    </linearGradient>

    <!-- Kart gölgesi -->
    <filter id="shadow" x="-5%" y="-3%" width="120%" height="116%">
      <feDropShadow dx="0" dy="10" stdDeviation="22"
                    flood-color="#000000" flood-opacity="0.40"/>
    </filter>
  </defs>

  <!-- Arka plan -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Kart zemini + gölge -->
  <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_W}" height="${CARD_H}"
        rx="${RX}" ry="${RX}" fill="#FFFFFF" filter="url(#shadow)"/>

  <!-- Footer gri arka plan (card içinde, alta yapışık) -->
  <rect x="${CARD_X}" y="${footAreaY}" width="${CARD_W}" height="${FOOT_AREA}"
        fill="#F1F5F9" clip-path="url(#cardClip)"/>

  <!-- Sol kırmızı accent bar -->
  <rect x="${CARD_X}" y="${CARD_Y}" width="${ACC_W}" height="${CARD_H}"
        fill="url(#accentV)" clip-path="url(#cardClip)"/>

  <!-- Üst kırmızı accent şerit -->
  <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_W}" height="8"
        fill="url(#accentH)" clip-path="url(#cardClip)"/>

  <!-- Avatar -->
  <image x="${avaCX - AVA_R}" y="${avaCY - AVA_R}"
         width="${AVA_R * 2}" height="${AVA_R * 2}"
         href="data:image/jpeg;base64,${LOGO_B64}" clip-path="url(#ava)"/>
  <circle cx="${avaCX}" cy="${avaCY}" r="${AVA_R}"
          fill="none" stroke="#E2E8F0" stroke-width="2.5"/>

  <!-- Şirket adı (hiyerarşi: büyük isim → kırmızı sektör → gri handle) -->
  <text x="${nameX}" y="${nameY}"
        font-family="Inter" font-size="28" font-weight="900"
        fill="#0F172A">SELHATTİN KOÇ</text>
  <text x="${nameX}" y="${subY}"
        font-family="Inter" font-size="22" font-weight="700"
        fill="#DC2626">İNŞAAT TAAHHÜT</text>
  <text x="${nameX}" y="${handleY}"
        font-family="Inter" font-size="19" font-weight="400"
        fill="#94A3B8">@selhattinkocinsaat</text>

  <!-- Sağ logo -->
  <image x="${logoX}" y="${logoY}" width="${LOGO_SZ}" height="${LOGO_SZ}"
         href="data:image/jpeg;base64,${LOGO_B64}"/>

  <!-- Ayırıcı -->
  <line x1="${TEXT_X}" y1="${sepY}"
        x2="${CARD_X + CARD_W - PAD}" y2="${sepY}"
        stroke="url(#sep)" stroke-width="${SEP_H}"/>

  <!-- İçerik metni -->
  ${els.join('\n  ')}

  <!-- Kullanıcı fotoğrafı (varsa) -->
  ${photoImg}

  <!-- Footer içeriği -->
  <text x="${TEXT_X}" y="${footAreaY + FOOT_PAD + 22}"
        font-family="Inter" font-size="22" font-weight="600"
        fill="#1E293B">${escapeXml(WEBSITE)}</text>
  <text x="${CARD_X + CARD_W - PAD}" y="${footAreaY + FOOT_PAD + 22}"
        font-family="Inter" font-size="18" font-weight="400"
        fill="#94A3B8" text-anchor="end">${dateStr}</text>
</svg>`;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ── Önce/Sonra SVG ────────────────────────────────────────────────────────────
function buildOncesonraSvg(konum, baslik, satir1, satir2, onceB64, sonraB64) {
  const W = 1080;
  const H = 1350;

  // Başlık font boyutu — uzun metinler için küçült
  const TITLE_BASE = 76;
  const titleEstW  = baslik.length * TITLE_BASE * 0.56;
  const titleFS    = titleEstW > 960 ? Math.round(TITLE_BASE * 960 / titleEstW) : TITLE_BASE;

  // Konum satırı: pin ikonu + metin, yatayda ortalı
  const LOC_FS    = 38;
  const PIN_W     = 56;  // pin ikonunun kapladığı genişlik
  const PIN_GAP   = 12;
  const locEstW   = konum.length * LOC_FS * 0.55;
  const locTotalW = PIN_W + PIN_GAP + locEstW;
  const locStartX = Math.max(40, Math.round((W - locTotalW) / 2));
  const pinCX     = locStartX + 26;
  const locTextX  = locStartX + PIN_W + PIN_GAP;

  // Fotoğraf alanı
  const PH_Y  = 255;
  const PH_H  = 575;
  const PH_W  = 510;
  const PH_X1 = 20;
  const PH_X2 = 550;

  // Footer
  const FT_Y = 850;

  // Servis satırı font boyutu
  const SVC_FS  = 34;
  const SVC_MAX = 870; // px cinsinden max genişlik
  const s1FS = satir1.length * SVC_FS * 0.55 > SVC_MAX ? Math.round(SVC_FS * SVC_MAX / (satir1.length * SVC_FS * 0.55)) : SVC_FS;
  const s2FS = satir2.length * SVC_FS * 0.55 > SVC_MAX ? Math.round(SVC_FS * SVC_MAX / (satir2.length * SVC_FS * 0.55)) : SVC_FS;

  const now     = new Date();
  const dateStr = `${now.getDate().toString().padStart(2,'0')}.${(now.getMonth()+1).toString().padStart(2,'0')}.${now.getFullYear()}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
     xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <clipPath id="lp"><rect x="${PH_X1}" y="${PH_Y}" width="${PH_W}" height="${PH_H}" rx="10"/></clipPath>
    <clipPath id="rp"><rect x="${PH_X2}" y="${PH_Y}" width="${PH_W}" height="${PH_H}" rx="10"/></clipPath>
    <clipPath id="lc"><circle cx="${W/2}" cy="${FT_Y+85}" r="58"/></clipPath>
  </defs>

  <!-- Arka plan -->
  <rect width="${W}" height="${H}" fill="#EEF2F7"/>
  <!-- Header beyaz alan -->
  <rect x="0" y="0" width="${W}" height="${PH_Y}" fill="#FFFFFF"/>
  <!-- Footer beyaz alan -->
  <rect x="0" y="${FT_Y}" width="${W}" height="${H - FT_Y}" fill="#FFFFFF"/>

  <!-- Konum pin ikonu (SVG path) -->
  <path d="M${pinCX-22},${52} C${pinCX-22},${36} ${pinCX-11},${22} ${pinCX},${22}
           C${pinCX+11},${22} ${pinCX+22},${36} ${pinCX+22},${52}
           C${pinCX+22},${68} ${pinCX},${90} ${pinCX},${90}
           C${pinCX},${90} ${pinCX-22},${68} ${pinCX-22},${52} Z" fill="#C1272D"/>
  <circle cx="${pinCX}" cy="52" r="9" fill="white"/>

  <!-- Konum metni -->
  <text x="${locTextX}" y="76"
        font-family="Inter" font-size="${LOC_FS}" font-weight="700" fill="#0D1B3E">${escapeXml(konum)}</text>

  <!-- Başlık -->
  <text x="${W/2}" y="183" text-anchor="middle"
        font-family="Inter" font-size="${titleFS}" font-weight="900" fill="#0D1B3E">${escapeXml(baslik)}</text>

  <!-- ÖNCE fotoğrafı -->
  <image x="${PH_X1}" y="${PH_Y}" width="${PH_W}" height="${PH_H}"
         href="data:image/jpeg;base64,${onceB64}"
         clip-path="url(#lp)" preserveAspectRatio="xMidYMid slice"/>
  <rect x="${PH_X1}" y="${PH_Y}" width="170" height="60" fill="#0D1B3E"/>
  <text x="${PH_X1+85}" y="${PH_Y+41}" text-anchor="middle"
        font-family="Inter" font-size="34" font-weight="800" fill="#FFFFFF">ÖNCE</text>

  <!-- SONRA fotoğrafı -->
  <image x="${PH_X2}" y="${PH_Y}" width="${PH_W}" height="${PH_H}"
         href="data:image/jpeg;base64,${sonraB64}"
         clip-path="url(#rp)" preserveAspectRatio="xMidYMid slice"/>
  <rect x="${PH_X2}" y="${PH_Y}" width="190" height="60" fill="#B91C1C"/>
  <text x="${PH_X2+95}" y="${PH_Y+41}" text-anchor="middle"
        font-family="Inter" font-size="34" font-weight="800" fill="#FFFFFF">SONRA</text>

  <!-- Logo -->
  <image x="${W/2-58}" y="${FT_Y+27}" width="116" height="116"
         href="data:image/jpeg;base64,${LOGO_B64}"
         clip-path="url(#lc)"/>
  <circle cx="${W/2}" cy="${FT_Y+85}" r="58" fill="none" stroke="#E2E8F0" stroke-width="2"/>

  <!-- Firma adı -->
  <text x="${W/2}" y="${FT_Y+195}" text-anchor="middle"
        font-family="Inter" font-size="44" font-weight="900" fill="#0D1B3E">SELHATTİN KOÇ</text>
  <text x="${W/2}" y="${FT_Y+240}" text-anchor="middle"
        font-family="Inter" font-size="27" font-weight="600" fill="#94A3B8">— İNŞAAT —</text>

  <!-- Ayırıcı -->
  <line x1="80" y1="${FT_Y+270}" x2="${W-80}" y2="${FT_Y+270}" stroke="#E2E8F0" stroke-width="2"/>

  <!-- Servis satırı 1 -->
  <rect x="80" y="${FT_Y+295}" width="6" height="${s1FS}" fill="#C1272D" rx="3"/>
  <text x="102" y="${FT_Y+322}" font-family="Inter" font-size="${s1FS}" font-weight="500" fill="#1E293B">${escapeXml(satir1)}</text>

  <!-- Servis satırı 2 -->
  <rect x="80" y="${FT_Y+355}" width="6" height="${s2FS}" fill="#C1272D" rx="3"/>
  <text x="102" y="${FT_Y+382}" font-family="Inter" font-size="${s2FS}" font-weight="500" fill="#1E293B">${escapeXml(satir2)}</text>

  <!-- Website + tarih -->
  <text x="${W/2}" y="${FT_Y+448}" text-anchor="middle"
        font-family="Inter" font-size="22" font-weight="400" fill="#CBD5E1">${WEBSITE} • ${dateStr}</text>
</svg>`;
}
