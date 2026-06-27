const sharp = require('sharp');
const fs = require('fs/promises');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const WIDTH = 1080;
const HEIGHT = 1920;

const TEXT_FONT = 'Arial, Helvetica, sans-serif';

const CONFIG = {
  profileName: process.env.PROFILE_NAME || 'Selhattin Koç',
  profileHandle: process.env.PROFILE_HANDLE || '@selhattinkocinsaat',
  footerTitle: process.env.FOOTER_TITLE || 'SELHATTİN KOÇ İNŞAAT',
  footerUrl: process.env.FOOTER_URL || 'selhattinkoc.web.app',
  logoPath: process.env.LOGO_PATH || './assets/logo.png',

  // Bunlar boşsa her görselde otomatik değişir.
  // .env içinde DEFAULT_COMMENTS=69 gibi değer varsa sabit kalır.
  comments: process.env.DEFAULT_COMMENTS || '',
  reposts: process.env.DEFAULT_REPOSTS || '',
  likes: process.env.DEFAULT_LIKES || '',

  dateText: process.env.DATE_TEXT || ''
};

const emojiCache = new Map();
const bodyTextMeasureCache = new Map();

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function splitGraphemes(text) {
  const value = String(text || '');

  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return Array.from(
      new Intl.Segmenter('tr', { granularity: 'grapheme' }).segment(value),
      (part) => part.segment
    );
  }

  return Array.from(value);
}

function isEmojiLike(ch) {
  // Normal emojiler ve 🇹🇷 gibi bayraklar için.
  return /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F]/u.test(ch);
}

function fixEmojiSpacing(value) {
  let text = String(value || '');

  // Başta kullanılan emoji ile yazı arasında düzgün boşluk.
  text = text.replace(/(🏗️|🏗)\s*/gu, '$1 ');
  text = text.replace(/(🤲)\s*/gu, '$1 ');
  text = text.replace(/(📍)\s*/gu, '$1 ');
  text = text.replace(/\s*(📚)/gu, ' $1');

  // Emoji ile yazı birbirine yapışmasın.
  text = text.replace(
    /([\p{Extended_Pictographic}])(?=[A-Za-zÇĞİÖŞÜçğıöşü])/gu,
    '$1 '
  );

  text = text.replace(
    /([A-Za-zÇĞİÖŞÜçğıöşü])([\p{Extended_Pictographic}])/gu,
    '$1 $2'
  );

  // Noktalama işaretlerinden sonra boşluk düzeltmesi.
  text = text.replace(/;(?=\S)/g, '; ');
  text = text.replace(/,(?=\S)/g, ', ');
  text = text.replace(/\.(?=\S)/g, '. ');

  // Birden fazla boşluğu teke indir.
  text = text.replace(/[ \t]+/g, ' ');

  return text;
}

function normalizeStoryText(text) {
  return fixEmojiSpacing(text)
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function applyParagraphRules(text) {
  let out = String(text || '');

  // Şantiye metinleri için otomatik paragraf kuralı.
  out = out.replace(
    /(aralıksız devam ediyor\.)\s*(?=Çevre|$)/giu,
    '$1\n\n'
  );

  out = out.replace(
    /(önemli bir aşamayı daha geride bıraktık\.)\s*(?=Geleceğimiz|$)/giu,
    '$1\n\n'
  );

  out = out.replace(
    /(geride bıraktık\.)\s*(?=Geleceğimiz|$)/giu,
    '$1\n\n'
  );

  out = out.replace(
    /(inşa etmeyi sürdürüyoruz\.\s*(?:📚)?)/giu,
    '$1\n\n'
  );

  out = out.replace(
    /(sürdürüyoruz\.\s*(?:📚)?)/giu,
    '$1\n\n'
  );

  // Konum satırını ayrı paragraf yap.
  out = out.replace(
    /\s*(📍\s*Pütürge\s*\/\s*Malatya)\s*/giu,
    '\n\n$1\n\n'
  );

  out = out.replace(
    /\s+(📍\s*[^\n]+)/gu,
    '\n\n$1\n\n'
  );

  return out;
}

function formatStoryText(rawText) {
  /*
    Kullanıcının Telegram mesajındaki paragraf boşluklarını korur.
    Tek satır sonları ise Telegram ekran genişliğine göre oluşmuş olabileceği için
    aynı paragraf içinde boşluğa çevrilir. Böylece "inceleyerek" veya
    "yaşam alanlarına" gibi tek başına kalan, göze kötü görünen satırlar oluşmaz.
  */
  let text = fixEmojiSpacing(String(rawText || ''))
    .replace(/\r/g, '')
    .trim();

  const hashtags = [];

  const hashtagWithEmoji =
    /#[0-9A-Za-zÇĞİÖŞÜçğıöşü_]+(?:[ \t]*(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F|\u200D)+)?/gu;

  text = text.replace(hashtagWithEmoji, (match) => {
    hashtags.push(match.trim());
    return ' ';
  });

  // En az bir boş satır, yeni paragraf demektir. Sadece bunu koru.
  const paragraphs = text
    .split(/\n[ \t]*\n+/g)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim()
    )
    .filter(Boolean);

  const uniqueHashtags = [];
  for (const tag of hashtags) {
    if (!uniqueHashtags.includes(tag)) {
      uniqueHashtags.push(tag);
    }
  }

  if (uniqueHashtags.length) {
    paragraphs.push(uniqueHashtags.join('\n'));
  }

  return paragraphs.join('\n\n');
}

