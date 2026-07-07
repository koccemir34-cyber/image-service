'use strict';

const path = require('path');
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

// Four Telegram photos can be considerably larger after Base64 encoding.
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
    .resize({
      width,
      height,
      fit: 'contain',
      background
    })
    .flatten({ background })
    .png()
    .toBuffer();
}

// The existing story renderer accepts one photoBuffer. Multiple photos are
// converted into one wide image with equal vertical panels before it reaches story.js.
async function buildVerticalPhotoStack(photoBuffers, layoutMode = 'smart_adaptive') {
  const source = Array.isArray(photoBuffers) ? photoBuffers.filter(Boolean).slice(0, 4) : [];
  if (!source.length) return null;
  if (source.length === 1) return source[0];

  const preset = getMosaicPreset(layoutMode, source.length);
  const { width, height, padding, gap, outerBackground, panelBackground } = preset;
  const panelWidth = width - (padding * 2);
  const panelHeight = Math.floor((height - (padding * 2) - (gap * (source.length - 1))) / source.length);

  const panels = await Promise.all(
    source.map((buffer) => makePanel(buffer, panelWidth, panelHeight, panelBackground))
  );

  const composite = panels.map((input, index) => ({
    input,
    left: padding,
    top: padding + (index * (panelHeight + gap))
  }));

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: outerBackground
    }
  })
    .composite(composite)
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
    const envKeys = [
      'PROFILE_NAME',
      'PROFILE_HANDLE',
      'FOOTER_TITLE',
      'FOOTER_URL',
      'LOGO_PATH'
    ];

    const previous = {};
    for (const key of envKeys) {
      previous[key] = Object.prototype.hasOwnProperty.call(process.env, key)
        ? process.env[key]
        : undefined;
    }

    const logoPath = await materializeProfileLogo(__dirname, brand);

    try {
      process.env.PROFILE_NAME = brand.profileName;
      process.env.PROFILE_HANDLE = brand.profileHandle;
      process.env.FOOTER_TITLE = brand.footerTitle;
      process.env.FOOTER_URL = brand.footerUrl;

      if (logoPath) {
        process.env.LOGO_PATH = logoPath;
      } else {
        delete process.env.LOGO_PATH;
      }

      // story.js reads its configuration while it is required. Reload it for
      // every queued brand render so SK Story and Remaz Story never mix.
      delete require.cache[STORY_MODULE_PATH];
      const { makeSkStory } = require('./story');

      return makeSkStory(input);
    } finally {
      delete require.cache[STORY_MODULE_PATH];

      for (const key of envKeys) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
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
    service: 'skstory-render-v11.6-multiphoto',
    renderer: 'sharp',
    multiPhoto: true,
    maxPhotos: 4,
    timestamp: new Date().toISOString()
  });
});

app.post('/generate', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const text = normalizeText(req.body?.text);
  if (!text) {
    return res.status(400).json({ error: 'text required' });
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `text too long (max ${MAX_TEXT_LENGTH})` });
  }

  try {
    const brand = resolveBrand(req.body || {});
    const engagementSettings = normalizeEngagementSettings(req.body?.engagementSettings);
    const photoLayoutMode = normalizeText(req.body?.photoLayoutMode) || 'smart_adaptive';
    const photoBuffers = collectPhotoBuffers(req.body || {});
    const photoBuffer = await buildVerticalPhotoStack(photoBuffers, photoLayoutMode);

    const png = await renderWithBrand(brand, {
      text,
      photoBuffer,
      engagementSettings
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Renderer-Version', 'skstory-render-v11.6-multiphoto');
    res.setHeader('X-Photo-Count', String(photoBuffers.length));
    return res.send(png);
  } catch (error) {
    console.error('Render error:', error);
    return res.status(500).json({
      error: 'render failed',
      message: String(error?.message || error || 'unknown error')
    });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SK Story render service listening on ${PORT}`);
  });
}

module.exports = {
  app,
  buildVerticalPhotoStack
};
