# X-Post Story Tasarım — Tam Rehber

## Oluşturulan Dosyalar

| Dosya | Açıklama |
|-------|----------|
| `server.js` | **Güncellenmiş** image service — X-post SVG tasarımı (Resvg ile render) |
| `template-selhattin.html` | Selhattin Koç HTML şablonu (Playwright alternatifi) |
| `template-remaz.html` | Remaz İnşaat HTML şablonu (Playwright alternatifi) |
| `preview.html` | Selhattin Koç tarayıcı önizlemesi (örnek veriyle) |
| `preview-remaz.html` | Remaz İnşaat tarayıcı önizlemesi (örnek veriyle) |
| `generate_story.py` | Python + Playwright ile bağımsız story üretici |

---

## Seçenek 1: Mevcut Image Service'i Güncelle (ÖNERİLEN)

### Ne değişti?
- `server.js` dosyası **X-post (Twitter gönderi) tasarımına** geçirildi
- Arka plan: koyu gri `#1c1c1e`
- Ortada beyaz kart, yuvarlatılmış köşeler
- Profil fotoğrafı (dairesel), isim, kullanıcı adı, X logosu
- Hashtag'ler otomatik mavi (`#1d9bf0`)
- Fotoğraf: `object-fit: cover` davranışı (`preserveAspectRatio="xMidYMid slice"` + `clipPath`)
- Fake engagement bar (yorum, retweet, beğeni, bookmark)
- Alt kısımda brand watermark

### Kurulum
```bash
cd image-service
# Yeni server.js zaten mevcut — sadece yeniden başlat:
node server.js
```

### worker.js — HİÇBİR DEĞİŞİKLİK GEREKMİYOR
Mevcut çağrı aynen çalışır:
```javascript
fetch(`${env.IMAGE_SERVICE_URL}/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-secret': env.IMAGE_SECRET },
  body: JSON.stringify({ text: storyText, photoB64, photoWidth, photoHeight, brand })
})
```

### Profil Fotoğrafları (İsteğe bağlı)
Kartın sol üstündeki dairesel alanda logo yerine gerçek profil fotoğrafı görmek istersen:

```bash
# image-service/ dizinine kare (400x400+) JPEG koy:
profile-sk.jpg      → Selhattin Koç profil fotoğrafı
profile-remaz.jpg   → Remaz İnşaat profil fotoğrafı
```

Yoksa mevcut logolar kullanılır.

---

## Seçenek 2: Python + Playwright (Bağımsız)

Image service'e bağlı olmadan, doğrudan Python'da render.

### Kurulum
```bash
pip install playwright
playwright install chromium
```

### Kullanım
```python
from generate_story import generate_story

# Metin ile
png = await generate_story(
    text="Yeni projemiz! #remazinsaat #konut",
    brand="remaz"
)
with open("story.png", "wb") as f:
    f.write(png)

# Fotoğraf ile
with open("foto.jpg", "rb") as f:
    photo_bytes = f.read()

png = await generate_story(
    text="Hayalinizdeki ev 🏡 #insaat",
    brand="selhattin",
    photo_bytes=photo_bytes
)
```

---

## Şablon Değişkenleri (HTML versiyonu için)

| Değişken | Açıklama | Örnek |
|----------|----------|-------|
| `{{STORY_TEXT}}` | HTML metin (hashtag'ler `<span class="hashtag">` ile) | `Merhaba <span class="hashtag">#tag</span>` |
| `{{PHOTO_B64}}` | Opsiyonel fotoğraf (base64, prefix olmadan) | `iVBORw0KGgo...` |
| `{{PHOTO_DISPLAY}}` | `"block"` (var) veya `"none"` (yok) | `block` |
| `{{PROFILE_PHOTO_B64}}` | Profil fotoğrafı (base64) | `iVBORw0KGgo...` |
| `{{TWEET_DATE}}` | Tarih satırı | `12:45 · 6 Haz 2026` |
| `{{COMMENT_COUNT}}` | Fake yorum sayısı | `24` |
| `{{RETWEET_COUNT}}` | Fake retweet sayısı | `12` |
| `{{LIKE_COUNT}}` | Fake beğeni sayısı | `186` |

---

## Fotoğraf Boyut Koruma (KRİTİK)

### HTML/CSS versiyonunda:
```css
.photo-container {
  height: 420px;
  overflow: hidden;
}
.photo-container img {
  width: 100%;
  height: 100%;
  object-fit: cover;  /* ← EN/BOY ORANI BOZULMAZ */
}
```

### SVG versiyonunda (server.js):
```xml
<image ... preserveAspectRatio="xMidYMid slice"/>
<!-- + clipPath ile köşe yuvarlaklığı -->
```

**Her iki yöntemde de:**
- ✅ Resim yamulmaz / sünmez
- ✅ En-boy oranı korunur
- ✅ Container'a sığacak şekilde kırpılır
- ✅ Dikey/yatay/kare her oran düzgün görünür

---

## Marka Bilgileri

| Alan | Selhattin Koç | Remaz İnşaat |
|------|---------------|--------------|
| `brand` parametresi | `"selhattin"` | `"remaz"` |
| Görünen isim | Selhattin Koç | Remaz İnşaat |
| Kullanıcı adı | @selhattinkocinsaat | @remazinsaat |
| Watermark | SELHATTİN KOÇ İNŞAAT | REMAZ İNŞAAT |
| Website | selhattinkoc.web.app | remazinsaat.web.app |

---

## Önizleme

Tarayıcıda açmak için:
```
# Selhattin Koç:
image-service/preview.html

# Remaz İnşaat:
image-service/preview-remaz.html
```

Doğrudan çift tıklayarak tarayıcında açabilirsin. Tasarım %45 küçültülmüş olarak gösterilir (1080x1920 ekrana sığması için). Gerçek çıktı boyutu her zaman 1080x1920 pikseldir.

---

## Karşılaştırma: Eski vs Yeni Tasarım

| Özellik | Eski (Kurumsal) | Yeni (X-Post) |
|---------|-----------------|---------------|
| Arka plan | Beyaz + renkli header bandı | Koyu gri (#1c1c1e) |
| Kart | Yok, full-bleed tasarım | Beyaz yuvarlak kart |
| Profil | Logo + şirket adı | Profil fotoğrafı + isim + @handle |
| Metin | Navy mavi, düz | Siyah, hashtag'ler mavi |
| Fotoğraf | `preserveAspectRatio="xMidYMid meet"` | `preserveAspectRatio="xMidYMid slice"` (cover) |
| Alt bilgi | Footer bandı | Fake engagement + watermark |
| Stil | Kurumsal banner | Sosyal medya gönderisi |