function getForcedJandarmaLines(text) {
  const t = normalizeStoryText(text);

  const isJandarmaText =
    t.includes('Köklü geçmişinden aldığı güçle 187') &&
    t.includes('Jandarma Teşkilatımızın kuruluş yıl dönümünü') &&
    t.includes('görevlerinde üstün başarılar diliyorum');

  if (!isJandarmaText) {
    return null;
  }

  return [
    'Köklü geçmişinden aldığı güçle 187',
    'yıldır milletimizin huzur ve',
    'güvenliğinin teminatı olan Jandarma',
    'Teşkilatımızın kuruluş yıl dönümünü',
    'gururla kutluyorum. Vatanımızın dört',
    'bir yanında fedakârca görev yapan',
    'kahraman jandarmalarımız, milletimizin',
    'huzurunun ve güveninin simgesidir.',
    'Şehadete ulaşan kahramanlarımızı',
    'rahmetle, gazilerimizi minnetle',
    'anıyor; güvenliğimizin sigortası olan',
    'Jandarma Teşkilatımızın 187. kuruluş',
    'yıl dönümünü tebrik ediyor,',
    'görevlerinde üstün başarılar',
    'diliyorum.'
  ];
}

function charWeight(ch) {
  if (isEmojiLike(ch)) return 1.24;
  if (/\s/.test(ch)) return 0.34;
  if (/[ilIıİj.,:;!|'`]/.test(ch)) return 0.33;
  if (/[ftr()\[\]{}]/.test(ch)) return 0.46;
  if (/[mwMWĞŞÖÜÇ]/.test(ch)) return 0.84;

  return 0.565;
}

function estimateWidth(text, fontSize) {
  let total = 0;

  for (const ch of splitGraphemes(text)) {
    total += charWeight(ch) * fontSize;
  }

  return total;
}

async function measureRenderedTextWidth(text, fontSize) {
  const raw = String(text || '');

  if (!raw) {
    return 0;
  }

  const key = `${fontSize}|${raw}`;

  if (bodyTextMeasureCache.has(key)) {
    return bodyTextMeasureCache.get(key);
  }

  try {
    /*
      Sharp/Pango ile gerçek yazı genişliği ölçülüyor.
      Böylece önceki sürümdeki gibi kelimeler arası gereksiz
      ve bozuk boşluk oluşmuyor.
    */
    const font = `Arial Bold ${fontSize}`;
    const visible = raw.trim();

    const getWidth = async (value) => {
      if (!value) {
        return 0;
      }

      const meta = await sharp({
        text: {
          text: value,
          font,
          rgba: true
        }
      }).metadata();

      return meta.width || 0;
    };

    const visibleWidth = await getWidth(visible);

    const leadingSpaces =
      raw.match(/^\s+/u)?.[0].length || 0;

    const trailingSpaces =
      raw.match(/\s+$/u)?.[0].length || 0;

    const spaceWidth = Math.max(
      1,
      (await getWidth('n n')) - (await getWidth('nn'))
    );

    const width =
      visibleWidth +
      ((leadingSpaces + trailingSpaces) * spaceWidth);

    bodyTextMeasureCache.set(key, width);

    return width;
  } catch {
    // Ölçüm desteklenmezse bot yine çalışsın.
    const fallback = estimateWidth(raw, fontSize);

    bodyTextMeasureCache.set(key, fallback);

    return fallback;
  }
}

function splitLongWord(word, maxWidth, fontSize) {
  const parts = [];
  let current = '';

  for (const ch of splitGraphemes(word)) {
    if (estimateWidth(current + ch, fontSize) <= maxWidth) {
      current += ch;
    } else {
      if (current) {
        parts.push(current);
      }

      current = ch;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function wrapSingleParagraph(paragraph, maxWidth, fontSize) {
  const words = normalizeStoryText(paragraph).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const rawWord of words) {
    const parts =
      estimateWidth(rawWord, fontSize) > maxWidth
        ? splitLongWord(rawWord, maxWidth, fontSize)
        : [rawWord];

    for (const part of parts) {
      const candidate = line ? `${line} ${part}` : part;

      if (estimateWidth(candidate, fontSize) <= maxWidth) {
        line = candidate;
      } else {
        if (line) {
          lines.push(line);
        }
        line = part;
      }
    }
  }

  if (line) {
    lines.push(line);
  }

  /*
    Son satır tek kelime veya aşırı kısa kaldığında, önceki satırdan kelime
    aktararak görünümü dengeler. Böylece "inceleyerek" / "aldım." gibi
    satırların tek başına kalma ihtimali önemli ölçüde azalır.
  */
  while (lines.length >= 2) {
    const lastIndex = lines.length - 1;
    const lastLine = lines[lastIndex];
    const previousLine = lines[lastIndex - 1];
    const lastWords = lastLine.split(/\s+/).filter(Boolean);
    const previousWords = previousLine.split(/\s+/).filter(Boolean);
    const lastWidth = estimateWidth(lastLine, fontSize);

    const isTooShort =
      lastWords.length <= 1 ||
      lastWidth < maxWidth * 0.37;

    if (!isTooShort || previousWords.length <= 2) {
      break;
    }

    const movedWord = previousWords[previousWords.length - 1];
    const nextPrevious = previousWords.slice(0, -1).join(' ');
    const nextLast = `${movedWord} ${lastLine}`.trim();

    if (
      estimateWidth(nextLast, fontSize) > maxWidth ||
      estimateWidth(nextPrevious, fontSize) < maxWidth * 0.34
    ) {
      break;
    }

    lines[lastIndex - 1] = nextPrevious;
    lines[lastIndex] = nextLast;
  }

  return lines;
}

function wrapText(text, maxWidth, fontSize) {
  const formattedText = formatStoryText(text);
  const forcedLines = getForcedJandarmaLines(formattedText);

  if (forcedLines) {
    return forcedLines;
  }

  const paragraphs = String(formattedText || '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/g);

  const lines = [];

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index].trim();

    if (!paragraph) {
      continue;
    }

    // Hashtagler formatStoryText içinde ayrı satırlara koyulur; onları aynen koru.
    if (paragraph.split('\n').every((line) => line.trim().startsWith('#'))) {
      if (lines.length && lines[lines.length - 1] !== '') {
        lines.push('');
      }
      lines.push(...paragraph.split('\n').map((line) => line.trim()).filter(Boolean));
    } else {
      lines.push(...wrapSingleParagraph(paragraph, maxWidth, fontSize));
    }

    if (index < paragraphs.length - 1) {
      lines.push('');
    }
  }

  while (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.length ? lines : [''];
}

function trimLines(lines, maxLines) {
  if (lines.length <= maxLines) {
    return lines;
  }

  const out = lines.slice(0, maxLines);

  out[out.length - 1] =
    out[out.length - 1].replace(/[.,;:!?\s]*$/, '') + '...';

  return out;
}

function getDateParts() {
  if (CONFIG.dateText) {
    return CONFIG.dateText;
  }

  const now = new Date();

  const time = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);

  const date = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
    .format(now)
    .replace(/\./g, '');

  return `${time} · ${date}`;
}

function emojiToTwemojiCode(emoji) {
  const codes = [];

  for (const char of Array.from(emoji)) {
    const cp = char.codePointAt(0).toString(16).toLowerCase();

    // Twemoji URL içinde FE0F kullanılmaz.
    if (cp === 'fe0f') {
      continue;
    }

    codes.push(cp);
  }

  return codes.join('-');
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          downloadBuffer(res.headers.location)
            .then(resolve)
            .catch(reject);

          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const chunks = [];

        res.on('data', (chunk) => chunks.push(chunk));

        res.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
      })
      .on('error', reject);
  });
}

