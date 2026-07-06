import express from 'express';
import { Resvg } from '@resvg/resvg-js';
import { existsSync, readFileSync } from 'fs';
import { dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const SECRET = process.env.IMAGE_SECRET || '';

app.use(express.json({ limit: '70mb' }));

const BRAND_CONFIG = {
  skstory: {
    folder: 'skstory',
    name: 'Selhattin Koç',
    handle: '@selhattinkocinsaat',
    watermark: 'SELHATTİN KOÇ İNŞAAT',
    website: 'selhattinkoc.web.app'
  },
  remazstory: {
    folder: 'remazstory',
    name: 'Remaz İnşaat',
    handle: '@remazinsaat',
    watermark: 'REMAZ İNŞAAT',
    website: 'remazinsaat.web.app'
  }
};

app.get('/', (_req, res) => res.type('text/plain').send('SK + Remaz image service active'));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'sk-remaz-image-service-v9' }));

app.post('/generate', async (req, res) => {
  if (SECRET && req.headers['x-secret'] !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { text, brand, wide16x4, engagementSettings } = req.body || {};
  if (!String(text || '').trim()) return res.status(400).json({ error: 'text required' });
  if (String(text).length > 950) return res.status(400).json({ error: 'text too long' });

  const brandId = canonicalBrandId(brand);
  const photos = normalizePhotos(req.body);

  try {
    const svg = await buildXPostSvg({
      text: String(text),
      photos,
      brand: loadBrand(brandId),
      wide16x4: Boolean(wide16x4),
      engagementSettings: normalizeEngagement(engagementSettings)
    });

    const png = new Resvg(svg, {
      fitTo: { mode: 'original' },
      font: { loadSystemFonts: true, defaultFontFamily: 'Arial', sansSerifFamily: 'Arial' }
    }).render().asPng();

    res.set('Content-Type', 'image/png');
    res.send(Buffer.from(png));
  } catch (error) {
    console.error('Generate error:', error?.stack || error);
    res.status(500).json({ error: error?.message || 'render failed' });
  }
});

// Önceki işleyişi bozmamak için endpoint korunur. EXIF işlemine ihtiyaç yoksa 204 döner.
app.post('/exif', (req, res) => {
  if (SECRET && req.headers['x-secret'] !== SECRET) return res.status(401).json({ error: 'unauthorized' });
  res.status(204).end();
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`SK + Remaz image service ready on ${process.env.PORT || 3000}`);
});


function canonicalBrandId(value) {
  const normalized = String(value || '').toLocaleLowerCase('tr-TR');
  if (normalized === 'remaz' || normalized === 'remazstory') return 'remazstory';
  return 'skstory';
}

function normalizePhotos(body) {
  const source = Array.isArray(body?.photos) && body.photos.length ? body.photos : (body?.photoB64 ? [{
    data: body.photoB64,
    width: body.photoWidth,
    height: body.photoHeight,
    mime: 'image/jpeg'
  }] : []);

  return source.slice(0, 4).map((photo) => ({
    data: String(photo?.data || photo?.photoB64 || ''),
    width: Math.max(1, Number(photo?.width || photo?.photoWidth || 0) || 1),
    height: Math.max(1, Number(photo?.height || photo?.photoHeight || 0) || 1),
    mime: /^image\/(png|jpeg|jpg|webp|gif)$/i.test(String(photo?.mime || '')) ? String(photo.mime) : 'image/jpeg'
  })).filter((photo) => photo.data);
}

function loadBrand(id) {
  const cfg = BRAND_CONFIG[id] || BRAND_CONFIG.skstory;
  const profile = readFirstImage(join(__dirname, cfg.folder), ['profile.jpg', 'profile.jpeg', 'profile.png', 'profile.webp', 'logo.jpg', 'logo.jpeg', 'logo.png', 'logo.webp']);
  return { ...cfg, profile };
}

