'use strict';

const path = require('path');
const express = require('express');
const sharp = require('sharp');
const {
  resolveBrand,
  materializeProfileLogo,
  normalizeEngagementSettings,
  collectPhotoBuffers
} = require('./brand-runtime');

// Render service root'u image-service olabilir; tasarım kodu ve yerel logo yolları
// her durumda bu klasöre göre çözülür.
process.chdir(__dirname);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const IMAGE_SECRET = String(process.env.IMAGE_SECRET || '').trim();
const MAX_TEXT_LENGTH = 950;
const STORY_MODULE = path.join(__dirname, 'story.js');

app.disable('x-powered-by');
app.use(express.json({ limit: '72mb' }));

// story.js içindeki CONFIG modül yüklenirken process.env'den okunuyor. Aynı anda gelen
// SK/Remaz istekleri birbirine karışmasın diye marka render işlemleri sıraya alınır.
let renderQueue = Promise.resolve();

function enqueueRender(task) {
  const previous = renderQueue.catch(() => {});
  let release;
  renderQueue = new Promise((resolve) => { release = resolve; });
  return previous.then(task).finally(release);
}

function isAuthorized(req) {
  return !IMAGE_SECRET || String(req.get('x-secret') || '').trim() === IMAGE_SECRET;
}

function setEnv(name, value, snapshot) {
  snapshot[name] = Object.prototype.hasOwnProperty.call(process.env, name)
    ? process.env[name]
    : undefined;
  process.env[name] = String(value || '');
}

function restoreEnv(snapshot) {
  for (const [name, original] of Object.entries(snapshot)) {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
}

async function makeVerticalPhotoStack(buffers) {
  if (!Array.isArray(buffers) || buffers.length < 2) return buffers?.[0] || null;

  const tileWidth = 1600;
  const tileHeight = 410;
  const gap = 18;
  const tiles = [];

  for (const buffer of buffers) {
    const blurred = await sharp(buffer)
      .rotate()
      .resize(tileWidth, tileHeight, { fit: 'cover', position: 'centre' })
      .blur(14)
      .modulate({ brightness: 0.86, saturation: 0.84 })
      .png()
      .toBuffer();

    const contained = await sharp(buffer)
      .rotate()
      .resize(tileWidth, tileHeight, {
        fit: 'contain',
        position: 'centre',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();

    tiles.push(await sharp(blurred)
      .composite([{ input: contained, left: 0, top: 0 }])
      .png()
      .toBuffer());
  }

  const height = (tileHeight * tiles.length) + (gap * (tiles.length - 1));
  return sharp({
    create: {
      width: tileWidth,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
    .composite(tiles.map((input, index) => ({
      input,
      left: 0,
      top: index * (tileHeight + gap)
    })))
    .png()
    .toBuffer();
}

async function resolvePhotoBuffer(body) {
  const buffers = collectPhotoBuffers(body);
  if (!buffers.length) return null;
  if (buffers.length === 1) return buffers[0];
  return makeVerticalPhotoStack(buffers);
}

async function renderStory({ body, text }) {
  const brand = resolveBrand(body);
  const logoPath = await materializeProfileLogo(__dirname, brand);
  const photoBuffer = await resolvePhotoBuffer(body);
  const engagementSettings = normalizeEngagementSettings(body.engagementSettings);

  return enqueueRender(async () => {
    const snapshot = {};

    try {
      setEnv('PROFILE_NAME', brand.profileName, snapshot);
      setEnv('PROFILE_HANDLE', brand.profileHandle, snapshot);
      setEnv('FOOTER_TITLE', brand.footerTitle, snapshot);
      setEnv('FOOTER_URL', brand.footerUrl, snapshot);
      if (logoPath) setEnv('LOGO_PATH', logoPath, snapshot);

      delete require.cache[require.resolve(STORY_MODULE)];
      const { makeSkStory } = require(STORY_MODULE);

      return await makeSkStory({
        text,
        photoBuffer,
        engagementSettings
      });
    } finally {
      delete require.cache[require.resolve(STORY_MODULE)];
      restoreEnv(snapshot);
    }
  });
}

app.get('/', (_req, res) => {
  res.type('text/plain').send('SK Story + Remaz Story render service active');
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'sk-remaz-image-service-v11.5',
    renderer: 'sharp',
    dynamicBrands: ['skstory', 'remazstory'],
    remazBrand: {
      profileName: 'Remaz İnşaat',
      profileHandle: '@remazinsaat',
      footerTitle: 'REMAZ İNŞAAT',
      footerUrl: 'remazinsaat.web.app'
    },
    timestamp: new Date().toISOString()
  });
});

app.post('/generate', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'text required' });
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `text too long (max ${MAX_TEXT_LENGTH})` });
  }

  try {
    const brand = resolveBrand(req.body || {});
    const png = await renderStory({ body: req.body || {}, text });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Renderer-Version', 'sk-remaz-image-service-v11.5');
    res.setHeader('X-Story-Brand', brand.id);
    return res.send(png);
  } catch (error) {
    console.error('Render error:', error?.stack || error);
    return res.status(500).json({ error: 'render failed' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SK + Remaz image service v11.5 listening on ${PORT}`);
  });
}

module.exports = { app, resolvePhotoBuffer, renderStory };