function findTwemojiBaseDir() {
  try {
    const pkgPath = require.resolve('twemoji/package.json', {
      paths: [process.cwd(), __dirname]
    });

    return path.dirname(pkgPath);
  } catch {
    return null;
  }
}

async function getEmojiImageBuffer(emoji, size) {
  const code = emojiToTwemojiCode(emoji);
  const key = `${code}_${size}`;

  if (emojiCache.has(key)) {
    return emojiCache.get(key);
  }

  try {
    let fileBuffer = null;
    const twemojiBase = findTwemojiBaseDir();

    if (twemojiBase) {
      const localPng = path.join(
        twemojiBase,
        'assets',
        '72x72',
        `${code}.png`
      );

      const localSvg = path.join(
        twemojiBase,
        'assets',
        'svg',
        `${code}.svg`
      );

      try {
        fileBuffer = await fs.readFile(localPng);
      } catch {
        try {
          fileBuffer = await fs.readFile(localSvg);
        } catch {}
      }
    }

    // Twemoji paketinde yoksa internetten almayı dener.
    if (!fileBuffer) {
      const remotePng =
        `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${code}.png`;

      fileBuffer = await downloadBuffer(remotePng);
    }

    const out = await sharp(fileBuffer)
      .resize(size, size, {
        fit: 'contain'
      })
      .png()
      .toBuffer();

    emojiCache.set(key, out);

    return out;
  } catch {
    // Emoji indirilemese de bot çökmesin.
    const fallbackSvg = `
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <text
          x="0"
          y="${Math.round(size * 0.82)}"
          font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif"
          font-size="${Math.round(size * 0.88)}"
        >${esc(emoji)}</text>
      </svg>
    `;

    const out = await sharp(Buffer.from(fallbackSvg))
      .png()
      .toBuffer();

    emojiCache.set(key, out);

    return out;
  }
}

