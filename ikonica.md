# Ikonica — kako je napravljena

App ikonica živi u dva oblika:

- **`icon-source.svg`** / **`favicon.svg`** — master SVG (jedini fajl koji se edituje ručno)
- **PNG/ICO derivati** (`web-app-manifest-512x512.png`, `web-app-manifest-192x192.png`, `apple-touch-icon.png`, `favicon-96x96.png`, `favicon.ico`) — generisani iz SVG-a, ne edituju se ručno

## Dizajn

Ikonica ima dva sloja:

1. **Pozadina** — rounded square (`rx=108`) sa trikolornom wavy podelom: crvena (`#C6363C`), plava (`#0C4076`), bela. Iste boje i talasi kao parking app, zbog vizuelne konzistentnosti.
2. **Centar** — bela rounded payment kartica (`104, 112, 304×288, rx=40`) sa tamnim outline-om (`#1A1A1A`, stroke 22). Unutra su mali stilizovani QR blokovi, oznaka **RSD** i veliki ček znak, tako da ikonica prvo komunicira plaćanje, a QR ostaje sekundarni signal.

Centralni payment znak ima 4 grupe elemenata:

- **QR signal** — mali svetlosivi rounded kvadrat sa nekoliko tamnih blokova, nije skenabilan
- **RSD oznaka** — kratak tekstualni payment signal za lokalni kontekst
- **Ček znak** — veliki plavi znak sa tamnim unutrašnjim potezom za potvrđeno plaćanje
- **Akcent blokovi** — mali crveni i tamni kvadrati koji povezuju QR/payment temu sa bojama pozadine

Refrenca za stil: `https://cdn-icons-png.flaticon.com/512/2313/2313147.png`

## Kako regenerisati PNG-ove iz SVG-a

Kada se promeni `icon-source.svg`, treba regenerisati sve PNG derivate.

### Zašto Chromium, a ne ImageMagick / Inkscape

`magick file.svg output.png` na ovom sistemu **ne radi pouzdano**:
- ImageMagick delegira SVG renderovanje na `rsvg-convert` (librsvg), koji nije instaliran
- Fallback je Inkscape snap, koji ne može da čita `/tmp` zbog snap confinement-a
- Krajnji fallback je internal MSVG parser koji **gubi stroke-only elemente** (brackets i outline-ovani rect-ovi se ne renderuju)

Rešenje: Chromium headless screenshot režim renderuje SVG kroz pravi browser, što je 1:1 sa onim što korisnik vidi.

### Komande

Render master 512×512 i downscale (pokrenuti iz `/home/acop/websites/qrpay/`):

```bash
# 1. Master render kroz Chromium headless (SVG ima eksplicitan width=512)
chromium --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1024,1024 --default-background-color=00000000 \
  --screenshot="$(pwd)/_master.png" "file://$(pwd)/icon-source.svg"

# 2. Iseci na 512×512 (chromium napravi 1024×1024 viewport)
magick _master.png -crop 512x512+0+0 +repage _master512.png
rm _master.png

# 3. Downscale sa Lanczos filterom (crisp na malim sajzovima)
magick _master512.png -filter Lanczos -resize 512x512 web-app-manifest-512x512.png
magick _master512.png -filter Lanczos -resize 192x192 web-app-manifest-192x192.png
magick _master512.png -filter Lanczos -resize 180x180 apple-touch-icon.png
magick _master512.png -filter Lanczos -resize 96x96  favicon-96x96.png
magick _master512.png -filter Lanczos -resize 32x32  _f32.png
magick _master512.png -filter Lanczos -resize 16x16  _f16.png

# 4. Multi-size .ico (16+32+96) za stare browser-e
magick _f16.png _f32.png favicon-96x96.png favicon.ico

# 5. Cleanup
rm _f16.png _f32.png _master512.png
```

**Napomena:** Chromium snap ne može da piše u `/tmp` (snap confinement). Output putanje moraju biti unutar `$HOME` ili project dir-a.

## Posle regenerisanja

1. Bumpovati `CACHE_VERSION` u `service-worker.js` (npr. `v6` → `v7`) da PWA cache zna da povuče nove ikonice
2. Hard refresh u browseru (Ctrl+Shift+R)
3. Ako je app instaliran kao PWA, OS može keširati staru ikonicu — deinstaliraj pa reinstaliraj da pokupi novu

## Reference fajlovi po nameni

| Fajl                              | Veličina | Gde se koristi                                  |
|-----------------------------------|----------|-------------------------------------------------|
| `favicon.svg`                     | scalable | Browser tab (moderni browseri)                  |
| `favicon.ico`                     | 16+32+96 | Stari browseri, bookmark, Windows               |
| `favicon-96x96.png`               | 96×96    | `<link rel="icon">` PNG fallback, SW notification badge |
| `apple-touch-icon.png`            | 180×180  | iOS home screen ikona                           |
| `web-app-manifest-192x192.png`    | 192×192  | Android home screen / Chrome install            |
| `web-app-manifest-512x512.png`    | 512×512  | PWA splash screen, OG/Twitter card thumbnail    |

Svi fajlovi su referencirani iz `index.html` (`<link>` tagovi) i `manifest.json` (icons array).
