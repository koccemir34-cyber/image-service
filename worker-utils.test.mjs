import { describe, it, expect } from 'vitest';
import {
  STATES, TR_MONTHS, TR_DAYS,
  parseDate, parseTime,
  validateMessage, validateRecurringDay, validateStoryText,
  isSkipWord, bufToB64, cryptoRandomId,
  resolveRoute, helpMessage,
} from './worker-utils.mjs';

// ── STATES ───────────────────────────────────────────────────────────────────

describe('STATES', () => {
  it('contains all expected state keys', () => {
    expect(STATES.IDLE).toBe('idle');
    expect(STATES.ONCE_DATE).toBe('once_date');
    expect(STATES.ONCE_TIME).toBe('once_time');
    expect(STATES.ONCE_MESSAGE).toBe('once_message');
    expect(STATES.ONCE_HOURLY).toBe('once_hourly');
    expect(STATES.RECURRING_DAY).toBe('recurring_day');
    expect(STATES.RECURRING_TIME).toBe('recurring_time');
    expect(STATES.RECURRING_MESSAGE).toBe('recurring_message');
    expect(STATES.REMINDER_HOURLY).toBe('reminder_hourly');
    expect(STATES.STORY_TEXT).toBe('story_text');
    expect(STATES.STORY_PHOTO).toBe('story_photo');
    expect(STATES.EXIF_PHOTO).toBe('exif_photo');
  });
});

// ── TR_MONTHS / TR_DAYS ──────────────────────────────────────────────────────

describe('TR_MONTHS', () => {
  it('has 12 months', () => {
    expect(TR_MONTHS).toHaveLength(12);
  });

  it('starts with Ocak and ends with Aralık', () => {
    expect(TR_MONTHS[0]).toBe('Ocak');
    expect(TR_MONTHS[11]).toBe('Aralık');
  });
});

describe('TR_DAYS', () => {
  it('has 7 days', () => {
    expect(TR_DAYS).toHaveLength(7);
  });

  it('starts with Pazar (Sunday)', () => {
    expect(TR_DAYS[0]).toBe('Pazar');
  });
});

// ── parseDate ────────────────────────────────────────────────────────────────

describe('parseDate', () => {
  it('parses valid date', () => {
    const result = parseDate('21.04.2026');
    expect(result).toEqual({ ok: true, day: 21, month: 4, year: 2026 });
  });

  it('parses single-digit day and month', () => {
    const result = parseDate('1.1.2026');
    expect(result).toEqual({ ok: true, day: 1, month: 1, year: 2026 });
  });

  it('rejects wrong format (slash separator)', () => {
    expect(parseDate('21/04/2026')).toEqual({ ok: false, error: 'format' });
  });

  it('rejects empty string', () => {
    expect(parseDate('')).toEqual({ ok: false, error: 'format' });
  });

  it('rejects plain text', () => {
    expect(parseDate('hello')).toEqual({ ok: false, error: 'format' });
  });

  it('rejects invalid date (Feb 30)', () => {
    const result = parseDate('30.02.2026');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid');
  });

  it('rejects invalid month (13)', () => {
    const result = parseDate('01.13.2026');
    expect(result.ok).toBe(false);
  });

  it('parses leap year date', () => {
    const result = parseDate('29.02.2028');
    expect(result).toEqual({ ok: true, day: 29, month: 2, year: 2028 });
  });

  it('rejects non-leap year Feb 29', () => {
    const result = parseDate('29.02.2027');
    expect(result.ok).toBe(false);
  });

  it('rejects day 0', () => {
    const result = parseDate('0.01.2026');
    expect(result.ok).toBe(false);
  });

  it('rejects day 32', () => {
    const result = parseDate('32.01.2026');
    expect(result.ok).toBe(false);
  });
});

// ── parseTime ────────────────────────────────────────────────────────────────

