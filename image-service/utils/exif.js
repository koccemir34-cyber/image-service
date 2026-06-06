// Shared EXIF utilities
// Extracted from server.js to keep the EXIF logic self-contained.

export const CAMERA_PROFILES = [
  { make: 'Apple',   model: 'iPhone 14 Pro',    software: '16.5.1',           fnum: [178, 100], focal: [686, 100], focal35: 24 },
  { make: 'Apple',   model: 'iPhone 15',        software: '17.4.1',           fnum: [160, 100], focal: [570, 100], focal35: 26 },
  { make: 'Apple',   model: 'iPhone 15 Pro Max',software: '17.5',             fnum: [178, 100], focal: [686, 100], focal35: 24 },
  { make: 'samsung', model: 'SM-S918B',         software: 'S918BXXS5EXD5',   fnum: [170, 100], focal: [630, 100], focal35: 23 },
  { make: 'Google',  model: 'Pixel 8 Pro',      software: 'UP1A.231005.007',  fnum: [168, 100], focal: [650, 100], focal35: 24 },
  { make: 'Sony',    model: 'XQ-EC72',          software: '13.4.0.0.3',       fnum: [190, 100], focal: [240, 100], focal35: 24 },
];

export function pickRandomCamera() {
  return CAMERA_PROFILES[Math.floor(Math.random() * CAMERA_PROFILES.length)];
}

export function generateExifData(cam) {
  const isoPool    = [50, 50, 64, 100, 100, 125, 200, 400, 800, 1600];
  const iso        = isoPool[Math.floor(Math.random() * isoPool.length)];
  const shutters   = [[1,4000],[1,2000],[1,1000],[1,500],[1,250],[1,125],[1,60],[1,30]];
  const [expN, expD] = shutters[Math.floor(Math.random() * shutters.length)];

  const daysBack = Math.floor(Math.random() * 30);
  const dt       = new Date(Date.now() - daysBack * 86400000 - Math.floor(Math.random() * 72000000));
  const pad      = n => String(n).padStart(2, '0');
  const dtStr    = `${dt.getFullYear()}:${pad(dt.getMonth()+1)}:${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;

  return {
    iso,
    expN,
    expD,
    dtStr,
    exifObj: {
      '0th': {
        271: cam.make, 272: cam.model, 274: 1,
        282: [72, 1], 283: [72, 1], 296: 2,
        305: cam.software, 306: dtStr, 531: 1,
      },
      'Exif': {
        33434: [expN, expD], 33437: cam.fnum, 34850: 2,
        34855: iso, 36867: dtStr, 36868: dtStr,
        37380: [0, 10], 37383: 5, 37385: 0,
        37386: cam.focal, 40961: 1, 41986: 0,
        41987: 0, 41988: [1, 1], 41989: cam.focal35, 41990: 0,
      },
      'GPS': {},
      '1st': {},
    },
  };
}
