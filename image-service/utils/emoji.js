// Shared emoji handling utilities
// Extracted from server.js and server.backup.js to eliminate duplication.

const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u;
const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

const emojiCache = new Map();

export function isEmojiCluster(g) {
  return EMOJI_RE.test(g);
}

export async function fetchEmoji(emoji) {
  if (emojiCache.has(emoji)) return emojiCache.get(emoji);
  const codepoints = [...emoji]
    .map(c => c.codePointAt(0).toString(16))
    .filter(cp => cp !== 'fe0f')
    .join('-');
  try {
    const res = await fetch(
      `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${codepoints}.png`
    );
    if (!res.ok) { emojiCache.set(emoji, null); return null; }
    const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    emojiCache.set(emoji, `data:image/png;base64,${b64}`);
    return emojiCache.get(emoji);
  } catch (e) {
    console.error('❌ fetchEmoji failed for', emoji, e.message);
    emojiCache.set(emoji, null);
    return null;
  }
}

export function segmentLine(text) {
  const segments = [];
  let textChunk = '';
  for (const { segment } of graphemeSegmenter.segment(text)) {
    if (isEmojiCluster(segment)) {
      if (textChunk) { segments.push({ type: 'text', value: textChunk }); textChunk = ''; }
      segments.push({ type: 'emoji', value: segment });
    } else {
      textChunk += segment;
    }
  }
  if (textChunk) segments.push({ type: 'text', value: textChunk });
  return segments;
}

export function displayLen(s) {
  let len = 0;
  for (const { segment } of graphemeSegmenter.segment(s)) {
    len += isEmojiCluster(segment) ? 2 : segment.length;
  }
  return len;
}

export function wrapText(text, max) {
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (displayLen(cand) <= max) { cur = cand; continue; }
    if (cur) lines.push(cur);
    if (displayLen(w) > max) {
      let chunk = '';
      for (const { segment } of graphemeSegmenter.segment(w)) {
        if (displayLen(chunk + segment) > max) { lines.push(chunk); chunk = segment; }
        else chunk += segment;
      }
      if (chunk) cur = chunk;
    } else { cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

export function getEmojiCache() {
  return emojiCache;
}