async function renderLineText(line, x, baseline, fontSize, emojiTasks) {
  const parts = splitGraphemes(line);

  let cursorX = x;
  let out = '';
  let buffer = '';

  async function flushBuffer() {
    if (!buffer) {
      return;
    }

    /*
      Normal yazılar tek parça SVG text olarak çiziliyor.
      Eski sistemde kelimeler tek tek basıldığı için metin
      aralarındaki boşluklar aşırı açılıyordu.
    */
    out += `
      <text
        x="${cursorX}"
        y="${baseline}"
        font-family="${TEXT_FONT}"
        font-size="${fontSize}"
        font-weight="800"
        fill="#111820"
      >${esc(buffer)}</text>
    `;

    cursorX += await measureRenderedTextWidth(buffer, fontSize);

    buffer = '';
  }

  for (const part of parts) {
    if (isEmojiLike(part)) {
      await flushBuffer();

      const emojiSize = Math.round(fontSize * 0.98);
      const emojiTop = Math.round(baseline - emojiSize + 6);

      emojiTasks.push({
        emoji: part,
        left: Math.round(cursorX),
        top: emojiTop,
        size: emojiSize
      });

      cursorX += Math.round(fontSize * 1.18);

      continue;
    }

    // Boşluklar metnin içinde kalır, kelime araları doğal görünür.
    buffer += part;
  }

  await flushBuffer();

  return out;
}

async function renderText(lines, x, y, fontSize, lineHeight) {
  const emojiTasks = [];
  const svgParts = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (!line) {
      continue;
    }

    const baseline = y + (i * lineHeight);

    svgParts.push(
      await renderLineText(
        line,
        x,
        baseline,
        fontSize,
        emojiTasks
      )
    );
  }

  return {
    svg: svgParts.join(''),
    emojiTasks
  };
}

