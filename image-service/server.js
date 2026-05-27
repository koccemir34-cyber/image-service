import express from 'express';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontBuffer      = readFileSync(join(__dirname, 'inter.ttf'));
const LOGO_SK_B64     = readFileSync(join(__dirname, 'logo_b64.txt'), 'utf8').trim();
const LOGO_REMAZ_B64  = readFileSync(join(__dirname, 'logo_remaz_b64.txt'), 'utf8').trim();
const SECRET          = process.env.IMAGE_SECRET || '';

const BRANDS = {
  selhattin: {
    logoB64:  LOGO_SK_B64,
    logoMime: 'image/jpeg',
    line1:    'SELHATTİN KOÇ',
    line2:    'İNŞAAT TAAHHÜT',
    handle:   '@selhattinkocinsaat',
    website:  'selhattinkoc.web.app',
  },
  remaz: {
    logoB64:  LOGO_REMAZ_B64,
    logoMime: 'image/png',
    line1:    'REMAZ İNŞAAT',
    line2:    'TAAHHÜT',
    handle:   '@remazinsaat',
    website:  'remazinsaat.web.app',
  },
};

const emojiCache = new Map();

const app = express();
app.use(express.json({ limit: '15mb' }));

app.get('/', (_, res) => res.send('Image service active ✅'));

