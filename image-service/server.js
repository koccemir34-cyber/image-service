import express from 'express';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_SK_B64     = readFileSync(join(__dirname, 'logo_b64.txt'), 'utf8').trim();
const LOGO_REMAZ_B64  = readFileSync(join(__dirname, 'logo_remaz_b64.txt'), 'utf8').trim();
const SECRET          = process.env.IMAGE_SECRET || '';
if (!SECRET) {
  console.error('FATAL: IMAGE_SECRET env var is not set. Refusing to start without authentication.');
  process.exit(1);
}

// ── Profile photos (JPEG, square 400x400+) ─────────────────────
let PROFILE_SK_B64    = '';
let PROFILE_REMAZ_B64 = '';
try { PROFILE_SK_B64    = readFileSync(join(__dirname, 'profile-sk.jpg')).toString('base64'); }   catch {}
try { PROFILE_REMAZ_B64 = readFileSync(join(__dirname, 'profile-remaz.jpg')).toString('base64'); }  catch {}

const BRANDS = {
  selhattin: {
    logoB64:     LOGO_SK_B64,
    profileB64:  PROFILE_SK_B64 || LOGO_SK_B64,
    logoMime:    'image/jpeg',
    name:        'Selhattin Koç',
    handle:      '@selhattinkocinsaat',
    watermark:   'SELHATTİN KOÇ İNŞAAT',
    website:     'selhattinkoc.web.app',
  },
  remaz: {
    logoB64:     LOGO_REMAZ_B64,
    profileB64:  PROFILE_REMAZ_B64 || LOGO_REMAZ_B64,
    logoMime:    'image/jpeg',
    name:        'Remaz İnşaat',
    handle:      '@remazinsaat',
    watermark:   'REMAZ İNŞAAT',
    website:     'remazinsaat.web.app',
  },
};

const emojiCache = new Map();

const app = express();

// ── Security headers ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-XSS-Protection', '0');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Content-Security-Policy', "default-src 'none'");
  next();
});

app.use(express.json({ limit: '15mb' }));

app.get('/', (_, res) => res.send('Image service active'));

