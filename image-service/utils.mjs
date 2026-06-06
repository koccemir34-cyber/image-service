// Pure utility functions extracted for testability

const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u;
const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

export function isEmojiCluster(g) {
  return EMOJI_RE.test(g);
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

export function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