function randomInt(min, max) {
  const safeMin = Math.ceil(Math.min(min, max));
  const safeMax = Math.floor(Math.max(min, max));

  return crypto.randomInt(safeMin, safeMax + 1);
}

function randomRatio(min, max) {
  return min + ((crypto.randomInt(0, 10001) / 10000) * (max - min));
}

function formatCount(value) {
  const number = Number(value) || 0;

  if (number >= 1000) {
    const n = number / 1000;

    return `${n
      .toFixed(n >= 10 ? 0 : 1)
      .replace('.0', '')} B`;
  }

  return String(number);
}

function validManualCount(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }

  return Math.round(number);
}

function getRandomLikes() {
  // Her görselin 10 bin beğeni alması yerine daha doğal bir dağılım kullanılır.
  const roll = randomInt(1, 100);

  if (roll <= 25) return randomInt(80, 599);
  if (roll <= 58) return randomInt(600, 1999);
  if (roll <= 83) return randomInt(2000, 4999);
  if (roll <= 96) return randomInt(5000, 7999);

  return randomInt(8000, 10000);
}

function getRandomEngagementStats() {
  const likes = getRandomLikes();

  // Yorum/yanıt ve repost sayıları beğeni oranına göre üretilir.
  // İkisi de en fazla 300 olur; böylece rastgele görünür ama oranlar tutarlı kalır.
  const commentMin = clamp(
    Math.round(likes * randomRatio(0.003, 0.009)),
    1,
    300
  );
  const commentMax = clamp(
    Math.round(likes * randomRatio(0.014, 0.03)),
    Math.max(commentMin, 2),
    300
  );

  const repostMin = clamp(
    Math.round(likes * randomRatio(0.002, 0.007)),
    1,
    300
  );
  const repostMax = clamp(
    Math.round(likes * randomRatio(0.01, 0.03)),
    Math.max(repostMin, 2),
    300
  );

  const comments = randomInt(commentMin, commentMax);
  const reposts = randomInt(repostMin, repostMax);

  return {
    comments: formatCount(comments),
    reposts: formatCount(reposts),
    likes: formatCount(likes)
  };
}

function getEngagementStats(engagementSettings = null) {
  // /ayarlar ile girilen kişisel sabit değerler önceliklidir.
  if (engagementSettings?.mode === 'manual') {
    return {
      comments: formatCount(validManualCount(engagementSettings.comments)),
      reposts: formatCount(validManualCount(engagementSettings.reposts)),
      likes: formatCount(validManualCount(engagementSettings.likes))
    };
  }

  // /ayarlarsifirla bu sohbet için .env içindeki sabitleri de devre dışı bırakır.
  if (engagementSettings?.mode === 'random') {
    return getRandomEngagementStats();
  }

  // Eski .env sistemi geriye dönük olarak korunur.
  if (CONFIG.comments && CONFIG.reposts && CONFIG.likes) {
    return {
      comments: CONFIG.comments,
      reposts: CONFIG.reposts,
      likes: CONFIG.likes
    };
  }

  return getRandomEngagementStats();
}

function xIcon(name, x, y, size = 27) {
  const scale = size / 24;
  let inner = '';

  if (name === 'reply') {
    inner = `
      <path d="M21 11.5C21 15.65 17.65 19 13.5 19H8.7L4.4 21.9C3.95 22.2 3.35 21.88 3.35 21.34V11.5C3.35 7.35 6.7 4 10.85 4H13.5C17.65 4 21 7.35 21 11.5Z"/>
    `;
  }

  if (name === 'repost') {
    inner = `
      <path d="M17 3L21 7L17 11"/>
      <path d="M21 7H8C5.8 7 4 8.8 4 11V12"/>
      <path d="M7 21L3 17L7 13"/>
      <path d="M3 17H16C18.2 17 20 15.2 20 13V12"/>
    `;
  }

  if (name === 'heart') {
    inner = `
      <path d="M20.8 4.9C18.9 3 15.8 3.1 14 5.1L12 7.2L10 5.1C8.2 3.1 5.1 3 3.2 4.9C1.2 6.9 1.3 10.2 3.4 12.1L12 20.2L20.6 12.1C22.7 10.2 22.8 6.9 20.8 4.9Z"/>
    `;
  }

  if (name === 'share') {
    inner = `
      <path d="M12 3V15"/>
      <path d="M7.5 7.5L12 3L16.5 7.5"/>
      <path d="M5 14V19C5 20.1 5.9 21 7 21H17C18.1 21 19 20.1 19 19V14"/>
    `;
  }

  return `
    <g
      transform="translate(${x} ${y}) scale(${scale})"
      fill="none"
      stroke="#536471"
      stroke-width="1.85"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      ${inner}
    </g>
  `;
}

