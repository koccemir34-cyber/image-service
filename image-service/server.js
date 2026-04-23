import express from 'express';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontBuffer = readFileSync(join(__dirname, 'inter.ttf'));
const LOGO_B64   = readFileSync(join(__dirname, 'logo_b64.txt'), 'utf8').trim();
const SECRET     = process.env.IMAGE_SECRET || '';

const emojiCache = new Map();

const app = express();
app.use(express.json({ limit: '15mb' }));

app.get('/', (_, res) => res.send('Image service active ✅'));

app.post('/generate', async (req, res) => {
  if (SECRET && req.headers['x-secret'] !== SECRET)
    return res.status(401).json({ error: 'unauthorized' });

  const { text, photoB64 } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (text.length > 600) return res.status(400).json({ error: 'text too long (max 600 chars)' });

  try {
    const svg = await buildSvg(text, photoB64 || null);
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

// ── Emoji: Twemoji CDN ───────────────────────────────────────────────────────
const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;

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
  while ((m = re.exec(s)) !== null) len += 1;
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

// ── SVG ─────────────────────────────────────────────────────────────────────
async function buildSvg(rawText, photoB64) {
  const W  = 1080;
  const H  = 1920;
  const CX = W / 2;

  // Typography
  const FS       = 58;
  const LH       = 90;
  const MAX_CH   = 22;
  const CHAR_W   = FS * 0.54;
  const EMOJI_SZ = FS * 1.1;

  // Layout anchors
  const LOGO_R    = 82;
  const LOGO_CY   = 198;
  const DIV_Y     = 468;
  const CONTENT_T = DIV_Y + 44;
  const CONTENT_B = 1738;
  const BDIV_Y    = 1752;
  const MARGIN    = 90;

  // Parse text into wrapped lines
  const paragraphs = rawText.split('\n');
  const lines = [];
  for (let p = 0; p < paragraphs.length; p++) {
    lines.push(...wrapText(paragraphs[p].trim(), MAX_CH));
    if (p < paragraphs.length - 1) lines.push(null);
  }

  // Prefetch all emoji in parallel
  const allEmoji = new Set();
  for (const l of lines) {
    if (!l) continue;
    for (const s of segmentLine(l)) if (s.type === 'emoji') allEmoji.add(s.value);
  }
  await Promise.all([...allEmoji].map(fetchEmoji));

  // Vertically center text block in content zone
  const TEXT_H = lines.reduce((a, l) => a + (l === null ? LH * 0.5 : LH), 0);
  const ZONE_H = CONTENT_B - CONTENT_T;
  let curY = CONTENT_T + Math.max(0, (ZONE_H - TEXT_H) / 2) + FS * 0.82;

  // Build SVG text elements (all centered on CX)
  const els = [];
  for (const line of lines) {
    if (line === null) { curY += LH * 0.5; continue; }

    const segs     = segmentLine(line);
    const hasEmoji = segs.some(s => s.type === 'emoji');

    if (!hasEmoji) {
      els.push(
        `<text x="${CX}" y="${Math.round(curY)}"
          text-anchor="middle" font-family="Inter"
          font-size="${FS}" font-weight="700" fill="#FFFFFF">${escapeXml(line)}</text>`
      );
    } else {
      // Calculate total line width for manual centering
      let lineW = 0;
      for (const seg of segs) {
        if (seg.type === 'text') lineW += seg.value.length * CHAR_W;
        else lineW += EMOJI_SZ + 6;
      }
      let x = CX - lineW / 2;
      for (const seg of segs) {
        if (seg.type === 'text' && seg.value) {
          els.push(
            `<text x="${Math.round(x)}" y="${Math.round(curY)}"
              font-family="Inter" font-size="${FS}" font-weight="700"
              fill="#FFFFFF">${escapeXml(seg.value)}</text>`
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
          x += EMOJI_SZ + 6;
        }
      }
    }
    curY += LH;
  }

  const now = new Date();
  const dateStr = `${now.getDate().toString().padStart(2,'0')}.${(now.getMonth()+1).toString().padStart(2,'0')}.${now.getFullYear()}`;

  // Background: photo-as-canvas or geometric dark
  const background = photoB64 ? `
    <image x="0" y="0" width="${W}" height="${H}"
           href="data:image/jpeg;base64,${photoB64}"
           preserveAspectRatio="xMidYMid slice"/>
    <rect width="${W}" height="${H}" fill="url(#photoOverlay)"/>` : `
    <rect width="${W}" height="${H}" fill="url(#bgGrad)"/>
    <rect width="${W}" height="${H}" fill="url(#diagonalPat)" opacity="1"/>
    <circle cx="1200" cy="160" r="580" fill="url(#glowRed)" opacity="0.09"/>
    <circle cx="-170" cy="1780" r="480" fill="url(#glowRed)" opacity="0.07"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
     xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <clipPath id="logoClip">
      <circle cx="${CX}" cy="${LOGO_CY}" r="${LOGO_R}"/>
    </clipPath>

    <!-- Background gradient (no-photo mode) -->
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0.1" y2="1">
      <stop offset="0%"   stop-color="#0F1117"/>
      <stop offset="100%" stop-color="#0B0D13"/>
    </linearGradient>

    <!-- Photo overlay: dark top/bottom, lighter middle to show photo -->
    <linearGradient id="photoOverlay" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#000000" stop-opacity="0.92"/>
      <stop offset="26%"  stop-color="#000000" stop-opacity="0.55"/>
      <stop offset="60%"  stop-color="#000000" stop-opacity="0.40"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.88"/>
    </linearGradient>

    <!-- Red ambient glow -->
    <radialGradient id="glowRed" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#DC2626"/>
      <stop offset="100%" stop-color="#DC2626" stop-opacity="0"/>
    </radialGradient>

    <!-- Red gradient (horizontal) -->
    <linearGradient id="redGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#991B1B"/>
      <stop offset="100%" stop-color="#EF4444"/>
    </linearGradient>

    <!-- Divider line: fade in/out -->
    <linearGradient id="divLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#EF4444" stop-opacity="0"/>
      <stop offset="12%"  stop-color="#EF4444" stop-opacity="0.9"/>
      <stop offset="88%"  stop-color="#EF4444" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#EF4444" stop-opacity="0"/>
    </linearGradient>

    <!-- Logo outer glow -->
    <radialGradient id="logoGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#EF4444" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#EF4444" stop-opacity="0"/>
    </radialGradient>

    <!-- Subtle diagonal line texture -->
    <pattern id="diagonalPat" width="72" height="72"
             patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="72"
            stroke="#FFFFFF" stroke-width="0.35" stroke-opacity="0.022"/>
    </pattern>

    <!-- Text drop shadow -->
    <filter id="tShadow" x="-8%" y="-15%" width="116%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="8"
                    flood-color="#000000" flood-opacity="0.75"/>
    </filter>
  </defs>

  <!-- ── Background ──────────────────────────────────────────────── -->
  ${background}

  <!-- ── Top accent bar ─────────────────────────────────────────── -->
  <rect x="0" y="0" width="${W}" height="6" fill="url(#redGrad)"/>

  <!-- ── Logo section ───────────────────────────────────────────── -->
  <!-- Outer glow ring -->
  <circle cx="${CX}" cy="${LOGO_CY}" r="${LOGO_R + 38}" fill="url(#logoGlow)"/>
  <!-- White logo background -->
  <circle cx="${CX}" cy="${LOGO_CY}" r="${LOGO_R}" fill="#FFFFFF"/>
  <!-- Logo image -->
  <image x="${CX - LOGO_R}" y="${LOGO_CY - LOGO_R}"
         width="${LOGO_R * 2}" height="${LOGO_R * 2}"
         href="data:image/png;base64,${LOGO_B64}"
         clip-path="url(#logoClip)"/>
  <!-- Logo border -->
  <circle cx="${CX}" cy="${LOGO_CY}" r="${LOGO_R}"
          fill="none" stroke="url(#redGrad)" stroke-width="3.5"/>

  <!-- ── Company name ───────────────────────────────────────────── -->
  <text x="${CX}" y="${LOGO_CY + LOGO_R + 52}"
        text-anchor="middle" font-family="Inter"
        font-size="38" font-weight="800" fill="#FFFFFF">SELHATTİN KOÇ</text>
  <text x="${CX}" y="${LOGO_CY + LOGO_R + 96}"
        text-anchor="middle" font-family="Inter"
        font-size="27" font-weight="600" fill="#EF4444">İNŞAAT TAAHHÜT</text>
  <text x="${CX}" y="${LOGO_CY + LOGO_R + 136}"
        text-anchor="middle" font-family="Inter"
        font-size="21" font-weight="400" fill="#9CA3AF">@selhattinkocinsaat</text>

  <!-- ── Top divider ────────────────────────────────────────────── -->
  <line x1="${MARGIN}" y1="${DIV_Y}" x2="${W - MARGIN}" y2="${DIV_Y}"
        stroke="url(#divLine)" stroke-width="1.5"/>

  <!-- ── Content text (vertically centered in zone) ────────────── -->
  <g filter="url(#tShadow)">
    ${els.join('\n    ')}
  </g>

  <!-- ── Bottom divider ────────────────────────────────────────── -->
  <line x1="${MARGIN}" y1="${BDIV_Y}" x2="${W - MARGIN}" y2="${BDIV_Y}"
        stroke="url(#divLine)" stroke-width="1.5"/>

  <!-- ── Footer ────────────────────────────────────────────────── -->
  <text x="${CX}" y="${BDIV_Y + 64}"
        text-anchor="middle" font-family="Inter"
        font-size="21" font-weight="600" fill="#D1D5DB">SELHATTİN KOÇ İNŞAAT TAAHHÜT</text>
  <text x="${CX}" y="${BDIV_Y + 102}"
        text-anchor="middle" font-family="Inter"
        font-size="19" font-weight="400" fill="#6B7280">${dateStr}</text>

  <!-- Bottom accent bar -->
  <rect x="0" y="${H - 6}" width="${W}" height="6" fill="url(#redGrad)"/>
</svg>`;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