function readFirstImage(folder, filenames) {
  for (const file of filenames) {
    const full = join(folder, file);
    if (!existsSync(full)) continue;
    const extension = extname(full).toLowerCase();
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    return { data: readFileSync(full).toString('base64'), mime };
  }
  return null;
}

function normalizeEngagement(settings) {
  if (settings?.mode === 'manual') {
    return {
      likes: clampInteger(settings.likes, 0, 999999),
      comments: clampInteger(settings.comments, 0, 999999),
      reposts: clampInteger(settings.reposts, 0, 999999)
    };
  }
  return {
    likes: randomInt(80, 10000),
    comments: randomInt(1, 300),
    reposts: randomInt(1, 300)
  };
}

function clampInteger(value, min, max) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function buildXPostSvg({ text, photos, brand, wide16x4, engagementSettings }) {
  const W = 1080;
  const CARD_W = 900;
  const CARD_X = 90;
  const CARD_Y = 88;
  const CARD_PAD = 42;
  const PHOTO_W = CARD_W - CARD_PAD * 2;
  const palette = {
    background: '#15191e',
    card: '#ffffff',
    text: '#0f1419',
    muted: '#536471',
    divider: '#eff3f4',
    hashtag: '#1d9bf0',
    imageBg: '#f1f4f6',
    watermark: '#ffffff'
  };

  const rawLines = formatTextLines(text, 42);
  const textFontSize = 30;
  const textLineHeight = 46;
  const textStartY = CARD_Y + 184;
  const textEls = [];
  let textY = textStartY;

  for (const line of rawLines) {
    if (line.gap) {
      textY += Math.round(textLineHeight * 0.52);
      continue;
    }
    textEls.push(renderTextLine(line.value, CARD_X + CARD_PAD, textY, textFontSize, palette));
    textY += textLineHeight;
  }

  const textEndY = textY + 8;
  const photoLayout = renderPhotoLayout({ photos, wide16x4, x: CARD_X + CARD_PAD, y: textEndY + (photos.length ? 16 : 0), width: PHOTO_W, palette });
  const dateY = (photos.length ? photoLayout.endY : textEndY) + 54;
  const dividerY = dateY + 31;
  const engagementY = dividerY + 25;
  const engagementH = 34;
  const cardBottom = engagementY + engagementH + 38;
  const cardH = cardBottom - CARD_Y;
  const totalH = cardBottom + 120;
  const profile = brand.profile ? `data:${brand.profile.mime};base64,${brand.profile.data}` : null;
  const avatar = profile
    ? `<clipPath id="avatarClip"><circle cx="${CARD_X + 92}" cy="${CARD_Y + 92}" r="48"/></clipPath><image href="${profile}" x="${CARD_X + 44}" y="${CARD_Y + 44}" width="96" height="96" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice"/><circle cx="${CARD_X + 92}" cy="${CARD_Y + 92}" r="48" fill="none" stroke="#e6ecf0" stroke-width="1"/>`
    : `<circle cx="${CARD_X + 92}" cy="${CARD_Y + 92}" r="48" fill="#17212b"/><text x="${CARD_X + 92}" y="${CARD_Y + 104}" text-anchor="middle" font-family="Arial" font-size="38" font-weight="700" fill="#ffffff">${escapeXml(initials(brand.name))}</text>`;

  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const time = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
  const date = `${time} · ${now.getUTCDate()} ${months[now.getUTCMonth()]} ${now.getUTCFullYear()}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}">
    <rect width="100%" height="100%" fill="${palette.background}"/>
    <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_W}" height="${cardH}" rx="28" fill="${palette.card}"/>
    ${avatar}
    <text x="${CARD_X + 162}" y="${CARD_Y + 83}" font-family="Arial" font-size="32" font-weight="700" fill="${palette.text}">${escapeXml(brand.name)}</text>
    <text x="${CARD_X + 162}" y="${CARD_Y + 116}" font-family="Arial" font-size="24" fill="${palette.muted}">${escapeXml(brand.handle)}</text>
    ${textEls.join('\n')}
    ${photoLayout.svg}
    <text x="${CARD_X + CARD_PAD}" y="${dateY}" font-family="Arial" font-size="23" fill="${palette.muted}">${escapeXml(date)}</text>
    <line x1="${CARD_X + CARD_PAD}" y1="${dividerY}" x2="${CARD_X + CARD_W - CARD_PAD}" y2="${dividerY}" stroke="${palette.divider}" stroke-width="2"/>
    ${renderEngagementBar({ x: CARD_X + CARD_PAD, y: engagementY, width: PHOTO_W, values: engagementSettings, color: palette.muted })}
    <text x="${W / 2}" y="${cardBottom + 62}" text-anchor="middle" font-family="Arial" font-size="22" font-weight="700" fill="${palette.watermark}">${escapeXml(brand.watermark)}</text>
    <text x="${W / 2}" y="${cardBottom + 91}" text-anchor="middle" font-family="Arial" font-size="19" fill="#d6d9dc">${escapeXml(brand.website)}</text>
  </svg>`;
}