app.post('/generate', async (req, res) => {
  if (SECRET && req.headers['x-secret'] !== SECRET)
    return res.status(401).json({ error: 'unauthorized' });

  const { text, photoB64, photoWidth, photoHeight, brand } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (text.length > 600) return res.status(400).json({ error: 'text too long' });

  const brandCfg = BRANDS[brand] || BRANDS.selhattin;

  try {
    const svg = await buildSvg(text, photoB64 || null, photoWidth || null, photoHeight || null, brandCfg);
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
const CAMERA_PROFILES = [
  { make: 'Apple',   model: 'iPhone 14 Pro',    software: '16.5.1',           fnum: [178, 100], focal: [686, 100], focal35: 24 },
  { make: 'Apple',   model: 'iPhone 15',        software: '17.4.1',           fnum: [160, 100], focal: [570, 100], focal35: 26 },
  { make: 'Apple',   model: 'iPhone 15 Pro Max',software: '17.5',             fnum: [178, 100], focal: [686, 100], focal35: 24 },
  { make: 'samsung', model: 'SM-S918B',         software: 'S918BXXS5EXD5',   fnum: [170, 100], focal: [630, 100], focal35: 23 },
  { make: 'Google',  model: 'Pixel 8 Pro',      software: 'UP1A.231005.007',  fnum: [168, 100], focal: [650, 100], focal35: 24 },
  { make: 'Sony',    model: 'XQ-EC72',          software: '13.4.0.0.3',       fnum: [190, 100], focal: [240, 100], focal35: 24 },
];

app.post('/exif', (req, res) => {
  if (SECRET && req.headers['x-secret'] !== SECRET)
    return res.status(401).json({ error: 'unauthorized' });

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
async function buildSvg(rawText, photoB64, photoWidth, photoHeight, brand) {
  brand = brand || BRANDS.selhattin;
  const W = 1080;

  // Brand
  const NAVY = '#0D1B3E';
  const RED  = '#C1272D';

  // Header band
  const HDR_H   = 230;
  const LOGO_R  = 70;
  const LOGO_CX = 110;
  const LOGO_CY = HDR_H / 2;

  // Content
  const PAD      = 72;
  const TEXT_X   = PAD;
  const TEXT_W   = W - PAD * 2;
  const FS       = 50;
  const LH       = 82;
  const MAX_CH   = 26;
  const CHAR_W   = FS * 0.57;
  const EMOJI_SZ = FS * 1.05;

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

  const TEXT_H = lines.reduce((a, l) => a + (l === null ? LH * 0.6 : LH), 0);

  // Fotoğraf boyutları — gerçek en/boy oranını koru, max 780px
  const PHOTO_H = photoB64
    ? (photoWidth && photoHeight
        ? Math.min(Math.round(TEXT_W * photoHeight / photoWidth), 780)
        : 520)
    : 0;
  const PHOTO_GAP = photoB64 ? 52 : 0;

  // Koordinatlar
  const CONTENT_Y = HDR_H + 68;
  const TEXT_END  = CONTENT_Y + TEXT_H;
  const PHOTO_Y   = TEXT_END + PHOTO_GAP;
  const PHOTO_END = photoB64 ? PHOTO_Y + PHOTO_H : TEXT_END;

  const FTR_H = 155;
  const FTR_Y = Math.max(1920 - FTR_H, PHOTO_END + 68);
  const H     = FTR_Y + FTR_H;

  // Metin elementleri
  let curY = CONTENT_Y + FS * 0.85;
  const els = [];

  for (const line of lines) {
    if (line === null) { curY += LH * 0.6; continue; }

    const segs     = segmentLine(line);
    const hasEmoji = segs.some(s => s.type === 'emoji');

    if (!hasEmoji) {
      els.push(
        `<text x="${TEXT_X}" y="${Math.round(curY)}"
          font-family="Inter Variable" font-size="${FS}" font-weight="700"
          fill="${NAVY}">${escapeXml(line)}</text>`
      );
    } else {
      let x = TEXT_X;
      for (const seg of segs) {
        if (seg.type === 'text' && seg.value) {
          els.push(
            `<text x="${Math.round(x)}" y="${Math.round(curY)}"
              font-family="Inter Variable" font-size="${FS}" font-weight="700"
              fill="${NAVY}">${escapeXml(seg.value)}</text>`
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
  const photoClip = photoB64 ? `
    <clipPath id="photoClip">
      <rect x="${TEXT_X}" y="${Math.round(PHOTO_Y)}"
            width="${TEXT_W}" height="${PHOTO_H}" rx="16" ry="16"/>
    </clipPath>` : '';

  const photoImg = photoB64 ? `
  <image x="${TEXT_X}" y="${Math.round(PHOTO_Y)}"
         width="${TEXT_W}" height="${PHOTO_H}"
         href="data:image/jpeg;base64,${photoB64}"
         clip-path="url(#photoClip)" filter="url(#pShadow)"
         preserveAspectRatio="xMidYMid meet"/>` : '';

  // TR saatiyle tarih
  const now     = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const dateStr = `${String(now.getUTCDate()).padStart(2,'0')}.${String(now.getUTCMonth()+1).padStart(2,'0')}.${now.getUTCFullYear()}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
     xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <clipPath id="logoClip">
      <circle cx="${LOGO_CX}" cy="${LOGO_CY}" r="${LOGO_R}"/>
    </clipPath>
    ${photoClip}

    <linearGradient id="hdrGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${NAVY}"/>
      <stop offset="100%" stop-color="#162444"/>
    </linearGradient>

    <filter id="pShadow" x="-4%" y="-3%" width="112%" height="116%">
      <feDropShadow dx="0" dy="6" stdDeviation="14"
                    flood-color="#000000" flood-opacity="0.16"/>
    </filter>
  </defs>

  <!-- Beyaz arka plan -->
  <rect width="${W}" height="${H}" fill="#FFFFFF"/>

  <!-- Header band -->
  <rect x="0" y="0" width="${W}" height="${HDR_H}" fill="url(#hdrGrad)"/>
  <!-- Header alt kırmızı stripe -->
  <rect x="0" y="${HDR_H - 7}" width="${W}" height="7" fill="${RED}"/>

  <!-- Logo dairesi -->
  <image x="${LOGO_CX - LOGO_R}" y="${LOGO_CY - LOGO_R}"
         width="${LOGO_R * 2}" height="${LOGO_R * 2}"
         href="data:${brand.logoMime};base64,${brand.logoB64}" clip-path="url(#logoClip)"/>
  <circle cx="${LOGO_CX}" cy="${LOGO_CY}" r="${LOGO_R}"
          fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2.5"/>

  <!-- Şirket bilgisi -->
  <text x="206" y="${LOGO_CY - 24}"
        font-family="Inter Variable" font-size="42" font-weight="900"
        fill="#FFFFFF">${escapeXml(brand.line1)}</text>
  <text x="206" y="${LOGO_CY + 18}"
        font-family="Inter Variable" font-size="25" font-weight="700"
        fill="${RED}">${escapeXml(brand.line2)}</text>
  <text x="206" y="${LOGO_CY + 52}"
        font-family="Inter Variable" font-size="20" font-weight="400"
        fill="rgba(255,255,255,0.45)">${escapeXml(brand.handle)}</text>


  <!-- İçerik metni -->
  ${els.join('\n  ')}

  <!-- Fotoğraf -->
  ${photoImg}

  <!-- Footer -->
  <rect x="0" y="${FTR_Y}" width="${W}" height="${FTR_H}" fill="#F1F5F9"/>
  <rect x="0" y="${FTR_Y}" width="${W}" height="4" fill="${RED}"/>
  <text x="${W / 2}" y="${FTR_Y + 66}" text-anchor="middle"
        font-family="Inter Variable" font-size="26" font-weight="600"
        fill="#334155">${escapeXml(brand.website)}</text>
  <text x="${W / 2}" y="${FTR_Y + 108}" text-anchor="middle"
        font-family="Inter Variable" font-size="20" font-weight="400"
        fill="#94A3B8">${dateStr}</text>
</svg>`;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}


