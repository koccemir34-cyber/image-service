'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
process.chdir(__dirname);

const express = require('express');
const sharp = require('sharp');
const {
  resolveBrand,
  materializeProfileLogo,
  normalizeEngagementSettings,
  collectPhotoBuffers
} = require('./brand-runtime');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const IMAGE_SECRET = String(process.env.IMAGE_SECRET || '');
const MAX_TEXT_LENGTH = 950;
const STORY_MODULE_PATH = require.resolve('./story');
const MAX_PROFILE_BYTES = 10 * 1024 * 1024;

app.disable('x-powered-by');
app.use(express.json({ limit: '70mb' }));

function isAuthorized(req) {
  return !IMAGE_SECRET || req.get('x-secret') === IMAGE_SECRET;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getMosaicPreset(layoutMode, photoCount) {
  const count = Math.max(2, Math.min(4, Number(photoCount) || 2));
  const normalWide = layoutMode === 'normal_16_4';
  return {
    width: 1600,
    height: normalWide ? 500 : 520,
    padding: 14,
    gap: count >= 3 ? 12 : 16,
    outerBackground: { r: 255, g: 255, b: 255, alpha: 1 },
    panelBackground: { r: 241, g: 244, b: 247, alpha: 1 }
  };
}

async function makePanel(buffer, width, height, background) {
  return sharp(buffer)
    .rotate()
    .resize({ width, height, fit: 'contain', background })
    .flatten({ background })
    .png()
    .toBuffer();
}

async function buildVerticalPhotoStack(photoBuffers, layoutMode = 'smart_adaptive') {
  const source = Array.isArray(photoBuffers) ? photoBuffers.filter(Boolean).slice(0, 4) : [];
  if (!source.length) return null;
  if (source.length === 1) return source[0];

  const preset = getMosaicPreset(layoutMode, source.length);
  const { width, height, padding, gap, outerBackground, panelBackground } = preset;
  const panelWidth = width - (padding * 2);
  const panelHeight = Math.floor((height - (padding * 2) - (gap * (source.length - 1))) / source.length);

  const panels = await Promise.all(source.map((buffer) => makePanel(buffer, panelWidth, panelHeight, panelBackground)));
  const composite = panels.map((input, index) => ({
    input,
    left: padding,
    top: padding + (index * (panelHeight + gap))
  }));

  return sharp({ create: { width, height, channels: 4, background: outerBackground } })
    .composite(composite)
    .png()
    .toBuffer();
}

function decodeBase64(value, label) {
  const text = typeof value === 'string' ? value.replace(/^data:[^;]+;base64,/i, '').replace(/\s/g, '') : '';
  if (!text) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    throw new Error(`${label} base64 is invalid.`);
  }
  const buffer = Buffer.from(text, 'base64');
  if (!buffer.length || buffer.length > MAX_PROFILE_BYTES) {
    throw new Error(`${label} exceeds the allowed size.`);
  }
  return buffer;
}

function safeImageExtension(participant) {
  const name = String(participant?.profileImageFileName || '').toLowerCase();
  const mime = String(participant?.profileImageMimeType || '').toLowerCase();
  if (name.endsWith('.webp') || mime.includes('webp')) return '.webp';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg') || mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  return '.png';
}