app.post('/generate', async (req, res) => {
  if (req.headers['x-secret'] !== SECRET)
    return res.status(401).json({ error: 'unauthorized' });

  const { text, photoB64, photoWidth, photoHeight, brand } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (text.length > 600) return res.status(400).json({ error: 'text too long' });

  const brandCfg = BRANDS[brand] || BRANDS.selhattin;

  try {
    const svg = await buildXPostSvg(text, photoB64 || null, photoWidth || null, photoHeight || null, brandCfg);
    const resvg = new Resvg(svg, {
      font: {
        loadSystemFonts: false,
        fontFiles: [join(__dirname, 'inter.ttf')],
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── EXIF ─────────────────────────────────────────────────────────────────────
const CAMERA_PROFILES = [
  { make: 'Apple',   model: 'iPhone 14 Pro',    software: '16.5.1',           fnum: [178, 100], focal: [686, 100], focal35: 24 },
  { make: 'Apple',   model: 'iPhone 15',        software: '17.4.1',           fnum: [160, 100], focal: [570, 100], focal35: 26 },
  { make: 'Apple',   model: 'iPhone 15 Pro Max',software: '17.5',              fnum: [178, 100], focal: [686, 100], focal35: 24 },
  { make: 'samsung', model: 'SM-S918B',          software: 'S918BXXS5EXD5',   fnum: [170, 100], focal: [630, 100], focal35: 23 },
  { make: 'Google',  model: 'Pixel 8 Pro',       software: 'UP1A.231005.007',  fnum: [168, 100], focal: [650, 100], focal35: 24 },
  { make: 'Sony',    model: 'XQ-EC72',           software: '13.4.0.0.3',       fnum: [190, 100], focal: [240, 100], focal35: 24 },
];

app.post('/exif', (req, res) => {
  if (req.headers['x-secret'] !== SECRET)
    return res.status(401).json({ error: 'unauthorized' });

  const { imageB64 } = req.body;
  if (!imageB64) return res.status(400).json({ error: 'imageB64 required' });
  if (typeof imageB64 !== 'string' || imageB64.length > 10_000_000)
    return res.status(400).json({ error: 'imageB64 too large (max ~7.5 MB)' });

  let piexif;
  try {
    const require = createRequire(import.meta.url);
    piexif = require('piexifjs');
  } catch {
    return res.status(500).json({ error: 'piexifjs not installed' });
  }

  try {
    const binary   = Buffer.from(imageB64, 'base64').toString('binary');
    const stripped = piexif.remove(binary);

    const cam = CAMERA_PROFILES[Math.floor(Math.random() * CAMERA_PROFILES.length)];

    const isoPool    = [50, 50, 64, 100, 100, 125, 200, 400, 800, 1600];
    const iso        = isoPool[Math.floor(Math.random() * isoPool.length)];
    const shutters   = [[1,4000],[1,2000],[1,1000],[1,500],[1,250],[1,125],[1,60],[1,30]];
    const [expN, expD] = shutters[Math.floor(Math.random() * shutters.length)];

    const daysBack = Math.floor(Math.random() * 30);
    const dt       = new Date(Date.now() - daysBack * 86400000 - Math.floor(Math.random() * 72000000));
    const pad      = n => String(n).padStart(2, '0');
    const dtStr    = `${dt.getFullYear()}:${pad(dt.getMonth()+1)}:${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;

    const exifObj = {
      '0th': {
        271: cam.make,
        272: cam.model,
        274: 1,
        282: [72, 1],
        283: [72, 1],
        296: 2,
        305: cam.software,
        306: dtStr,
        531: 1,
      },
      'Exif': {
        33434: [expN, expD],
        33437: cam.fnum,
        34850: 2,
        34855: iso,
        36867: dtStr,
        36868: dtStr,
        37380: [0, 10],
        37383: 5,
        37385: 0,
        37386: cam.focal,
        40961: 1,
        41986: 0,
        41987: 0,
        41988: [1, 1],
        41989: cam.focal35,
        41990: 0,
      },
      'GPS': {},
      '1st': {},
    };

    const exifBytes = piexif.dump(exifObj);
    const result    = piexif.insert(exifBytes, stripped);
    const outBuf    = Buffer.from(result, 'binary');

    res.set('Content-Type', 'image/jpeg');
    res.set('X-Camera', `${cam.make} ${cam.model}`);
    res.send(outBuf);
  } catch (e) {
    console.error('EXIF error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Emoji ────────────────────────────────────────────────────────────────────
const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u;
const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

function isEmojiCluster(g) {
  return EMOJI_RE.test(g);
}

async function fetchEmoji(emoji) {
  if (emojiCache.has(emoji)) return emojiCache.get(emoji);
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

// ── X-Post SVG ───────────────────────────────────────────────────────────────
async function buildXPostSvg(rawText, photoB64, photoWidth, photoHeight, brand) {
  const W = 1080;
  const BG = '#1c1c1e';
  const CARD_W = 900;
  const CARD_X = (W - CARD_W) / 2;  // 90

  // Renkler
  const TEXT_COLOR  = '#0f1419';
  const HANDLE_CLR  = '#71767b';
  const HASHTAG_CLR = '#1d9bf0';
  const ENG_CLR     = '#536471';
  const CARD_BG     = '#ffffff';
  const DIVIDER_CLR = '#eff3f4';
  const WATERMARK_CLR = '#ffffff';

  // Ölçekler (1080 canvas)
  const AVATAR_R    = 48;
  const AVATAR_CX   = CARD_X + 48 + 56;  // 194
  const AVATAR_CY   = 256;

  const NAME_X      = AVATAR_CX + AVATAR_R + 20;
  const NAME_FS     = 34;
  const HANDLE_FS   = 26;

  const CARD_PAD    = 36;
  const TEXT_PAD_X  = CARD_X + CARD_PAD;
  const TEXT_W      = CARD_W - CARD_PAD * 2;
  const TEXT_FS     = 40;
  const TEXT_LH     = 64;
  const TEXT_MAX_CH = 36;
  const CHAR_W      = TEXT_FS * 0.55; // Tek bir yerde tanımlandı, hata giderildi.
  const HEADER_BOTTOM_GAP = 30;

  const PHOTO_H      = 420;
  const PHOTO_GAP    = 24;
  const PHOTO_CLIP_R = 20;

  const ENG_FS      = 24;
  const ENG_ICON_SZ = 36;

  const DATE_FS     = 24;

  const iconComment = 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z';
  const iconRt      = 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3';
  const iconHeart   = 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z';
  const iconBookmark = 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6 12 2 8 6M12 2v13';

  // ── Metin satırları (Boş satır optimizasyonu yapıldı) ─────────────────
  const paragraphs = rawText.split('\n');
  const lines = [];
  for (let p = 0; p < paragraphs.length; p++) {
    const currentP = paragraphs[p].trim();
    if (currentP === '') {
      lines.push({ text: '', isGap: true });
    } else {
      const wrapped = wrapText(currentP, TEXT_MAX_CH);
      for (const w of wrapped) {
        lines.push({ text: w, isGap: false });
      }
      if (p < paragraphs.length - 1 && paragraphs[p + 1].trim() !== '') {
        lines.push({ text: '', isGap: true });
      }
    }
  }

  // Emojileri önbelleğe al
  const allEmoji = new Set();
  for (const l of lines) {
    if (!l.text) continue;
    const segs = segmentLine(l.text);
    for (const s of segs) {
      if (s.type === 'emoji') allEmoji.add(s.value);
    }
  }
  await Promise.all([...allEmoji].map(fetchEmoji));

  // Metin toplam yüksekliğini hesapla
  const textH = lines.reduce((a, l) => {
    if (l.isGap) return a + TEXT_LH * 0.5;
    return a + TEXT_LH;
  }, 0);

  // Fotoğraf yükseklik dinamikleri (Sünme/taşma engellendi, computedPhotoH aktifleştirildi)
  const hasPhoto = photoB64 && photoB64.length > 0;
  const photoW = CARD_W - 72;
  const actualPhotoH = hasPhoto
    ? (photoWidth && photoHeight
        ? Math.min(Math.round(photoW * photoHeight / photoWidth), PHOTO_H * 1.5)
        : PHOTO_H)
    : 0;
  const photoGap = hasPhoto ? PHOTO_GAP : 0;

  // ── Kusursuz Dikey Akış ve Koordinasyon Zinciri ─────────────────────
  const cardY        = 0;
  const contentTop   = AVATAR_CY + AVATAR_R + HEADER_BOTTOM_GAP;
  const textStartY   = contentTop;
  const textEndY     = textStartY + textH;
  
  const photoY       = hasPhoto ? textEndY + photoGap : 0;
  const photoEndY    = hasPhoto ? photoY + actualPhotoH : textEndY;

  const dateY        = photoEndY + 36;
  const divY         = dateY + 36;
  const engY         = divY + 24;
  const cardBottomY  = engY + ENG_ICON_SZ + 48;

  const cardH        = cardBottomY;
  const wmY          = cardBottomY + 120;
  const H            = wmY + 100;

  // ── Metin elementleri (TSpan optimizasyonuyla harf binmesi engellendi) ──
  let curY = textStartY + TEXT_FS * 0.82;
  const els = [];
  const FS40 = `font-family="Inter" font-size="${TEXT_FS}" font-weight="400"`;

  for (const line of lines) {
    if (line.isGap) { curY += TEXT_LH * 0.5; continue; }
    if (!line.text) { curY += TEXT_LH; continue; }

    const segs = segmentLine(line.text);
    const hasHashtag = /#[\wçğıöşüÇĞİÖŞÜ]+/.test(line.text);
    const hasEmoji   = segs.some(s => s.type === 'emoji');

    if (!hasEmoji) {
      // Sadece düz metin veya hashtag içeren satırlar: TSpan ile tarayıcı tabanlı kusursuz akan yerleşim
      const parts = line.text.split(/(#[\wçğıöşüÇĞİÖŞÜ]+)/);
      let tspanMarkup = '';
      for (const part of parts) {
        if (!part) continue;
        const isHash = part.startsWith('#');
        tspanMarkup += `<tspan fill="${isHash ? HASHTAG_CLR : TEXT_COLOR}">${escapeXml(part)}</tspan>`;
      }
      els.push(
        `<text x="${TEXT_PAD_X}" y="${Math.round(curY)}" ${FS40}>${tspanMarkup}</text>`
      );
    } else {
      // Emoji barındıran satırlar için parça bazlı güvenli yerleşim
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

  // ── Kırpma ve Görsel Alanları ─────────────────────────────────────
  const profileClipId = 'profileClip';
  const profileData = `data:image/jpeg;base64,${brand.profileB64}`;

  const photoClip = hasPhoto ? `
    <clipPath id="photoClip">
      <rect x="${TEXT_PAD_X}" y="${Math.round(photoY)}" width="${photoW}" height="${actualPhotoH}" rx="${PHOTO_CLIP_R}"/>
    </clipPath>` : '';

  const photoImg = hasPhoto ? `
    <image x="${TEXT_PAD_X}" y="${Math.round(photoY)}"
           width="${photoW}" height="${actualPhotoH}"
           href="data:image/jpeg;base64,${photoB64}"
           clip-path="url(#photoClip)"
           preserveAspectRatio="xMidYMid slice"/>
    <rect x="${TEXT_PAD_X}" y="${Math.round(photoY)}" width="${photoW}" height="${actualPhotoH}"
          rx="${PHOTO_CLIP_R}" ry="${PHOTO_CLIP_R}" fill="none" stroke="${DIVIDER_CLR}" stroke-width="1"/>` : '';

  // Etkileşim Sayıları
  const comments = randInt(5, 80);
  const retweets = randInt(3, 40);
  const likes    = randInt(50, 500);
  const gapX = (CARD_W - 72 - ENG_ICON_SZ * 4) / 5;
  const engStartX = TEXT_PAD_X;

  // Tarih Yapısı
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

  <rect width="${W}" height="${H}" fill="${BG}"/>

  <rect x="${CARD_X}" y="${cardY}" width="${CARD_W}" height="${cardH}"
        rx="24" ry="24" fill="${CARD_BG}"/>

  <image x="${AVATAR_CX - AVATAR_R}" y="${AVATAR_CY - AVATAR_R}"
         width="${AVATAR_R * 2}" height="${AVATAR_R * 2}"
         href="${profileData}" clip-path="url(#${profileClipId})"/>
  <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="${AVATAR_R}"
          fill="none" stroke="${DIVIDER_CLR}" stroke-width="2"/>

  <text x="${NAME_X}" y="${AVATAR_CY - 14}"
        font-family="Inter" font-size="${NAME_FS}" font-weight="400"
        fill="${TEXT_COLOR}">${escapeXml(brand.name)}</text>

  <text x="${NAME_X}" y="${AVATAR_CY + 18}"
        font-family="Inter" font-size="${HANDLE_FS}" font-weight="400"
        fill="${HANDLE_CLR}">${escapeXml(brand.handle)}</text>

  ${els.join('\n  ')}

  ${photoImg}

  <text x="${TEXT_PAD_X}" y="${Math.round(dateY)}"
        font-family="Inter" font-size="${DATE_FS}" font-weight="400"
        fill="${HANDLE_CLR}">${dateStr}</text>

  <line x1="${TEXT_PAD_X}" y1="${Math.round(divY)}" x2="${TEXT_PAD_X + CARD_W - 72}" y2="${Math.round(divY)}"
        stroke="${DIVIDER_CLR}" stroke-width="1.5"/>

  <g transform="translate(${engStartX}, ${Math.round(engY)})">
    <svg width="${ENG_ICON_SZ}" height="${ENG_ICON_SZ}" viewBox="0 0 24 24">
      <path d="${iconComment}" fill="none" stroke="${ENG_CLR}" stroke-width="2"/>
    </svg>
    <text x="${ENG_ICON_SZ + 10}" y="${ENG_ICON_SZ * 0.75}"
          font-family="Inter" font-size="${ENG_FS}" font-weight="500"
          fill="${ENG_CLR}">${comments}</text>
  </g>

  <g transform="translate(${engStartX + (ENG_ICON_SZ + 10) * 1 + gapX * 1}, ${Math.round(engY)})">
    <svg width="${ENG_ICON_SZ}" height="${ENG_ICON_SZ}" viewBox="0 0 24 24">
      <path d="${iconRt}" fill="none" stroke="${ENG_CLR}" stroke-width="2"/>
    </svg>
    <text x="${ENG_ICON_SZ + 10}" y="${ENG_ICON_SZ * 0.75}"
          font-family="Inter" font-size="${ENG_FS}" font-weight="500"
          fill="${ENG_CLR}">${retweets}</text>
  </g>

  <g transform="translate(${engStartX + (ENG_ICON_SZ + 10) * 1 + gapX * 1 + (ENG_ICON_SZ + 10 + gapX) * 1}, ${Math.round(engY)})">
    <svg width="${ENG_ICON_SZ}" height="${ENG_ICON_SZ}" viewBox="0 0 24 24">
      <path d="${iconHeart}" fill="none" stroke="${ENG_CLR}" stroke-width="2"/>
    </svg>
    <text x="${ENG_ICON_SZ + 10}" y="${ENG_ICON_SZ * 0.75}"
          font-family="Inter" font-size="${ENG_FS}" font-weight="500"
          fill="${ENG_CLR}">${likes}</text>
  </g>

  <g transform="translate(${engStartX + (ENG_ICON_SZ + 10 + gapX) * 3}, ${Math.round(engY)})">
    <svg width="${ENG_ICON_SZ}" height="${ENG_ICON_SZ}" viewBox="0 0 24 24">
      <path d="${iconBookmark}" fill="none" stroke="${ENG_CLR}" stroke-width="2"/>
    </svg>
  </g>

  <text x="${W / 2}" y="${Math.round(wmY)}" text-anchor="middle"
        font-family="Inter" font-size="28" font-weight="400"
        fill="${WATERMARK_CLR}" opacity="0.35" letter-spacing="2">${escapeXml(brand.watermark)}</text>
  <text x="${W / 2}" y="${Math.round(wmY + 36)}" text-anchor="middle"
        font-family="Inter" font-size="20" font-weight="400"
        fill="${WATERMARK_CLR}" opacity="0.35">${escapeXml(brand.website)}</text>
</svg>`;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

app.listen(process.env.PORT || 3000, () =>
  console.log('Ready on port', process.env.PORT || 3000)
);