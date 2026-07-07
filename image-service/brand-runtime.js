'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MAX_PROFILE_BYTES = 4 * 1024 * 1024;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

const BRAND_DEFAULTS = Object.freeze({
  skstory: Object.freeze({
    id: 'skstory',
    profileName: 'Selhattin Koç',
    profileHandle: '@selhattinkocinsaat',
    footerTitle: 'SELHATTİN KOÇ İNŞAAT',
    footerUrl: 'selhattinkoc.web.app'
  }),
  remazstory: Object.freeze({
    id: 'remazstory',
    profileName: 'Remaz İnşaat',
    profileHandle: '@remazinsaat',
    footerTitle: 'REMAZ İNŞAAT',
    footerUrl: 'remazinsaat.web.app'
  })
});

function firstText(...values) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const cleaned = value.trim();
    if (cleaned) return cleaned;
  }
  return '';
}

function normalizeBrandId(value) {
  return String(value || '').trim().toLocaleLowerCase('tr-TR') === 'remazstory'
    ? 'remazstory'
    : 'skstory';
}

function resolveBrand(body = {}) {
  const nested = body && typeof body.brand === 'object' && body.brand ? body.brand : {};
  const id = normalizeBrandId(firstText(body.brandId, nested.id, body.brand));
  const defaults = BRAND_DEFAULTS[id];

  // Marka kimliği Worker tarafından belirlenir. Remaz için gelen yanlış/boş alanların
  // eski Selhattin Koç metnine geri dönmesine izin verilmez.
  const fixed = id === 'remazstory';
  const profileName = fixed
    ? defaults.profileName
    : firstText(body.profileDisplayName, body.profileName, nested.profileDisplayName, nested.profileName, body.authorName, nested.authorName, defaults.profileName);
  const profileHandle = fixed
    ? defaults.profileHandle
    : firstText(body.profileUsername, body.accountHandle, body.username, nested.profileUsername, nested.accountHandle, nested.username, defaults.profileHandle);
  const footerTitle = fixed
    ? defaults.footerTitle
    : firstText(body.footerBrandText, body.footerTitle, body.watermarkName, nested.footerBrandText, nested.footerTitle, nested.watermarkName, defaults.footerTitle);
  const footerUrl = fixed
    ? defaults.footerUrl
    : firstText(body.footerWebsiteText, body.footerSite, body.websiteUrl, nested.footerWebsiteText, nested.footerSite, nested.websiteUrl, defaults.footerUrl);

  return {
    id,
    profileName,
    profileHandle,
    footerTitle,
    footerUrl,
    profileImageB64: firstText(body.profileImageB64, nested.profileImageB64),
    profileImageMimeType: firstText(body.profileImageMimeType, nested.profileImageMimeType),
    profileImageFileName: firstText(body.profileImageFileName, nested.profileImageFileName)
  };
}

function base64ToBuffer(value, maxBytes, label) {
  if (!value) return null;
  const normalized = String(value)
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s/g, '');

  if (!normalized) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`${label} base64 biçimi geçersiz.`);
  }

  const buffer = Buffer.from(normalized, 'base64');
  if (!buffer.length || buffer.length > maxBytes) {
    throw new Error(`${label} boyutu desteklenen sınırı aşıyor.`);
  }
  return buffer;
}

function safeExt(mimeType, fileName) {
  const mime = String(mimeType || '').toLowerCase();
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (mime.includes('svg') || ext === '.svg') return '.svg';
  if (mime.includes('webp') || ext === '.webp') return '.webp';
  if (mime.includes('jpeg') || mime.includes('jpg') || ext === '.jpg' || ext === '.jpeg') return '.jpg';
  return '.png';
}

async function fileExists(candidate) {
  try {
    const stat = await fs.stat(candidate);
    return stat.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

async function findLocalLogo(serviceRoot, brandId) {
  const candidates = [
    path.join(serviceRoot, brandId, 'logo.png'),
    path.join(serviceRoot, brandId, 'logo.jpg'),
    path.join(serviceRoot, brandId, 'logo.jpeg'),
    path.join(serviceRoot, brandId, 'logo.webp'),
    path.join(serviceRoot, brandId, 'logo.svg'),
    path.join(serviceRoot, brandId, 'profile.png'),
    path.join(serviceRoot, brandId, 'profile.jpg'),
    path.join(serviceRoot, brandId, 'profile.jpeg'),
    path.join(serviceRoot, brandId, 'profile.webp'),
    path.join(serviceRoot, brandId, 'profile.svg'),
    path.join(serviceRoot, 'assets', `${brandId}.png`),
    path.join(serviceRoot, 'assets', 'logo.png')
  ];

  for (const candidate of candidates) {
    const found = await fileExists(candidate);
    if (found) return found;
  }
  return null;
}

async function materializeProfileLogo(serviceRoot, brand) {
  const fromRequest = base64ToBuffer(brand.profileImageB64, MAX_PROFILE_BYTES, 'Profil görseli');
  if (!fromRequest) return findLocalLogo(serviceRoot, brand.id);

  const cacheDir = path.join('/tmp', 'sk-remaz-story-profiles');
  await fs.mkdir(cacheDir, { recursive: true });

  const ext = safeExt(brand.profileImageMimeType, brand.profileImageFileName);
  const hash = crypto.createHash('sha256').update(fromRequest).digest('hex').slice(0, 20);
  const output = path.join(cacheDir, `${brand.id}-${hash}${ext}`);

  try {
    await fs.access(output);
  } catch {
    await fs.writeFile(output, fromRequest, { mode: 0o600 });
  }

  return output;
}

function normalizeEngagementSettings(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.mode === 'random') return { mode: 'random' };
  if (value.mode !== 'manual') return null;

  const toCount = (item) => {
    const number = Number(item);
    return Number.isFinite(number) && number >= 0 && number <= 999999 ? Math.round(number) : 0;
  };

  return {
    mode: 'manual',
    likes: toCount(value.likes),
    comments: toCount(value.comments),
    reposts: toCount(value.reposts)
  };
}

function collectPhotoBuffers(body = {}) {
  const candidates = [];
  const push = (item) => {
    if (typeof item !== 'string' || !item.trim()) return;
    if (!candidates.includes(item)) candidates.push(item);
  };

  if (Array.isArray(body.photosB64)) body.photosB64.forEach(push);
  if (Array.isArray(body.photoB64s)) body.photoB64s.forEach(push);
  push(body.photoB64);

  return candidates.slice(0, 4).map((item) => base64ToBuffer(item, MAX_PHOTO_BYTES, 'Fotoğraf'));
}

module.exports = {
  BRAND_DEFAULTS,
  MAX_PHOTO_BYTES,
  resolveBrand,
  base64ToBuffer,
  materializeProfileLogo,
  normalizeEngagementSettings,
  collectPhotoBuffers
};