async function materializeParticipantLogo(serviceRoot, participant, fallbackBrand) {
  const direct = decodeBase64(participant?.profileImageB64, `${fallbackBrand} profile image`);
  if (direct) {
    const cacheDir = path.join('/tmp', 'sk-remaz-story-profiles');
    await fs.mkdir(cacheDir, { recursive: true });
    const hash = crypto.createHash('sha256').update(direct).digest('hex').slice(0, 20);
    const output = path.join(cacheDir, `${fallbackBrand}-${hash}${safeImageExtension(participant)}`);
    try {
      await fs.access(output);
    } catch {
      await fs.writeFile(output, direct, { mode: 0o600 });
    }
    return output;
  }

  const candidates = [
    path.join(serviceRoot, fallbackBrand, 'logo.png'),
    path.join(serviceRoot, fallbackBrand, 'profile.png'),
    path.join(serviceRoot, 'assets', `${fallbackBrand}.png`),
    path.join(serviceRoot, 'assets', 'logo.png')
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

async function makeRoundAvatar(logoPath, size) {
  if (!logoPath) {
    return sharp({
      create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
    }).png().toBuffer();
  }

  const raw = await fs.readFile(logoPath);
  const innerSize = size - 8;
  const circleMask = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${(size / 2) - 2}" fill="#ffffff"/>
    </svg>`
  );
  const border = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${(size / 2) - 2}" fill="none" stroke="#d7dde5" stroke-width="2"/>
    </svg>`
  );

  const logo = await sharp(raw)
    .rotate()
    .resize({ width: innerSize, height: innerSize, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();

  const logoX = Math.round((size - innerSize) / 2);
  const logoY = logoX;

  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
  })
    .composite([
      { input: circleMask, left: 0, top: 0, blend: 'dest-in' },
      { input: logo, left: logoX, top: logoY },
      { input: border, left: 0, top: 0 }
    ])
    .png()
    .toBuffer();
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function dualHeaderSvg(secondName, secondHandle) {
  return Buffer.from(
    `<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
      <circle cx="530" cy="264" r="24" fill="#0f172a" stroke="#c7a24a" stroke-width="2"/>
      <text x="530" y="273" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="700" fill="#ffffff">↔</text>
      <text x="655" y="252" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" fill="#0f172a">${escapeXml(secondName)}</text>
      <text x="655" y="286" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="400" fill="#6b7280">${escapeXml(secondHandle)}</text>
    </svg>`
  );
}

async function applyDualHeaderOverlay(basePng, secondaryLogoPath, secondName, secondHandle) {
  const secondaryAvatar = await makeRoundAvatar(secondaryLogoPath, 78);
  return sharp(basePng)
    .composite([
      { input: dualHeaderSvg(secondName, secondHandle), left: 0, top: 0 },
      { input: secondaryAvatar, left: 560, top: 225 }
    ])
    .png()
    .toBuffer();
}

let renderQueue = Promise.resolve();
function enqueueRender(task) {
  const next = renderQueue.then(task, task);
  renderQueue = next.catch(() => {});
  return next;
}

async function renderWithBrand(brand, input) {
  return enqueueRender(async () => {
    const envKeys = ['PROFILE_NAME', 'PROFILE_HANDLE', 'FOOTER_TITLE', 'FOOTER_URL', 'LOGO_PATH'];
    const previous = {};
    for (const key of envKeys) {
      previous[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    }

    const isOrtak = brand.id === 'ortak' && Array.isArray(brand.sharedParticipants) && brand.sharedParticipants.length >= 2;
    const participantA = isOrtak ? brand.sharedParticipants[0] : null;
    const participantB = isOrtak ? brand.sharedParticipants[1] : null;
    const primaryLogoPath = isOrtak
      ? await materializeParticipantLogo(__dirname, participantA, 'skstory')
      : await materializeProfileLogo(__dirname, brand);
    const secondaryLogoPath = isOrtak
      ? await materializeParticipantLogo(__dirname, participantB, 'remazstory')
      : null;

    try {
      process.env.PROFILE_NAME = isOrtak
        ? (participantA?.profileDisplayName || 'Selhattin Koç')
        : brand.profileName;
      process.env.PROFILE_HANDLE = isOrtak
        ? (participantA?.profileUsername || '@selhattinkocinsaat')
        : brand.profileHandle;
      process.env.FOOTER_TITLE = brand.footerTitle;
      process.env.FOOTER_URL = brand.footerUrl;

      if (primaryLogoPath) process.env.LOGO_PATH = primaryLogoPath;
      else delete process.env.LOGO_PATH;

      delete require.cache[STORY_MODULE_PATH];
      const { makeSkStory } = require('./story');
      const basePng = await makeSkStory(input);

      if (!isOrtak) return basePng;

      return applyDualHeaderOverlay(
        basePng,
        secondaryLogoPath,
        participantB?.profileDisplayName || 'Remaz İnşaat',
        participantB?.profileUsername || '@remazinsaat'
      );
    } finally {
      delete require.cache[STORY_MODULE_PATH];
      for (const key of envKeys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });
}

app.get('/', (_req, res) => {
  res.type('text/plain').send('SK Story render service active');
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'skstory-render-v11.9-ortak-two-avatars',
    renderer: 'sharp',
    multiPhoto: true,
    ortakHeader: 'two-separate-avatars',
    timestamp: new Date().toISOString()
  });
});

app.post('/generate', async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });

  const text = normalizeText(req.body?.text);
  if (!text) return res.status(400).json({ error: 'text required' });
  if (text.length > MAX_TEXT_LENGTH) return res.status(400).json({ error: `text too long (max ${MAX_TEXT_LENGTH})` });

  try {
    const brand = resolveBrand(req.body || {});
    const engagementSettings = normalizeEngagementSettings(req.body?.engagementSettings);
    const photoLayoutMode = normalizeText(req.body?.photoLayoutMode) || 'smart_adaptive';
    const photoBuffers = collectPhotoBuffers(req.body || {});
    const photoBuffer = await buildVerticalPhotoStack(photoBuffers, photoLayoutMode);
    const png = await renderWithBrand(brand, { text, photoBuffer, engagementSettings });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Renderer-Version', 'skstory-render-v11.9-ortak-two-avatars');
    res.setHeader('X-Photo-Count', String(photoBuffers.length));
    return res.send(png);
  } catch (error) {
    console.error('Render error:', error);
    return res.status(500).json({ error: 'render failed', message: String(error?.message || error || 'unknown error') });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SK Story render service listening on ${PORT}`);
  });
}

module.exports = { app, buildVerticalPhotoStack, applyDualHeaderOverlay, makeRoundAvatar };