describe('parseTime', () => {
  it('parses valid time', () => {
    expect(parseTime('14:30')).toEqual({ ok: true, hour: 14, minute: 30, string: '14:30' });
  });

  it('parses midnight', () => {
    expect(parseTime('0:00')).toEqual({ ok: true, hour: 0, minute: 0, string: '0:00' });
  });

  it('parses 23:59', () => {
    expect(parseTime('23:59')).toEqual({ ok: true, hour: 23, minute: 59, string: '23:59' });
  });

  it('pads single-digit minute', () => {
    expect(parseTime('9:05')).toEqual({ ok: true, hour: 9, minute: 5, string: '9:05' });
  });

  it('rejects hour 24', () => {
    const result = parseTime('24:00');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('range');
  });

  it('rejects minute 60', () => {
    const result = parseTime('10:60');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('range');
  });

  it('rejects wrong format (dot separator)', () => {
    expect(parseTime('14.30')).toEqual({ ok: false, error: 'format' });
  });

  it('rejects empty string', () => {
    expect(parseTime('')).toEqual({ ok: false, error: 'format' });
  });

  it('rejects text', () => {
    expect(parseTime('noon')).toEqual({ ok: false, error: 'format' });
  });

  it('rejects single number', () => {
    expect(parseTime('14')).toEqual({ ok: false, error: 'format' });
  });
});

// ── validateMessage ──────────────────────────────────────────────────────────

describe('validateMessage', () => {
  it('accepts valid message', () => {
    expect(validateMessage('Toplantı var')).toEqual({ ok: true });
  });

  it('accepts 3-char message', () => {
    expect(validateMessage('abc')).toEqual({ ok: true });
  });

  it('rejects too short', () => {
    expect(validateMessage('ab')).toEqual({ ok: false, error: 'too_short' });
  });

  it('rejects empty string', () => {
    expect(validateMessage('')).toEqual({ ok: false, error: 'too_short' });
  });

  it('rejects null', () => {
    expect(validateMessage(null)).toEqual({ ok: false, error: 'too_short' });
  });

  it('rejects undefined', () => {
    expect(validateMessage(undefined)).toEqual({ ok: false, error: 'too_short' });
  });
});

// ── validateRecurringDay ─────────────────────────────────────────────────────

describe('validateRecurringDay', () => {
  it('accepts day 1', () => {
    expect(validateRecurringDay('1')).toEqual({ ok: true, day: 1 });
  });

  it('accepts day 31', () => {
    expect(validateRecurringDay('31')).toEqual({ ok: true, day: 31 });
  });

  it('accepts day 15', () => {
    expect(validateRecurringDay('15')).toEqual({ ok: true, day: 15 });
  });

  it('rejects 0', () => {
    expect(validateRecurringDay('0')).toEqual({ ok: false, error: 'range' });
  });

  it('rejects 32', () => {
    expect(validateRecurringDay('32')).toEqual({ ok: false, error: 'range' });
  });

  it('rejects negative', () => {
    expect(validateRecurringDay('-1')).toEqual({ ok: false, error: 'range' });
  });

  it('rejects non-numeric', () => {
    expect(validateRecurringDay('abc')).toEqual({ ok: false, error: 'range' });
  });

  it('rejects empty string', () => {
    expect(validateRecurringDay('')).toEqual({ ok: false, error: 'range' });
  });
});

// ── validateStoryText ────────────────────────────────────────────────────────

describe('validateStoryText', () => {
  it('accepts valid text', () => {
    expect(validateStoryText('Bugün harika bir iş çıkardık!')).toEqual({ ok: true });
  });

  it('accepts 2-char text', () => {
    expect(validateStoryText('ab')).toEqual({ ok: true });
  });

  it('rejects 1-char text', () => {
    expect(validateStoryText('a')).toEqual({ ok: false, error: 'too_short' });
  });

  it('rejects empty string', () => {
    expect(validateStoryText('')).toEqual({ ok: false, error: 'too_short' });
  });

  it('rejects null', () => {
    expect(validateStoryText(null)).toEqual({ ok: false, error: 'too_short' });
  });

  it('accepts 500-char text', () => {
    expect(validateStoryText('a'.repeat(500))).toEqual({ ok: true });
  });

  it('rejects 501-char text', () => {
    const result = validateStoryText('a'.repeat(501));
    expect(result).toEqual({ ok: false, error: 'too_long', length: 501 });
  });
});

// ── isSkipWord ───────────────────────────────────────────────────────────────

