import express from 'express';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontBuffer = readFileSync(join(__dirname, 'inter.ttf'));
const LOGO_B64 = readFileSync(join(__dirname, 'logo_b64.txt'), 'utf8').trim();
const SECRET = process.env.IMAGE_SECRET || '';

const emojiCache = new Map();

const app = express();
app.use(express.json({ limit: '20kb' }));

app.get('/', (_, res) => res.send('Image service active ✅'));

app.post('/generate', async (req, res) => {
  if (SECRET && req.headers['x-secret'] !== SECRET)
    return res.status(401).json({ error: 'unauthorized' });

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    const svg = await buildSvg(text);
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

app.listen(process.env.PORT || 3000, () =>
  console.log('Ready on port', process.env.PORT || 3000)
);

// ── Emoji: Twemoji CDN'den PNG çek, base64 olarak göm ──────────────────────
const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;

async function fetchEmoji(emoji) {
  if (emojiCache.has(emoji)) return emojiCache.get(emoji);
  const codepoints = [...emoji]
    .map(c => c.codePointAt(0).toString(16))
    .filter(cp => cp !== 'fe0f')
    .join('-');
  try {
    const res = await fetch(
      `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${codepoints}.png`
    );
    if (!res.ok) { emojiCache.set(emoji, null); return null; }
    const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    const dataUrl = `data:image/png;base64,${b64}`;
    emojiCache.set(emoji, dataUrl);
    return dataUrl;
  } catch {
    emojiCache.set(emoji, null);
    return null;
  }
}

function segmentLine(text) {
  const segments = [];
  const re = new RegExp(EMOJI_RE.source, 'gu');
  let lastIndex = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex)
      segments.push({ type: 'text', value: text.slice(lastIndex, m.index) });
    segments.push({ type: 'emoji', value: m[0] });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length)
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  return segments;
}

