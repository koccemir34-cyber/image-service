import express from 'express';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontBuffer = readFileSync(join(__dirname, 'inter.ttf'));
const LOGO_B64 = readFileSync(join(__dirname, 'logo_b64.txt'), 'utf8').trim();
const SECRET = process.env.IMAGE_SECRET || '';

const app = express();
app.use(express.json({ limit: '20kb' }));

app.get('/', (_, res) => res.send('Image service active ✅'));

app.post('/generate', (req, res) => {
  if (SECRET && req.headers['x-secret'] !== SECRET)
    return res.status(401).json({ error: 'unauthorized' });

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    const resvg = new Resvg(buildSvg(text), {
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

function buildSvg(rawText) {
  const W = 1080, H = 1920;
  const CARD_W = 980;
  const CARD_X = (W - CARD_W) / 2;
  const PAD = 64;
  const AVA_R = 58;
  const avaCX = CARD_X + PAD + AVA_R;
  const FS = 46;
  const LH = 72;
  const MAX_CH = 26;

  const paragraphs = rawText.split('\n');
  const lines = [];
  for (let p = 0; p < paragraphs.length; p++) {
    lines.push(...wrapText(paragraphs[p].trim(), MAX_CH));
    if (p < paragraphs.length - 1) lines.push(null);
  }

  const PROF_H = AVA_R * 2;
  const SEP_GAP = 36;
  const SEP_H = 2;
  const TEXT_GAP = 44;
  const TEXT_H = lines.reduce((a, l) => a + (l === null ? LH * 0.65 : LH), 0);
  const BOT_GAP = 50;
  const FOOT_H = 38;

  const CARD_H = Math.max(
    700,
    PAD + PROF_H + SEP_GAP + SEP_H + TEXT_GAP + TEXT_H + BOT_GAP + FOOT_H + PAD
  );

  const CARD_Y = Math.max(120, Math.round((H - CARD_H) / 2) - 60);
  const avaCY = CARD_Y + PAD + AVA_R;
  const nameX = avaCX + AVA_R + 22;
  const nameY = avaCY - 14;
  const handleY = avaCY + 28;
  const LOGO_SZ = 66;
  const logoX = CARD_X + CARD_W - PAD - LOGO_SZ;
  const logoY = CARD_Y + PAD + (AVA_R - LOGO_SZ / 2);
  const sepY = CARD_Y + PAD + PROF_H + SEP_GAP;

  let curY = sepY + SEP_H + TEXT_GAP + FS * 0.82;
  const textEls = lines.map(line => {
    if (line === null) { curY += LH * 0.65; return ''; }
    const el = `<text x="${CARD_X + PAD}" y="${Math.round(curY)}"
      font-family="Inter" font-size="${FS}" fill="#0F1419"
      text-anchor="start">${escapeXml(line)}</text>`;
    curY += LH;
    return el;
  }).join('\n    ');

  const footY = CARD_Y + CARD_H - PAD - 4;
  const footX = CARD_X + CARD_W - PAD;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
     xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <clipPath id="ava">
      <circle cx="${avaCX}" cy="${avaCY}" r="${AVA_R}"/>
    </clipPath>
    <filter id="shadow" x="-4%" y="-4%" width="115%" height="115%">
      <feDropShadow dx="0" dy="8" stdDeviation="20"
                    flood-color="#000" flood-opacity="0.28"/>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="#1A1A1A"/>

  <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_W}" height="${CARD_H}"
        rx="40" ry="40" fill="#FFFFFF" filter="url(#shadow)"/>

  <image x="${avaCX - AVA_R}" y="${avaCY - AVA_R}"
         width="${AVA_R * 2}" height="${AVA_R * 2}"
         href="data:image/png;base64,${LOGO_B64}"
         clip-path="url(#ava)"/>
  <circle cx="${avaCX}" cy="${avaCY}" r="${AVA_R}"
          fill="none" stroke="#E0E0E0" stroke-width="2"/>

  <text x="${nameX}" y="${nameY}"
        font-family="Inter" font-size="26" font-weight="700"
        fill="#0F1419">SELHATTİN KOÇ İNŞAAT TAAHHÜT</text>
  <text x="${nameX}" y="${handleY}"
        font-family="Inter" font-size="24"
        fill="#536471">@selhattinkocinsaat</text>

  <image x="${logoX}" y="${logoY}"
         width="${LOGO_SZ}" height="${LOGO_SZ}"
         href="data:image/png;base64,${LOGO_B64}"/>

  <line x1="${CARD_X + PAD}" y1="${sepY}"
        x2="${CARD_X + CARD_W - PAD}" y2="${sepY}"
        stroke="#EBEBEB" stroke-width="${SEP_H}"/>

  ${textEls}

  <text x="${footX}" y="${footY}"
        font-family="Inter" font-size="22"
        fill="#9BA3AF" text-anchor="end">SELHATTİN KOÇ İNŞAAT TAAHHÜT</text>
</svg>`;
}

function wrapText(text, max) {
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (cand.length <= max) { cur = cand; continue; }
    if (cur) lines.push(cur);
    if (w.length > max) {
      for (let i = 0; i < w.length; i += max) lines.push(w.slice(i, i + max));
      cur = '';
    } else { cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
