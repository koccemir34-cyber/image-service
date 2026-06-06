// Shared brand configuration
// Extracted from server.js (also mirrored in generate_story.py).

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceDir = join(__dirname, '..');

const LOGO_SK_B64     = readFileSync(join(serviceDir, 'logo_b64.txt'), 'utf8').trim();
const LOGO_REMAZ_B64  = readFileSync(join(serviceDir, 'logo_remaz_b64.txt'), 'utf8').trim();

let PROFILE_SK_B64    = '';
let PROFILE_REMAZ_B64 = '';
try { PROFILE_SK_B64    = readFileSync(join(serviceDir, 'profile-sk.jpg')).toString('base64'); }    catch (e) { console.warn('⚠️ profile-sk.jpg not found, falling back to logo:', e.message); }
try { PROFILE_REMAZ_B64 = readFileSync(join(serviceDir, 'profile-remaz.jpg')).toString('base64'); }  catch (e) { console.warn('⚠️ profile-remaz.jpg not found, falling back to logo:', e.message); }

export const BRANDS = {
  selhattin: {
    logoB64:     LOGO_SK_B64,
    profileB64:  PROFILE_SK_B64 || LOGO_SK_B64,
    logoMime:    'image/jpeg',
    name:        'Selhattin Koç',
    handle:      '@selhattinkocinsaat',
    watermark:   'SELHATTİN KOÇ İNŞAAT',
    website:     'selhattinkoc.web.app',
  },
  remaz: {
    logoB64:     LOGO_REMAZ_B64,
    profileB64:  PROFILE_REMAZ_B64 || LOGO_REMAZ_B64,
    logoMime:    'image/jpeg',
    name:        'Remaz İnşaat',
    handle:      '@remazinsaat',
    watermark:   'REMAZ İNŞAAT',
    website:     'remazinsaat.web.app',
  },
};