function displayLen(s) {
  const re = new RegExp(EMOJI_RE.source, 'gu');
  let len = s.length, m;
  while ((m = re.exec(s)) !== null) len += 1; // emoji = 2 birim genişlik
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
      for (const ch of [...w]) {
        if (displayLen(chunk + ch) > max) { lines.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      if (chunk) cur = chunk;
    } else { cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// ── SVG oluştur ─────────────────────────────────────────────────────────────
async function buildSvg(rawText) {
  const W      = 1080;
  const CARD_W = 960;
  const CARD_X = (W - CARD_W) / 2;
  const PAD    = 60;
  const AVA_R  = 54;
  const avaCX  = CARD_X + PAD + AVA_R;
  const FS     = 48;
  const LH     = 78;
  const MAX_CH = 23;
  const CHAR_W = FS * 0.57;
  const EMOJI_SZ = FS * 1.05;

  const paragraphs = rawText.split('\n');
  const lines = [];
  for (let p = 0; p < paragraphs.length; p++) {
    lines.push(...wrapText(paragraphs[p].trim(), MAX_CH));
    if (p < paragraphs.length - 1) lines.push(null);
  }

  // Tüm emoji'leri önceden çek
  const allEmoji = new Set();
  for (const l of lines) {
    if (!l) continue;
    for (const s of segmentLine(l)) if (s.type === 'emoji') allEmoji.add(s.value);
  }
  await Promise.all([...allEmoji].map(fetchEmoji));

  const PROF_H  = AVA_R * 2;
  const SEP_GAP = 32;
  const SEP_H   = 2;
  const TEXT_GAP = 44;
  const TEXT_H  = lines.reduce((a, l) => a + (l === null ? LH * 0.6 : LH), 0);
  const BOT_GAP = 56;
  const FOOT_H  = 36;
  const ACC_H   = 10; // kırmızı accent çubuğu

  const CARD_H = Math.max(
    700,
    ACC_H + PAD + PROF_H + SEP_GAP + SEP_H + TEXT_GAP + TEXT_H + BOT_GAP + FOOT_H + PAD
  );

  const CARD_Y = 110;
  const H = Math.max(1920, CARD_Y + CARD_H + 110);

  const avaCY  = CARD_Y + ACC_H + PAD + AVA_R;
  const nameX  = avaCX + AVA_R + 20;
  const nameY  = avaCY - 12;
  const handleY = avaCY + 26;
  const LOGO_SZ = 62;
  const logoX  = CARD_X + CARD_W - PAD - LOGO_SZ;
  const logoY  = CARD_Y + ACC_H + PAD + (AVA_R - LOGO_SZ / 2);
  const sepY   = CARD_Y + ACC_H + PAD + PROF_H + SEP_GAP;

  let curY = sepY + SEP_H + TEXT_GAP + FS * 0.82;

  // Metin + emoji elementleri
  const els = [];
  for (const line of lines) {
    if (line === null) { curY += LH * 0.6; continue; }

    const segs = segmentLine(line);
    const hasEmoji = segs.some(s => s.type === 'emoji');

    if (!hasEmoji) {
      els.push(
        `<text x="${CARD_X + PAD}" y="${Math.round(curY)}"
          font-family="Inter" font-size="${FS}" font-weight="700" fill="#111827"
          stroke="#111827" stroke-width="0.35" paint-order="stroke fill">${escapeXml(line)}</text>`
      );
    } else {
      let x = CARD_X + PAD;
      for (const seg of segs) {
        if (seg.type === 'text' && seg.value) {
          els.push(
            `<text x="${Math.round(x)}" y="${Math.round(curY)}"
              font-family="Inter" font-size="${FS}" font-weight="700" fill="#111827"
              stroke="#111827" stroke-width="0.35" paint-order="stroke fill">${escapeXml(seg.value)}</text>`
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
          x += EMOJI_SZ + 3;
        }
      }
    }
    curY += LH;
  }

  const footY = CARD_Y + CARD_H - PAD - 4;
  const footX = CARD_X + CARD_W - PAD;
  const RX    = 28;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
     xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <clipPath id="ava">
      <circle cx="${avaCX}" cy="${avaCY}" r="${AVA_R}"/>
    </clipPath>
    <filter id="shadow" x="-6%" y="-4%" width="124%" height="118%">
      <feDropShadow dx="0" dy="14" stdDeviation="26" flood-color="#000" flood-opacity="0.35"/>
    </filter>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="#0D1117"/>
      <stop offset="100%" stop-color="#161B27"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#B91C1C"/>
      <stop offset="100%" stop-color="#EF4444"/>
    </linearGradient>
    <linearGradient id="sep" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#E5E7EB"/>
      <stop offset="50%" stop-color="#D1D5DB"/>
      <stop offset="100%" stop-color="#E5E7EB"/>
    </linearGradient>
  </defs>

  <!-- Arka plan -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Kart gölge + gövde -->
  <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_W}" height="${CARD_H}"
        rx="${RX}" ry="${RX}" fill="#FFFFFF" filter="url(#shadow)"/>

  <!-- Kırmızı accent şerit (üst) -->
  <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_W}" height="${ACC_H + RX}"
        rx="${RX}" ry="${RX}" fill="url(#accent)"/>
  <rect x="${CARD_X}" y="${CARD_Y + ACC_H}" width="${CARD_W}" height="${RX}" fill="#FFFFFF"/>

  <!-- Avatar -->
  <image x="${avaCX - AVA_R}" y="${avaCY - AVA_R}"
         width="${AVA_R * 2}" height="${AVA_R * 2}"
         href="data:image/png;base64,${LOGO_B64}" clip-path="url(#ava)"/>
  <circle cx="${avaCX}" cy="${avaCY}" r="${AVA_R}"
          fill="none" stroke="#E5E7EB" stroke-width="2.5"/>

  <!-- İsim ve handle -->
  <text x="${nameX}" y="${nameY}"
        font-family="Inter" font-size="25" font-weight="800" fill="#111827">SELHATTİN KOÇ İNŞAAT TAAHHÜT</text>
  <text x="${nameX}" y="${handleY}"
        font-family="Inter" font-size="22" fill="#6B7280">@selhattinkocinsaat</text>

  <!-- Sağ logo -->
  <image x="${logoX}" y="${logoY}" width="${LOGO_SZ}" height="${LOGO_SZ}"
         href="data:image/png;base64,${LOGO_B64}"/>

  <!-- Ayırıcı çizgi -->
  <line x1="${CARD_X + PAD}" y1="${sepY}" x2="${CARD_X + CARD_W - PAD}" y2="${sepY}"
        stroke="url(#sep)" stroke-width="${SEP_H}"/>

  <!-- İçerik -->
  ${els.join('\n  ')}

  <!-- Footer -->
  <text x="${footX}" y="${footY}"
        font-family="Inter" font-size="20" fill="#9CA3AF" text-anchor="end">SELHATTİN KOÇ İNŞAAT TAAHHÜT</text>
</svg>`;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
