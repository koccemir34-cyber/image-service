// Shared SVG utilities
// Extracted from server.js and server.backup.js to eliminate duplication.

export function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
