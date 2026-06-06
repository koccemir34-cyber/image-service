"""
X-Post Instagram Story Generator — Playwright versiyonu
Image service'e bagimli olmadan, dogrudan Python'da calisir.

Kullanim:
    pip install playwright
    playwright install chromium
    python generate_story.py
"""

import base64
import os
import re
import random
import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


# ── BRAND CONFIG ───────────────────────────────────────────────────────────
BRANDS = {
    "selhattin": {
        "name":      "Selhattin Koç",
        "handle":    "@selhattinkocinsaat",
        "watermark": "SELHATTİN KOÇ İNŞAAT",
        "website":   "selhattinkoc.web.app",
        "profile":   os.path.join(SCRIPT_DIR, "profile-sk.jpg"),
    },
    "remaz": {
        "name":      "Remaz İnşaat",
        "handle":    "@remazinsaat",
        "watermark": "REMAZ İNŞAAT",
        "website":   "remazinsaat.web.app",
        "profile":   os.path.join(SCRIPT_DIR, "profile-remaz.jpg"),
    },
}


def load_template(brand: str) -> str:
    path = os.path.join(SCRIPT_DIR, f"template-{brand}.html")
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def highlight_hashtags(text: str) -> str:
    """#etiket → <span class="hashtag">#etiket</span>"""
    return re.sub(
        r'(#[\wçğıöşüÇĞİÖŞÜ]+)',
        r'<span class="hashtag">\1</span>',
        text
    )


def format_tweet_date() -> str:
    now = datetime.datetime.utcnow() + datetime.timedelta(hours=3)
    months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
              'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
    h = now.strftime('%H:%M')
    return f'{h} · {now.day} {months[now.month - 1]} {now.year}'


def fake_engagement() -> dict:
    return {
        'comments': random.randint(5, 80),
        'retweets': random.randint(3, 40),
        'likes':    random.randint(50, 500),
    }


def b64_file(path: str) -> str:
    """Dosyayı base64'e çevir. Yoksa boş string."""
    if not os.path.exists(path):
        return ""
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def text_to_html(raw_text: str) -> str:
    """
    Ham metni HTML'e çevir:
    - Satır sonları → <br>
    - Hashtag'ler → <span class="hashtag">...</span>
    """
    paragraphs = raw_text.split('\n')
    parts = []
    for i, p in enumerate(paragraphs):
        highlighted = highlight_hashtags(p.strip())
        parts.append(highlighted)
        if i < len(paragraphs) - 1:
            parts.append('<br>')
    return '<br>'.join(parts) if len(parts) > 1 else parts[0]


async def generate_story(
    text: str,
    brand: str = "selhattin",
    photo_bytes: bytes | None = None,
) -> bytes:
    """
    X-post konseptli Instagram Story (1080x1920) oluştur.

    Args:
        text:        Story metni
        brand:       "selhattin" veya "remaz"
        photo_bytes: Opsiyonel fotoğraf (JPEG/PNG bytes)

    Returns:
        PNG bytes (1080x1920)
    """
    from playwright.async_api import async_playwright

    brand_cfg = BRANDS.get(brand, BRANDS["selhattin"])
    template = load_template(brand)

    # Profil fotoğrafı
    profile_b64 = b64_file(brand_cfg["profile"])

    # Opsiyonel fotoğraf
    photo_b64 = ""
    photo_display = "none"
    if photo_bytes:
        photo_b64 = base64.b64encode(photo_bytes).decode()
        photo_display = "block"

    # Metin → HTML
    text_html = text_to_html(text)

    # Tarih & engagement
    date_str = format_tweet_date()
    eng = fake_engagement()

    # Şablonu doldur
    html = (
        template
        .replace("{{STORY_TEXT}}", text_html)
        .replace("{{PHOTO_B64}}", photo_b64)
        .replace("{{PHOTO_DISPLAY}}", photo_display)
        .replace("{{PROFILE_PHOTO_B64}}", profile_b64)
        .replace("{{TWEET_DATE}}", date_str)
        .replace("{{COMMENT_COUNT}}", str(eng["comments"]))
        .replace("{{RETWEET_COUNT}}", str(eng["retweets"]))
        .replace("{{LIKE_COUNT}}", str(eng["likes"]))
    )

    # HTML → PNG
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1080, "height": 1920})
        await page.set_content(html, wait_until="networkidle")
        await page.wait_for_timeout(500)  # font yükleme

        png_bytes = await page.screenshot(
            type="png",
            clip={"x": 0, "y": 0, "width": 1080, "height": 1920},
        )
        await browser.close()

    return png_bytes


# ── Demo ────────────────────────────────────────────────────────────────────
async def main():
    print("🎨 Story oluşturuluyor...")

    png = await generate_story(
        text='"""Hayallerinizdeki evi inşa etmek için ilk adımımızı birlikte atalım."""\n\nHer proje, güven ve kalite ile buluşuyor.\n\n#selhattinkocinsaat #insaat #hayalinizdekiEv',
        brand="selhattin",
    )

    out = os.path.join(SCRIPT_DIR, "story_output.png")
    with open(out, "wb") as f:
        f.write(png)
    print(f"✅ Story kaydedildi: {out}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
