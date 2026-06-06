import { describe, it, expect } from 'vitest';
import { isEmojiCluster, segmentLine, displayLen, wrapText, escapeXml, randInt } from './utils.mjs';

// ── escapeXml ────────────────────────────────────────────────────────────────

describe('escapeXml', () => {
  it('escapes ampersand', () => {
    expect(escapeXml('A & B')).toBe('A &amp; B');
  });

  it('escapes angle brackets', () => {
    expect(escapeXml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeXml('"hello" & \'world\'')).toBe('&quot;hello&quot; &amp; &apos;world&apos;');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeXml('Hello World')).toBe('Hello World');
  });

  it('handles empty string', () => {
    expect(escapeXml('')).toBe('');
  });

  it('handles multiple special chars in sequence', () => {
    expect(escapeXml('<<&>>')).toBe('&lt;&lt;&amp;&gt;&gt;');
  });

  it('handles Turkish characters', () => {
    expect(escapeXml('Selhattin Koç İnşaat')).toBe('Selhattin Koç İnşaat');
  });
});

// ── isEmojiCluster ───────────────────────────────────────────────────────────

describe('isEmojiCluster', () => {
  it('detects basic emoji', () => {
    expect(isEmojiCluster('😀')).toBe(true);
  });

  it('detects heart emoji', () => {
    expect(isEmojiCluster('❤️')).toBe(true);
  });

  it('rejects regular text', () => {
    expect(isEmojiCluster('a')).toBe(false);
  });

  it('rejects digits', () => {
    expect(isEmojiCluster('5')).toBe(false);
  });

  it('rejects space', () => {
    expect(isEmojiCluster(' ')).toBe(false);
  });

  it('detects flag emoji', () => {
    expect(isEmojiCluster('🇹🇷')).toBe(true);
  });

  it('detects compound emoji', () => {
    expect(isEmojiCluster('👨‍👩‍👧')).toBe(true);
  });
});

// ── segmentLine ──────────────────────────────────────────────────────────────

describe('segmentLine', () => {
  it('segments plain text as single chunk', () => {
    expect(segmentLine('hello world')).toEqual([
      { type: 'text', value: 'hello world' }
    ]);
  });

  it('segments text with emoji', () => {
    const result = segmentLine('hello 😀 world');
    expect(result).toEqual([
      { type: 'text', value: 'hello ' },
      { type: 'emoji', value: '😀' },
      { type: 'text', value: ' world' }
    ]);
  });

  it('segments leading emoji', () => {
    const result = segmentLine('🔥start');
    expect(result).toEqual([
      { type: 'emoji', value: '🔥' },
      { type: 'text', value: 'start' }
    ]);
  });

  it('segments trailing emoji', () => {
    const result = segmentLine('end✅');
    expect(result).toEqual([
      { type: 'text', value: 'end' },
      { type: 'emoji', value: '✅' }
    ]);
  });

  it('segments consecutive emoji', () => {
    const result = segmentLine('😀🔥');
    expect(result).toEqual([
      { type: 'emoji', value: '😀' },
      { type: 'emoji', value: '🔥' }
    ]);
  });

  it('handles empty string', () => {
    expect(segmentLine('')).toEqual([]);
  });

  it('handles only text', () => {
    expect(segmentLine('abc')).toEqual([
      { type: 'text', value: 'abc' }
    ]);
  });
});

// ── displayLen ───────────────────────────────────────────────────────────────

describe('displayLen', () => {
  it('counts ASCII characters', () => {
    expect(displayLen('hello')).toBe(5);
  });

  it('counts emoji as 2', () => {
    expect(displayLen('😀')).toBe(2);
  });

  it('counts mixed text and emoji', () => {
    expect(displayLen('hi 😀')).toBe(5); // h=1, i=1, space=1, emoji=2
  });

  it('handles empty string', () => {
    expect(displayLen('')).toBe(0);
  });

  it('counts Turkish characters', () => {
    expect(displayLen('çğıöşü')).toBe(6);
  });

  it('counts multiple emoji', () => {
    expect(displayLen('😀🔥')).toBe(4); // 2 + 2
  });
});

// ── wrapText ─────────────────────────────────────────────────────────────────

describe('wrapText', () => {
  it('returns single line for short text', () => {
    expect(wrapText('hello', 10)).toEqual(['hello']);
  });

  it('wraps at word boundary', () => {
    const result = wrapText('hello world foo', 10);
    expect(result[0]).toBe('hello');
    expect(result[1]).toBe('world foo');
  });

  it('handles empty string', () => {
    expect(wrapText('', 10)).toEqual(['']);
  });

  it('handles null/undefined', () => {
    expect(wrapText(null, 10)).toEqual(['']);
    expect(wrapText(undefined, 10)).toEqual(['']);
  });

  it('wraps long word by grapheme', () => {
    const result = wrapText('abcdefghijklmnop', 5);
    expect(result.length).toBeGreaterThan(1);
    result.forEach(line => {
      expect(displayLen(line)).toBeLessThanOrEqual(5);
    });
  });

  it('handles single word exactly at max', () => {
    expect(wrapText('12345', 5)).toEqual(['12345']);
  });

  it('preserves words when possible', () => {
    const result = wrapText('ab cd ef', 5);
    expect(result).toEqual(['ab cd', 'ef']);
  });

  it('handles emoji in text wrapping', () => {
    const result = wrapText('hi 😀 there', 6);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ── randInt ──────────────────────────────────────────────────────────────────

describe('randInt', () => {
  it('returns value within range', () => {
    for (let i = 0; i < 100; i++) {
      const val = randInt(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
    }
  });

  it('returns integer', () => {
    const val = randInt(1, 100);
    expect(Number.isInteger(val)).toBe(true);
  });

  it('handles same min and max', () => {
    expect(randInt(7, 7)).toBe(7);
  });

  it('handles range 0-0', () => {
    expect(randInt(0, 0)).toBe(0);
  });
});
