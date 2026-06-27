const path = require('path');

// Render service may launch from the repository root. Force all relative asset paths
// in story.js to resolve inside image-service.
process.chdir(__dirname);

const express = require('express');
const { makeSkStory } = require('./story');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const IMAGE_SECRET = String(process.env.IMAGE_SECRET || '');
const MAX_TEXT_LENGTH = 950;
const MAX_RAW_PHOTO_BYTES = 12 * 1024 * 1024;

app.disable('x-powered-by');
app.use(express.json({ limit: '18mb' }));

function isAuthorized(req) {
  // The existing Cloudflare Worker already has IMAGE_SECRET as a secret. If the
  // Render service has the same secret configured, every render request must match it.
  return !IMAGE_SECRET || req.get('x-secret') === IMAGE_SECRET;
}

function normalizeEngagementSettings(value) {
  if (!value || typeof value !== 'object') return null;

  if (value.mode === 'random') return { mode: 'random' };

  if (value.mode === 'manual') {
    const toCount = (item) => {
      const number = Number(item);
      return Number.isFinite(number) && number >= 0 && number <= 999999
        ? Math.round(number)
        : 0;
    };

    return {
      mode: 'manual',
      likes: toCount(value.likes),
      comments: toCount(value.comments),
      reposts: toCount(value.reposts)
    };
  }

  return null;
}

function decodePhoto(photoB64) {
  if (!photoB64) return null;

  const normalized = String(photoB64)
    .replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
    .replace(/\s/g, '');

  if (!normalized) return null;

  const buffer = Buffer.from(normalized, 'base64');

  if (!buffer.length || buffer.length > MAX_RAW_PHOTO_BYTES) {
    throw new Error('Fotoğraf boyutu desteklenen sınırı aşıyor.');
  }

  return buffer;
}

app.get('/', (_req, res) => {
  res.type('text/plain').send('SK Story render service active');
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'skstory-render-v1',
    renderer: 'sharp',
    timestamp: new Date().toISOString()
  });
});

app.post('/generate', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

  if (!text) {
    return res.status(400).json({ error: 'text required' });
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `text too long (max ${MAX_TEXT_LENGTH})` });
  }

  try {
    const photoBuffer = decodePhoto(req.body?.photoB64);
    const engagementSettings = normalizeEngagementSettings(req.body?.engagementSettings);

    const png = await makeSkStory({
      text,
      photoBuffer,
      engagementSettings
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Renderer-Version', 'skstory-render-v1');
    return res.send(png);
  } catch (error) {
    console.error('Render error:', error);
    return res.status(500).json({ error: 'render failed' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SK Story render service listening on ${PORT}`);
});
