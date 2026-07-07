'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

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
  }),
  ortak: Object.freeze({
    id: 'ortak',
    profileName: 'Selhattin Koç ↔ Remaz İnşaat',
    profileHandle: '@selhattinkocinsaat · @remazinsaat',
    footerTitle: 'SELHATTİN KOÇ İNŞAAT × REMAZ İNŞAAT',
    footerUrl: 'selhattinkoc.web.app • remazinsaat.web.app'
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
  const normalized = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (normalized === 'remazstory') return 'remazstory';
  if (normalized === 'ortak') return 'ortak';
  return 'skstory';
}

function resolveBrand(body = {}) {
  const nested = body && typeof body.brand === 'object' && body.brand ? body.brand : {};
  const id = normalizeBrandId(firstText(body.brandId, nested.id, body.brand));
  const defaults = BRAND_DEFAULTS[id];
  const remaz = id === 'remazstory';
  const ortak = id === 'ortak';

  const sharedParticipants = collectSharedParticipants(body, nested);

  return {
    id,
    profileName: ortak
      ? firstText(body.profileDisplayName, body.profileName, nested.profileDisplayName, nested.profileName, defaults.profileName)
      : remaz ? defaults.profileName : firstText(
          body.profileDisplayName,
          body.profileName,
          nested.profileDisplayName,
          nested.profileName,
          body.authorName,
          nested.authorName,
          defaults.profileName
        ),
    profileHandle: ortak
      ? firstText(body.profileUsername, body.accountHandle, body.username, nested.profileUsername, nested.accountHandle, nested.username, defaults.profileHandle)
      : remaz ? defaults.profileHandle : firstText(
          body.profileUsername,
          body.accountHandle,
          body.username,
          nested.profileUsername,
          nested.accountHandle,
          nested.username,
          defaults.profileHandle
        ),
    footerTitle: ortak
      ? firstText(body.footerBrandText, body.footerTitle, nested.footerBrandText, nested.footerTitle, defaults.footerTitle)
      : remaz ? defaults.footerTitle : firstText(
          body.footerBrandText,
          body.footerTitle,
          body.watermarkName,
          nested.footerBrandText,
          nested.footerTitle,
          nested.watermarkName,
          defaults.footerTitle
        ),
    footerUrl: ortak
      ? firstText(body.footerWebsiteText, body.footerSite, body.websiteUrl, nested.footerWebsiteText, nested.footerSite, nested.websiteUrl, defaults.footerUrl)
      : remaz ? defaults.footerUrl : firstText(
          body.footerWebsiteText,
          body.footerSite,
          body.websiteUrl,
          nested.footerWebsiteText,
          nested.footerSite,
          nested.websiteUrl,
          defaults.footerUrl
        ),
    profileImageB64: firstText(body.profileImageB64, nested.profileImageB64),
    profileImageMimeType: firstText(body.profileImageMimeType, nested.profileImageMimeType),
    profileImageFileName: firstText(body.profileImageFileName, nested.profileImageFileName),
    sharedParticipants
  };
}

function collectSharedParticipants(body = {}, nested = {}) {
  const source = Array.isArray(body.sharedParticipants)
    ? body.sharedParticipants
    : Array.isArray(nested.sharedParticipants)
      ? nested.sharedParticipants
      : [];

  const normalized = source
    .map((item) => ({
      profileDisplayName: firstText(item?.profileDisplayName, item?.profileName, item?.displayName, item?.authorName),
      profileUsername: firstText(item?.profileUsername, item?.accountHandle, item?.username),
      websiteUrl: firstText(item?.websiteUrl, item?.footerWebsiteText, item?.footerSite),
      profileImageB64: firstText(item?.profileImageB64),
      profileImageMimeType: firstText(item?.profileImageMimeType),
      profileImageFileName: firstText(item?.profileImageFileName)
    }))
    .filter((item) => item.profileDisplayName || item.profileUsername || item.profileImageB64);

  if (normalized.length >= 2) return normalized.slice(0, 2);

  const fallbacks = [
    {
      profileDisplayName: firstText(body.participantAName, nested.participantAName, BRAND_DEFAULTS.skstory.profileName),
      profileUsername: firstText(body.participantAUsername, nested.participantAUsername, BRAND_DEFAULTS.skstory.profileHandle),
      websiteUrl: firstText(body.participantAWebsiteUrl, nested.participantAWebsiteUrl, BRAND_DEFAULTS.skstory.footerUrl),
      profileImageB64: firstText(body.participantALogoB64, nested.participantALogoB64),
      profileImageMimeType: firstText(body.participantALogoMimeType, nested.participantALogoMimeType),
      profileImageFileName: firstText(body.participantALogoFileName, nested.participantALogoFileName)
    },
    {
      profileDisplayName: firstText(body.participantBName, nested.participantBName, BRAND_DEFAULTS.remazstory.profileName),
      profileUsername: firstText(body.participantBUsername, nested.participantBUsername, BRAND_DEFAULTS.remazstory.profileHandle),
      websiteUrl: firstText(body.participantBWebsiteUrl, nested.participantBWebsiteUrl, BRAND_DEFAULTS.remazstory.footerUrl),
      profileImageB64: firstText(body.participantBLogoB64, nested.participantBLogoB64),
      profileImageMimeType: firstText(body.participantBLogoMimeType, nested.participantBLogoMimeType),
      profileImageFileName: firstText(body.participantBLogoFileName, nested.participantBLogoFileName)
    }
  ].filter((item) => item.profileDisplayName || item.profileUsername || item.profileImageB64);

  return fallbacks;
}
function base64ToBuffer(value, maxBytes, label) {
  if (!value) return null;
  const normalized = String(value)
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s/g, '');

  if (!normalized) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`${label} base64 is invalid.`);
  }

  const buffer = Buffer.from(normalized, 'base64');
  if (!buffer.length || buffer.length > maxBytes) {
    throw new Error(`${label} exceeds the allowed size.`);
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

async function materializeCombinedLogo(serviceRoot, participants) {
  const safeParticipants = Array.isArray(participants) ? participants.slice(0, 2) : [];
  if (safeParticipants.length < 2) return null;

  const buffers = [];
  for (let index = 0; index < safeParticipants.length; index += 1) {
    const participant = safeParticipants[index];
    const direct = base64ToBuffer(participant.profileImageB64, MAX_PROFILE_BYTES, `Participant ${index + 1} logo`);
    if (direct) {
      buffers.push({ buffer: direct, fileName: participant.profileImageFileName, mimeType: participant.profileImageMimeType });
      continue;
    }
    const fallbackId = index === 0 ? 'skstory' : 'remazstory';
    const localPath = await findLocalLogo(serviceRoot, fallbackId);
    if (!localPath) return null;
    buffers.push({ buffer: await fs.readFile(localPath), fileName: path.basename(localPath), mimeType: '' });
  }

  const cacheDir = path.join('/tmp', 'sk-remaz-story-profiles');
  await fs.mkdir(cacheDir, { recursive: true });

  const hash = crypto.createHash('sha256')
    .update(buffers[0].buffer)
    .update(buffers[1].buffer)
    .digest('hex')
    .slice(0, 20);
  const output = path.join(cacheDir, `ortak-${hash}.png`);

  try {
    await fs.access(output);
    return output;
  } catch {}

  const size = 96;
  const canvasWidth = 248;
  const canvasHeight = 96;
  const iconSvg = Buffer.from(`
    <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" fill="#0f172a"/>
      <path d="M16 13h10v10" stroke="#ffffff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M24 13L14 23" stroke="#ffffff" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M24 27H14V17" stroke="#ffffff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M16 27l10-10" stroke="#ffffff" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg>
  `);

  const makeLogo = (buffer) => sharp(buffer)
    .resize({ width: size, height: size, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();

  const [leftLogo, rightLogo] = await Promise.all(buffers.map((item) => makeLogo(item.buffer)));

  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
    .composite([
      { input: leftLogo, left: 0, top: 0 },
      { input: rightLogo, left: 152, top: 0 },
      { input: iconSvg, left: 104, top: 28 }
    ])
    .png()
    .toFile(output);

  return output;
}

async function materializeProfileLogo(serviceRoot, brand) {
  if (brand.id === 'ortak') {
    const combined = await materializeCombinedLogo(serviceRoot, brand.sharedParticipants);
    if (combined) return combined;
  }

  const fromRequest = base64ToBuffer(brand.profileImageB64, MAX_PROFILE_BYTES, 'Profile image');
  if (!fromRequest) return findLocalLogo(serviceRoot, brand.id === 'ortak' ? 'skstory' : brand.id);

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

function collectPhotoBuffers(body = {}) {
  const candidates = [];

  const push = (item) => {
    if (typeof item !== 'string' || !item.trim()) return;
    if (!candidates.includes(item)) candidates.push(item);
  };

  if (Array.isArray(body.photosB64)) body.photosB64.forEach(push);
  if (Array.isArray(body.photoB64s)) body.photoB64s.forEach(push);
  push(body.photoB64);

  return candidates
    .slice(0, 4)
    .map((item) => base64ToBuffer(item, MAX_PHOTO_BYTES, 'Photo'));
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
