import express from 'express';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

import { BRANDS } from './utils/brands.js';
import { authMiddleware } from './utils/auth.js';
import { escapeXml, randInt } from './utils/svg.js';
import { fetchEmoji, segmentLine, displayLen, wrapText, getEmojiCache } from './utils/emoji.js';
import { CAMERA_PROFILES, pickRandomCamera, generateExifData } from './utils/exif.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontBuffer = readFileSync(join(__dirname, 'inter.ttf'));
const SECRET     = process.env.IMAGE_SECRET || '';

const app = express();
app.use(express.json({ limit: '15mb' }));

const auth = authMiddleware(SECRET);

app.get('/', (_, res) => res.send('Image service active ✅ X-Post Design'));

app.post('/generate', auth, async (req, res) => {
  const { text, photoB64, photoWidth, photoHeight, brand } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (text.length > 600) return res.status(400).json({ error: 'text too long' });

  const brandCfg = BRANDS[brand] || BRANDS.selhattin;

  try {
    const svg = await buildXPostSvg(text, photoB64 || null, photoWidth || null, photoHeight || null, brandCfg);
    const resvg = new Resvg(svg, {
      font: {
        loadSystemFonts: false,
        fontBuffers: [fontBuffer],
        defaultFontFamily: 'Inter Variable',
        sansSerifFamily: 'Inter Variable',
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

// ── EXIF ─────────────────────────────────────────────────────────────────────
app.post('/exif', auth, (req, res) => {
  const { imageB64 } = req.body;
  if (!imageB64) return res.status(400).json({ error: 'imageB64 required' });

  let piexif;
  try {
    const require = createRequire(import.meta.url);
    piexif = require('piexifjs');
  } catch {
    return res.status(500).json({ error: 'piexifjs not installed' });
  }

  try {
    const binary  = Buffer.from(imageB64, 'base64').toString('binary');
    const stripped = piexif.remove(binary);

    const cam = pickRandomCamera();
    const { exifObj } = generateExifData(cam);

    const exifBytes = piexif.dump(exifObj);
    const result    = piexif.insert(exifBytes, stripped);
    const outBuf    = Buffer.from(result, 'binary');

    res.set('Content-Type', 'image/jpeg');
    res.set('X-Camera', `${cam.make} ${cam.model}`);
    res.send(outBuf);
  } catch (e) {
    console.error('EXIF error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log('Ready on port', process.env.PORT || 3000)
);

// ── X-Post SVG ───────────────────────────────────────────────────────────────
async function buildXPostSvg(rawText, photoB64, photoWidth, photoHeight, brand) {
  const W = 1080;
  const BG = '#1c1c1e';
  const CARD_W = 900;
  const CARD_X = (W - CARD_W) / 2;  // 90

  const TEXT_COLOR  = '#0f1419';
  const HANDLE_CLR  = '#71767b';
  const HASHTAG_CLR = '#1d9bf0';
  const ENG_CLR     = '#536471';
  const CARD_BG     = '#ffffff';
  const DIVIDER_CLR = '#eff3f4';
  const WATERMARK_CLR = '#ffffff';

  const AVATAR_R    = 48;
  const AVATAR_CX   = CARD_X + 48 + 56;
  const AVATAR_CY   = 340;

  const NAME_X      = AVATAR_CX + AVATAR_R + 20;
  const NAME_FS     = 34;
  const HANDLE_FS   = 26;

  const TEXT_PAD_X  = CARD_X + 36;
  const TEXT_W      = CARD_W - 72;
  const TEXT_FS     = 40;
  const TEXT_LH     = 64;
  const TEXT_MAX_CH = 24;

  const PHOTO_H     = 420;
  const PHOTO_GAP   = 20;
  const PHOTO_PAD   = 36;
  const PHOTO_CLIP_R = 20;

  const ENG_FS      = 24;
  const ENG_ICON_SZ = 36;

  const DATE_FS     = 24;

  const iconComment = 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z';
  const iconRt      = 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3';
  const iconHeart   = 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z';
  const iconBookmark = 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6 12 2 8 6M12 2v13';

  // ── Metin satirlari ───────────────────────────────────────────────
  const paragraphs = rawText.split('\n');
  const lines = [];
  for (let p = 0; p < paragraphs.length; p++) {
    const wrapped = wrapText(paragraphs[p].trim(), TEXT_MAX_CH);
    for (const w of wrapped) lines.push({ text: w, isGap: false });
    if (p < paragraphs.length - 1) lines.push({ text: '', isGap: true });
  }

  const emojiCache = getEmojiCache();
  const allEmoji = new Set();
  for (const l of lines) {
    if (!l.text) continue;
    const segs = segmentLine(l.text);
    for (const s of segs) {
      if (s.type === 'emoji') allEmoji.add(s.value);
    }
  }
  await Promise.all([...allEmoji].map(fetchEmoji));

  const CHAR_W = TEXT_FS * 0.55;
  const textH = lines.reduce((a, l) => {
    if (l.isGap) return a + TEXT_LH * 0.5;
    return a + TEXT_LH;
  }, 0);

  const hasPhoto = photoB64 && photoB64.length > 0;
  const computedPhotoH = hasPhoto
    ? (photoWidth && photoHeight
        ? Math.min(Math.round((CARD_W - 72) * photoHeight / photoWidth), PHOTO_H)
        : PHOTO_H)
    : 0;
  const actualPhotoH = hasPhoto ? PHOTO_H : 0;
  const photoGap = hasPhoto ? PHOTO_GAP : 0;

  // ── Koordinatlar ──────────────────────────────────────────────────
  const cardY       = 160;
  const headerY     = cardY + 32;
  const textStartY  = headerY + AVATAR_R * 2 + 24;
  const textEndY    = textStartY + textH;
  const photoY      = hasPhoto ? textEndY + photoGap : 0;
  const photoEndY   = hasPhoto ? photoY + actualPhotoH : textEndY;

  const dateY       = photoEndY + 20;
  const divY        = dateY + 40;
  const engY        = divY + 24;
  const cardBottomY = engY + ENG_ICON_SZ + 40;

  const cardH = cardBottomY - cardY + 20;

  const wmY = cardBottomY + 120;
  const H = wmY + 100;

  // ── Metin elementleri ────────────────────────────────────────────
  let curY = textStartY + TEXT_FS * 0.85;
  const els = [];
  const FS40 = `font-family="Inter Variable" font-size="${TEXT_FS}" font-weight="700"`;

  for (const line of lines) {
    if (line.isGap) { curY += TEXT_LH * 0.5; continue; }
    if (!line.text) { curY += TEXT_LH; continue; }

    const segs = segmentLine(line.text);

    const hasHashtag = /#[\wçğıöşüÇĞİÖŞÜ]+/.test(line.text);
    const hasEmoji   = segs.some(s => s.type === 'emoji');

    if (!hasHashtag && !hasEmoji) {
      els.push(
        `<text x="${TEXT_PAD_X}" y="${Math.round(curY)}" ${FS40} fill="${TEXT_COLOR}">${escapeXml(line.text)}</text>`
      );
    } else {
      let x = TEXT_PAD_X;
      for (const seg of segs) {
        if (seg.type === 'emoji') {
          const dataUrl = emojiCache.get(seg.value);
          if (dataUrl) {
            const eSz = TEXT_FS * 1.05;
            els.push(
              `<image x="${Math.round(x)}" y="${Math.round(curY - eSz * 0.82)}" width="${Math.round(eSz)}" height="${Math.round(eSz)}" href="${dataUrl}"/>`
            );
          }
          x += TEXT_FS * 1.1;
          continue;
        }

        if (seg.type === 'text' && seg.value) {
          const parts = seg.value.split(/(#[\wçğıöşüÇĞİÖŞÜ]+)/);
          for (const part of parts) {
            if (!part) continue;
            const isHash = part.startsWith('#');
            const w = part.length * CHAR_W;
            els.push(
              `<text x="${Math.round(x)}" y="${Math.round(curY)}" ${FS40} fill="${isHash ? HASHTAG_CLR : TEXT_COLOR}">${escapeXml(part)}</text>`
            );
            x += w;
          }
        }
      }
    }
    curY += TEXT_LH;
  }

  // ── Profil fotografi clip ────────────────────────────────────────
  const profileClipId = 'profileClip';
  const profileData = `data:image/jpeg;base64,${brand.profileB64}`;

  // ── Fotograf clip ─────────────────────────────────────────────────
  const photoPadX = TEXT_PAD_X;
  const photoW = CARD_W - 72;
  const photoClip = hasPhoto ? `
    <clipPath id="photoClip">
      <rect x="${photoPadX}" y="${Math.round(photoY)}" width="${photoW}" height="${actualPhotoH}" rx="${PHOTO_CLIP_R}"/>
    </clipPath>` : '';

  const photoImg = hasPhoto ? `
    <image x="${photoPadX}" y="${Math.round(photoY)}"
           width="${photoW}" height="${actualPhotoH}"
           href="data:image/jpeg;base64,${photoB64}"
           clip-path="url(#photoClip)"
           preserveAspectRatio="xMidYMid slice"/>
    <!-- Kose yuvarlaklik overlay (temiz kenar) -->
    <rect x="${photoPadX}" y="${Math.round(photoY)}" width="${photoW}" height="${actualPhotoH}"
          rx="${PHOTO_CLIP_R}" ry="${PHOTO_CLIP_R}" fill="none" stroke="${DIVIDER_CLR}" stroke-width="1"/>` : '';

  // ── Fake engagement sayilari ──────────────────────────────────────
  const comments = randInt(5, 80);
  const retweets = randInt(3, 40);
  const likes    = randInt(50, 500);
  const gapX = (CARD_W - 72 - ENG_ICON_SZ * 4) / 5;
  const engStartX = TEXT_PAD_X;

  // ── Tarih ─────────────────────────────────────────────────────────
  const now     = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const months  = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
  const timeStr = `${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}`;
  const dateStr = `${timeStr} · ${now.getUTCDate()} ${months[now.getUTCMonth()]} ${now.getUTCFullYear()}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
     xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <clipPath id="${profileClipId}">
      <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="${AVATAR_R}"/>
    </clipPath>
    ${photoClip}
  </defs>

  <!-- Arka plan -->
  <rect width="${W}" height="${H}" fill="${BG}"/>

  <!-- Beyaz kart -->
  <rect x="${CARD_X}" y="${cardY}" width="${CARD_W}" height="${cardH}"
        rx="24" ry="24" fill="${CARD_BG}"/>

  <!-- Profil fotografi (dairesel) -->
  <image x="${AVATAR_CX - AVATAR_R}" y="${AVATAR_CY - AVATAR_R}"
         width="${AVATAR_R * 2}" height="${AVATAR_R * 2}"
         href="${profileData}" clip-path="url(#${profileClipId})"/>
  <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="${AVATAR_R}"
          fill="none" stroke="${DIVIDER_CLR}" stroke-width="2"/>

  <!-- Isim -->
  <text x="${NAME_X}" y="${AVATAR_CY - 14}"
        font-family="Inter Variable" font-size="${NAME_FS}" font-weight="800"
        fill="${TEXT_COLOR}">${escapeXml(brand.name)}</text>

  <!-- Kullanici adi -->
  <text x="${NAME_X}" y="${AVATAR_CY + 18}"
        font-family="Inter Variable" font-size="${HANDLE_FS}" font-weight="400"
        fill="${HANDLE_CLR}">${escapeXml(brand.handle)}</text>

  <!-- Metin -->
  ${els.join('\n  ')}

  <!-- Fotograf -->
  ${photoImg}

  <!-- Tarih -->
  <text x="${TEXT_PAD_X}" y="${Math.round(dateY)}"
        font-family="Inter Variable" font-size="${DATE_FS}" font-weight="400"
        fill="${HANDLE_CLR}">${dateStr}</text>

  <!-- Divider -->
  <line x1="${TEXT_PAD_X}" y1="${Math.round(divY)}" x2="${TEXT_PAD_X + CARD_W - 72}" y2="${Math.round(divY)}"
        stroke="${DIVIDER_CLR}" stroke-width="1.5"/>

  <!-- Engagement Bar -->
  <!-- Yorum -->
  <g transform="translate(${engStartX}, ${Math.round(engY)})">
    <svg width="${ENG_ICON_SZ}" height="${ENG_ICON_SZ}" viewBox="0 0 24 24">
      <path d="${iconComment}" fill="none" stroke="${ENG_CLR}" stroke-width="2"/>
    </svg>
    <text x="${ENG_ICON_SZ + 10}" y="${ENG_ICON_SZ * 0.75}"
          font-family="Inter Variable" font-size="${ENG_FS}" font-weight="500"
          fill="${ENG_CLR}">${comments}</text>
  </g>

  <!-- Retweet -->
  <g transform="translate(${engStartX + (ENG_ICON_SZ + 10) * 1 + ENG_ICON_SZ * 0 + gapX * 1}, ${Math.round(engY)})">
    <svg width="${ENG_ICON_SZ}" height="${ENG_ICON_SZ}" viewBox="0 0 24 24">
      <path d="${iconRt}" fill="none" stroke="${ENG_CLR}" stroke-width="2"/>
    </svg>
    <text x="${ENG_ICON_SZ + 10}" y="${ENG_ICON_SZ * 0.75}"
          font-family="Inter Variable" font-size="${ENG_FS}" font-weight="500"
          fill="${ENG_CLR}">${retweets}</text>
  </g>

  <!-- Begeni -->
  <g transform="translate(${engStartX + (ENG_ICON_SZ + 10) * 1 + ENG_ICON_SZ * 0 + gapX * 1 + (ENG_ICON_SZ + 10 + gapX) * 1}, ${Math.round(engY)})">
    <svg width="${ENG_ICON_SZ}" height="${ENG_ICON_SZ}" viewBox="0 0 24 24">
      <path d="${iconHeart}" fill="none" stroke="${ENG_CLR}" stroke-width="2"/>
    </svg>
    <text x="${ENG_ICON_SZ + 10}" y="${ENG_ICON_SZ * 0.75}"
          font-family="Inter Variable" font-size="${ENG_FS}" font-weight="500"
          fill="${ENG_CLR}">${likes}</text>
  </g>

  <!-- Bookmark -->
  <g transform="translate(${engStartX + (ENG_ICON_SZ + 10 + gapX) * 3}, ${Math.round(engY)})">
    <svg width="${ENG_ICON_SZ}" height="${ENG_ICON_SZ}" viewBox="0 0 24 24">
      <path d="${iconBookmark}" fill="none" stroke="${ENG_CLR}" stroke-width="2"/>
    </svg>
  </g>

  <!-- Brand Watermark -->
  <text x="${W / 2}" y="${Math.round(wmY)}" text-anchor="middle"
        font-family="Inter Variable" font-size="28" font-weight="700"
        fill="${WATERMARK_CLR}" opacity="0.35" letter-spacing="2">${escapeXml(brand.watermark)}</text>
  <text x="${W / 2}" y="${Math.round(wmY + 36)}" text-anchor="middle"
        font-family="Inter Variable" font-size="20" font-weight="400"
        fill="${WATERMARK_CLR}" opacity="0.35">${escapeXml(brand.website)}</text>
</svg>`;
}