function iconsSvg(y, stats) {
  const color = '#536471';

  const iconSize = 27;
  const iconY = y - 1;
  const textY = y + 16;

  const replyX = 128;
  const repostX = 304;
  const heartX = 480;
  const shareX = 724;

  return `
    ${xIcon('reply', replyX, iconY, iconSize)}
    <text
      x="${replyX + 38}"
      y="${textY}"
      dominant-baseline="middle"
      font-family="${TEXT_FONT}"
      font-size="23"
      font-weight="400"
      fill="${color}"
    >${esc(stats.comments)}</text>

    ${xIcon('repost', repostX, iconY, iconSize)}
    <text
      x="${repostX + 38}"
      y="${textY}"
      dominant-baseline="middle"
      font-family="${TEXT_FONT}"
      font-size="23"
      font-weight="400"
      fill="${color}"
    >${esc(stats.reposts)}</text>

    ${xIcon('heart', heartX, iconY, iconSize)}
    <text
      x="${heartX + 38}"
      y="${textY}"
      dominant-baseline="middle"
      font-family="${TEXT_FONT}"
      font-size="23"
      font-weight="400"
      fill="${color}"
    >${esc(stats.likes)}</text>

    ${xIcon('share', shareX, iconY, iconSize)}
  `;
}

async function roundImage(buffer, size) {
  const mask = Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle
        cx="${size / 2}"
        cy="${size / 2}"
        r="${size / 2}"
        fill="#fff"
      />
    </svg>
  `);

  return sharp(buffer)
    .rotate()
    .resize(size, size, {
      fit: 'cover'
    })
    .png()
    .composite([
      {
        input: mask,
        blend: 'dest-in'
      }
    ])
    .toBuffer();
}

async function loadAvatar(size) {
  const logoPath = path.resolve(process.cwd(), CONFIG.logoPath);

  try {
    const raw = await fs.readFile(logoPath);

    return await roundImage(raw, size);
  } catch {
    const fallback = Buffer.from(`
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="bg" cx="50%" cy="38%" r="72%">
            <stop offset="0%" stop-color="#111b38"/>
            <stop offset="55%" stop-color="#070d1a"/>
            <stop offset="100%" stop-color="#01030a"/>
          </radialGradient>

          <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fff1b8"/>
            <stop offset="38%" stop-color="#d7af57"/>
            <stop offset="100%" stop-color="#8b6321"/>
          </linearGradient>
        </defs>

        <circle
          cx="${size / 2}"
          cy="${size / 2}"
          r="${size / 2}"
          fill="url(#bg)"
        />

        <circle
          cx="${size / 2}"
          cy="${size / 2}"
          r="${size / 2 - 3}"
          fill="none"
          stroke="url(#gold)"
          stroke-width="3"
        />

        <circle
          cx="${size / 2}"
          cy="${size / 2}"
          r="${size / 2 - 9}"
          fill="none"
          stroke="#192240"
          stroke-width="1.4"
        />

        <path
          d="M${size * 0.37} ${size * 0.56} L${size * 0.37} ${size * 0.36} L${size * 0.405} ${size * 0.36} L${size * 0.405} ${size * 0.56} Z"
          fill="url(#gold)"
        />

        <path
          d="M${size * 0.47} ${size * 0.56} L${size * 0.47} ${size * 0.27} L${size * 0.505} ${size * 0.27} L${size * 0.505} ${size * 0.56} Z"
          fill="url(#gold)"
        />

        <path
          d="M${size * 0.57} ${size * 0.56} L${size * 0.57} ${size * 0.41} L${size * 0.605} ${size * 0.41} L${size * 0.605} ${size * 0.56} Z"
          fill="url(#gold)"
        />

        <text
          x="50%"
          y="42%"
          text-anchor="middle"
          dominant-baseline="middle"
          font-family="${TEXT_FONT}"
          font-size="${size * 0.22}"
          font-weight="900"
          fill="url(#gold)"
        >SK</text>

        <text
          x="50%"
          y="66%"
          text-anchor="middle"
          dominant-baseline="middle"
          font-family="${TEXT_FONT}"
          font-size="${size * 0.08}"
          font-weight="700"
          fill="#f8e7b0"
        >SELHATTİN KOÇ</text>

        <text
          x="50%"
          y="77%"
          text-anchor="middle"
          dominant-baseline="middle"
          font-family="${TEXT_FONT}"
          font-size="${size * 0.09}"
          font-weight="800"
          fill="#f8e7b0"
        >İNŞAAT</text>
      </svg>
    `);

    return fallback;
  }
}

async function getPhotoSlot(photoBuffer) {
  const photoW = 824;

  if (!photoBuffer) {
    return {
      photoW,
      photoH: 420
    };
  }

  try {
    const meta = await sharp(photoBuffer).metadata();

    const imgW = meta.width || photoW;
    const imgH = meta.height || 420;
    const ratio = imgW / imgH;

    const naturalH = Math.round(photoW / ratio);

    const photoH = clamp(naturalH, 320, 500);

    return {
      photoW,
      photoH
    };
  } catch {
    return {
      photoW,
      photoH: 420
    };
  }
}

async function makeRoundedPhoto(photoBuffer, w, h, radius) {
  const blurredBackground = await sharp(photoBuffer)
    .rotate()
    .resize(w, h, {
      fit: 'cover',
      position: 'centre'
    })
    .blur(18)
    .modulate({
      brightness: 0.88,
      saturation: 0.85
    })
    .png()
    .toBuffer();

  const containedPhoto = await sharp(photoBuffer)
    .rotate()
    .resize(w, h, {
      fit: 'contain',
      position: 'centre',
      background: {
        r: 255,
        g: 255,
        b: 255,
        alpha: 0
      }
    })
    .png()
    .toBuffer();

  const merged = await sharp(blurredBackground)
    .composite([
      {
        input: containedPhoto,
        left: 0,
        top: 0
      }
    ])
    .png()
    .toBuffer();

  const mask = Buffer.from(`
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="0"
        y="0"
        width="${w}"
        height="${h}"
        rx="${radius}"
        ry="${radius}"
        fill="#fff"
      />
    </svg>
  `);

  return sharp(merged)
    .composite([
      {
        input: mask,
        blend: 'dest-in'
      }
    ])
    .png()
    .toBuffer();
}

function chooseLayout(text, hasPhoto, photoSlot) {
  const base = {
    cardX: 90,
    cardY: 160,
    cardW: 900,

    textX: 128,
    textY: 386,
    textMaxWidth: 780,

    photoX: 128,
    photoW: photoSlot.photoW,
    photoH: photoSlot.photoH,

    cardBottomLimit: 1705
  };

  // Fotoğraflı kartlarda satırların gereksiz yere bölünmesini önlemek için
  // orta-büyük puntodan başla. Metin uzarsa kademe kademe küçülür.
  const fontCandidates = [
    35,
    34,
    33,
    32,
    31,
    30,
    29,
    28
  ];

  for (const fontSize of fontCandidates) {
    const lineHeight = Math.round(fontSize * 1.32);
    const lines = wrapText(
      text,
      base.textMaxWidth,
      fontSize
    );

    const lastBaseline =
      base.textY + ((lines.length - 1) * lineHeight);

    const photoY = lastBaseline + 34;

    const timeY = hasPhoto
      ? photoY + base.photoH + 50
      : lastBaseline + 78;

    const dividerY = timeY + 43;
    const statsY = dividerY + 28;

    const cardH = statsY + 92 - base.cardY;

    if (base.cardY + cardH <= base.cardBottomLimit) {
      return {
        ...base,
        fontSize,
        lineHeight,
        lines,
        photoY,
        timeY,
        dividerY,
        statsY,
        cardH
      };
    }
  }

  const fontSize = 28;
  const lineHeight = Math.round(fontSize * 1.32);

  const lines = trimLines(
    wrapText(text, base.textMaxWidth, fontSize),
    hasPhoto ? 17 : 30
  );

  const lastBaseline =
    base.textY + ((lines.length - 1) * lineHeight);

  const photoY = lastBaseline + 34;

  const timeY = hasPhoto
    ? photoY + base.photoH + 50
    : lastBaseline + 78;

  const dividerY = timeY + 43;
  const statsY = dividerY + 28;

  const cardH = statsY + 92 - base.cardY;

  return {
    ...base,
    fontSize,
    lineHeight,
    lines,
    photoY,
    timeY,
    dividerY,
    statsY,
    cardH
  };
}

async function makeSkStory({ text, photoBuffer = null, engagementSettings = null }) {
  const hasPhoto = !!photoBuffer;

  const photoSlot = await getPhotoSlot(photoBuffer);

  const layout = chooseLayout(
    text,
    hasPhoto,
    photoSlot
  );

  const renderedText = await renderText(
    layout.lines,
    layout.textX,
    layout.textY,
    layout.fontSize,
    layout.lineHeight
  );

  const avatarSize = 92;
  const avatarX = 145;
  const avatarY = 218;

  const nameX = 262;
  const nameY = 250;

  const handleX = 262;
  const handleY = 288;

  const cardBottom = layout.cardY + layout.cardH;

  const footerY = Math.max(
    cardBottom + 58,
    1775
  );

  const dateLine = getDateParts();
  const stats = getEngagementStats(engagementSettings);

  const svg = `
    <svg
      width="${WIDTH}"
      height="${HEIGHT}"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="100%" height="100%" fill="#202123"/>

      <rect
        x="${layout.cardX}"
        y="${layout.cardY}"
        width="${layout.cardW}"
        height="${layout.cardH}"
        rx="28"
        ry="28"
        fill="#ffffff"
      />

      <text
        x="${nameX}"
        y="${nameY}"
        font-family="${TEXT_FONT}"
        font-size="43"
        font-weight="900"
        fill="#111820"
      >${esc(CONFIG.profileName)}</text>

      <text
        x="${handleX}"
        y="${handleY}"
        font-family="${TEXT_FONT}"
        font-size="31"
        font-weight="400"
        fill="#737a82"
      >${esc(CONFIG.profileHandle)}</text>

      ${renderedText.svg}

      <text
        x="128"
        y="${layout.timeY}"
        font-family="${TEXT_FONT}"
        font-size="27"
        fill="#70777f"
      >${esc(dateLine)}</text>

      <line
        x1="128"
        y1="${layout.dividerY}"
        x2="952"
        y2="${layout.dividerY}"
        stroke="#eef0f2"
        stroke-width="2"
      />

      ${iconsSvg(layout.statsY, stats)}

      <text
        x="540"
        y="${footerY}"
        text-anchor="middle"
        font-family="${TEXT_FONT}"
        font-size="28"
        font-weight="900"
        letter-spacing="7"
        fill="#77777a"
      >${esc(CONFIG.footerTitle)}</text>

      <text
        x="540"
        y="${footerY + 43}"
        text-anchor="middle"
        font-family="${TEXT_FONT}"
        font-size="23"
        fill="#77777a"
      >${esc(CONFIG.footerUrl)}</text>
    </svg>
  `;

  const composites = [];

  const avatar = await loadAvatar(avatarSize);

  composites.push({
    input: avatar,
    left: avatarX,
    top: avatarY
  });

  if (hasPhoto) {
    const photo = await makeRoundedPhoto(
      photoBuffer,
      layout.photoW,
      layout.photoH,
      18
    );

    composites.push({
      input: photo,
      left: layout.photoX,
      top: layout.photoY
    });
  }

  for (const task of renderedText.emojiTasks) {
    const emojiBuffer = await getEmojiImageBuffer(
      task.emoji,
      task.size
    );

    composites.push({
      input: emojiBuffer,
      left: task.left,
      top: task.top
    });
  }

  return sharp(Buffer.from(svg))
    .composite(composites)
    .png()
    .toBuffer();
}

module.exports = {
  makeSkStory
};