function formatTextLines(rawText, maxChars) {
  const hashtags = [];
  const body = String(rawText || '').replace(/#[\wçğıöşüÇĞİÖŞÜ]+/g, (tag) => {
    hashtags.push(tag);
    return '';
  }).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();

  const lines = [];
  for (const paragraph of body.split('\n')) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      if (lines.length) lines.push({ gap: true });
      continue;
    }
    for (const line of wrapText(trimmed, maxChars)) lines.push({ value: line });
  }
  if (hashtags.length) {
    lines.push({ gap: true });
    for (const tag of hashtags) lines.push({ value: tag, hashtagOnly: true });
  }
  return lines.length ? lines : [{ value: '' }];
}

function wrapText(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if ([...candidate].length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function renderTextLine(text, x, y, fontSize, palette) {
  const escaped = escapeXml(text);
  const parts = escaped.split(/(#[\wçğıöşüÇĞİÖŞÜ]+)/g).filter(Boolean);
  if (parts.length === 1 && !parts[0].startsWith('#')) {
    return `<text x="${x}" y="${y}" font-family="Arial" font-size="${fontSize}" font-weight="700" fill="${palette.text}">${parts[0]}</text>`;
  }

  let currentX = x;
  return parts.map((part) => {
    const color = part.startsWith('#') ? palette.hashtag : palette.text;
    const output = `<text x="${currentX}" y="${y}" font-family="Arial" font-size="${fontSize}" font-weight="700" fill="${color}">${part}</text>`;
    currentX += estimateTextWidth(part, fontSize);
    return output;
  }).join('');
}

function estimateTextWidth(value, fontSize) {
  return [...String(value)].length * fontSize * 0.56;
}

function renderPhotoLayout({ photos, wide16x4, x, y, width, palette }) {
  if (!photos.length) return { svg: '', endY: y };
  const clips = [];
  const els = [];
  const gap = 8;
  const radius = 18;

  const renderCell = (photo, cellX, cellY, cellW, cellH, index, fit = 'xMidYMid meet') => {
    const clipId = `photoClip${index}`;
    const href = `data:${photo.mime};base64,${photo.data}`;
    clips.push(`<clipPath id="${clipId}"><rect x="${cellX}" y="${cellY}" width="${cellW}" height="${cellH}" rx="${radius}"/></clipPath>`);
    els.push(`<rect x="${cellX}" y="${cellY}" width="${cellW}" height="${cellH}" rx="${radius}" fill="${palette.imageBg}"/>`);
    els.push(`<image href="${href}" x="${cellX}" y="${cellY}" width="${cellW}" height="${cellH}" clip-path="url(#${clipId})" preserveAspectRatio="${fit}"/>`);
    els.push(`<rect x="${cellX}" y="${cellY}" width="${cellW}" height="${cellH}" rx="${radius}" fill="none" stroke="#dce3e8" stroke-width="1"/>`);
  };

  let height = 0;
  if (wide16x4) {
    height = Math.round(width / 4);
    const cellW = (width - gap * (photos.length - 1)) / photos.length;
    photos.forEach((photo, index) => renderCell(photo, Math.round(x + index * (cellW + gap)), y, Math.round(cellW), height, index, 'xMidYMid meet'));
  } else if (photos.length === 1) {
    const ratio = photos[0].height / photos[0].width;
    height = Math.max(260, Math.min(760, Math.round(width * ratio)));
    renderCell(photos[0], x, y, width, height, 0, 'xMidYMid meet');
  } else if (photos.length === 2) {
    height = 500;
    const cellW = Math.floor((width - gap) / 2);
    renderCell(photos[0], x, y, cellW, height, 0, 'xMidYMid meet');
    renderCell(photos[1], x + cellW + gap, y, cellW, height, 1, 'xMidYMid meet');
  } else if (photos.length === 3) {
    height = 560;
    const leftW = Math.floor((width - gap) * 0.62);
    const rightW = width - gap - leftW;
    const halfH = Math.floor((height - gap) / 2);
    renderCell(photos[0], x, y, leftW, height, 0, 'xMidYMid meet');
    renderCell(photos[1], x + leftW + gap, y, rightW, halfH, 1, 'xMidYMid meet');
    renderCell(photos[2], x + leftW + gap, y + halfH + gap, rightW, halfH, 2, 'xMidYMid meet');
  } else {
    height = 620;
    const cellW = Math.floor((width - gap) / 2);
    const cellH = Math.floor((height - gap) / 2);
    renderCell(photos[0], x, y, cellW, cellH, 0, 'xMidYMid meet');
    renderCell(photos[1], x + cellW + gap, y, cellW, cellH, 1, 'xMidYMid meet');
    renderCell(photos[2], x, y + cellH + gap, cellW, cellH, 2, 'xMidYMid meet');
    renderCell(photos[3], x + cellW + gap, y + cellH + gap, cellW, cellH, 3, 'xMidYMid meet');
  }

  return { svg: `<defs>${clips.join('')}</defs>${els.join('')}`, endY: y + height };
}

function renderEngagementBar({ x, y, width, values, color }) {
  const iconSize = 28;
  const textSize = 23;
  const placements = [
    { key: 'comments', icon: iconComment(), x },
    { key: 'reposts', icon: iconRepost(), x: x + width * 0.28 },
    { key: 'likes', icon: iconHeart(), x: x + width * 0.56 }
  ];

  return placements.map((item) => {
    const label = formatCount(values[item.key]);
    return `<g transform="translate(${Math.round(item.x)}, ${Math.round(y)})">
      <svg x="0" y="0" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" aria-hidden="true">
        <path d="${item.icon}" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <text x="${iconSize + 11}" y="${Math.round(iconSize / 2) + 1}" dominant-baseline="middle" font-family="Arial" font-size="${textSize}" font-weight="600" fill="${color}">${escapeXml(label)}</text>
    </g>`;
  }).join('');
}

function iconComment() { return 'M21 11.5a8.38 8.38 0 0 1-8.5 8.25 9.4 9.4 0 0 1-4.13-.96L3 20.5l1.62-4.44A8.03 8.03 0 0 1 4 13.1 8.38 8.38 0 0 1 12.5 4.8 8.38 8.38 0 0 1 21 11.5Z'; }
function iconRepost() { return 'M17 3l4 4-4 4M3 7h18M7 21l-4-4 4-4M21 17H3'; }
function iconHeart() { return 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z'; }

function formatCount(value) {
  const n = Number(value) || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace('.0', '')} Mn`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '')} B`;
  return String(n);
}

function initials(name) {
  return String(name).split(/\s+/).map((word) => word[0] || '').join('').slice(0, 2).toUpperCase();
}

function escapeXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