describe('isSkipWord', () => {
  it('recognizes "hayır"', () => {
    expect(isSkipWord('hayır')).toBe(true);
  });

  it('recognizes "hayir" (ASCII)', () => {
    expect(isSkipWord('hayir')).toBe(true);
  });

  it('recognizes "h"', () => {
    expect(isSkipWord('h')).toBe(true);
  });

  it('recognizes "geç"', () => {
    expect(isSkipWord('geç')).toBe(true);
  });

  it('recognizes "gec" (ASCII)', () => {
    expect(isSkipWord('gec')).toBe(true);
  });

  it('recognizes "atla"', () => {
    expect(isSkipWord('atla')).toBe(true);
  });

  it('recognizes "yok"', () => {
    expect(isSkipWord('yok')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isSkipWord('HAYIR')).toBe(true);
    expect(isSkipWord('Hayır')).toBe(true);
  });

  it('trims whitespace', () => {
    expect(isSkipWord('  hayır  ')).toBe(true);
  });

  it('rejects "evet"', () => {
    expect(isSkipWord('evet')).toBe(false);
  });

  it('rejects random text', () => {
    expect(isSkipWord('hello')).toBe(false);
  });
});

// ── bufToB64 ─────────────────────────────────────────────────────────────────

describe('bufToB64', () => {
  it('encodes small buffer', () => {
    const buf = new Uint8Array([72, 101, 108, 108, 111]).buffer; // "Hello"
    expect(bufToB64(buf)).toBe(btoa('Hello'));
  });

  it('encodes empty buffer', () => {
    expect(bufToB64(new ArrayBuffer(0))).toBe('');
  });

  it('roundtrips with atob', () => {
    const text = 'Test data 123';
    const buf = new TextEncoder().encode(text).buffer;
    const b64 = bufToB64(buf);
    expect(atob(b64)).toBe(text);
  });

  it('handles binary data', () => {
    const bytes = new Uint8Array([0, 1, 255, 128, 64]);
    const b64 = bufToB64(bytes.buffer);
    expect(typeof b64).toBe('string');
    expect(b64.length).toBeGreaterThan(0);
  });

  it('handles large buffer (>8192 chunk)', () => {
    const large = new Uint8Array(10000);
    for (let i = 0; i < large.length; i++) large[i] = i % 256;
    const b64 = bufToB64(large.buffer);
    expect(typeof b64).toBe('string');
    expect(b64.length).toBeGreaterThan(0);
  });
});

// ── cryptoRandomId ───────────────────────────────────────────────────────────

describe('cryptoRandomId', () => {
  it('generates correct length', () => {
    expect(cryptoRandomId(8)).toHaveLength(8);
    expect(cryptoRandomId(16)).toHaveLength(16);
    expect(cryptoRandomId(1)).toHaveLength(1);
  });

  it('only uses lowercase alphanumeric chars', () => {
    for (let i = 0; i < 50; i++) {
      const id = cryptoRandomId(20);
      expect(id).toMatch(/^[a-z0-9]+$/);
    }
  });

  it('generates unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(cryptoRandomId(8));
    expect(ids.size).toBeGreaterThan(90);
  });

  it('handles length 0', () => {
    expect(cryptoRandomId(0)).toBe('');
  });
});

// ── resolveRoute ─────────────────────────────────────────────────────────────

describe('resolveRoute', () => {
  it('resolves / to home', () => {
    expect(resolveRoute('/')).toBe('home');
  });

  it('resolves /bot to bot', () => {
    expect(resolveRoute('/bot')).toBe('bot');
  });

  it('resolves /cron to cron', () => {
    expect(resolveRoute('/cron')).toBe('cron');
  });

  it('resolves unknown paths to not_found', () => {
    expect(resolveRoute('/unknown')).toBe('not_found');
    expect(resolveRoute('/api')).toBe('not_found');
    expect(resolveRoute('/webhook')).toBe('not_found');
  });
});

// ── helpMessage ──────────────────────────────────────────────────────────────

describe('helpMessage', () => {
  it('returns non-empty string', () => {
    const msg = helpMessage();
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('contains all command references', () => {
    const msg = helpMessage();
    expect(msg).toContain('/tekhatirlat');
    expect(msg).toContain('/herhatirlat');
    expect(msg).toContain('/liste');
    expect(msg).toContain('/sil');
    expect(msg).toContain('/basarili');
    expect(msg).toContain('/brifing');
    expect(msg).toContain('/brifingkapat');
    expect(msg).toContain('/story');
    expect(msg).toContain('/exifdegis');
  });

  it('is trimmed (no leading/trailing whitespace)', () => {
    const msg = helpMessage();
    expect(msg).toBe(msg.trim());
  });
});
