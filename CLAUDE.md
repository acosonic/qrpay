# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

Static PWA for generating **NBS IPS QR codes** (Serbian National Bank instant-payment QR format). Single HTML file, vanilla JS, no build step, no backend. Deployed to `https://acosonic.github.io/qrpay/` via GitHub Pages — `main` branch is the live deploy target.

**All paths are relative** (`./`, `manifest.json`, `service-worker.js`, etc.) so the app runs unchanged from any subdirectory. Don't add absolute paths like `/qrpay/...` — they'll break Pages or the local dev server.

UI is **Serbian** (`lang="sr"`). Keep it that way. Comments and CLAUDE/docs are English.

## Layout (the parts that matter)

- `index.html` — entire UI + logic, single file. Sections: header (theme/install buttons), Moji QR kodovi (saved codes, collapsed by default), Unos podataka (paste textarea + Iznos visible, rest in `<details id="more-fields">`), QR kod (canvas + share row). All JS lives in the trailing `<script>`.
- `postal-codes.js` — `window.SRB_POSTAL_CODES = { "11000": "Beograd", ... }`, 1138 entries. Source: [stefancode/Srbija-gradovi](https://github.com/stefancode/Srbija-gradovi). Used by the paste parser to confirm a 5-digit run is a real Serbian postal code before treating it as one.
- `service-worker.js` — network-first for HTML, stale-while-revalidate for same-origin assets and cdnjs/jsdelivr. **Bump `CACHE_VERSION` after every shell change** (it's the one signal users get on reload).
- `manifest.json` — PWA manifest, theme `#0a4ea2`, relative icon paths.
- Icons: `favicon.svg` (= `icon-source.svg`), `favicon.ico` (16+32+96), `favicon-96x96.png`, `apple-touch-icon.png` (180), `web-app-manifest-192x192.png`, `web-app-manifest-512x512.png`.
- `ikonica.md` — design + how to regenerate PNGs from `icon-source.svg`. **Read this before touching any icon.**
- `screenshots/desktop.png`, `screenshots/mobile.png` — README hero shots. Regen script lives in `/tmp/qrpay-shots/screenshot.js` (not in repo; it uses puppeteer-core + system Chrome). See "Screenshot regeneration" below.

## NBS IPS QR format — the rules

Implemented in `index.html` helpers. Output string format:

```
K:PR|V:01|C:1|R:<18digits>|N:<name+\r\n+street+\r\n+city>|I:RSD<n>,<dd>|SF:<3digits>|S:<purpose>|RO:<reference>
```

- **Field order is fixed** (`buildIpsString` iterates a hardcoded list `["K","V","C","R","N","I","P","SF","S","RO"]`). Don't reorder — NBS validator is strict.
- `K=PR` (Plaćanje računa), `V=01`, `C=1` (UTF-8) are constants.
- **Account (`R`)** is **always 18 digits**, no separators. `expandAccountNumber()` accepts both `XXX-XXXXXXX-XX` and bare 18-digit input, normalizes to 18 digits with mid-section zero-padded to 13. `validateAccountChecksum()` runs **MOD 97-10** (`98 - (body*100) % 97 === check`); we warn-but-allow on mismatch.
- **Name (`N`)** can be up to 3 lines separated by `\r\n` (recipient / street / city), max 70 chars total. `formatNameForIps()` truncates the last line until the whole thing fits.
- **Amount (`I`)** is optional. When empty we **omit the `I` field entirely** (representing "open amount"). If the user types `1500` we serialize as `RSD1500,00`.
- **Payment code (`SF`)** is required, must match `^[12]\d{2}$` (3 digits starting with 1 or 2). Default `189`.
- **Reference (`RO`)** model prefix must be one of `97`, `22`, `11`, `00`. If user types a reference without a known model prefix we auto-prepend `00`.

The original source for these rules: [ArtBIT/ips-qr-code schema](https://github.com/ArtBIT/ips-qr-code/blob/master/lib/schema.js) and [dusnm/nbs-ips-qr](https://github.com/dusnm/nbs-ips-qr/blob/master/src/account_number.js) (account expansion + checksum). When in doubt, consult those repos.

## Paste parser (`parsePastedText`)

Order of operations matters — fix carefully:

1. Match account: try `\d{3}-\d{1,13}-\d{2}` first, then fall back to `(?<!\d)\d{18}(?!\d)`. The negative look-arounds prevent partial matches inside longer digit runs.
2. Find a 5-digit run that exists in `SRB_POSTAL_CODES`. Use that as `postalCode`; capture the text up to the next comma/newline as the city tail.
3. Split remaining text by `,` and `\n`.
4. For each piece, try `extractBankFromPiece()` — checks longest known bank fragments first (Banca Intesa beats Banca alone), falls back to "`<word> banka/bank/banca`" pattern. **The bank is intentionally dropped** from the IPS output — the account number already identifies the bank.
5. Of the remaining pieces, the one containing a digit (street number) is the `street`; the rest concatenated is `name`.

If you change parser semantics, run the Node test inline in this file's history (search git log for "parser" or just rerun `tests` in the existing test snippets we used).

## Security stance

This is a **payment-adjacent app**, so the security posture is more conservative than typical static sites. Don't relax these without a clear reason:

- **All JS is self-hosted.** `qrcode.min.js` is checked into the repo (vendored from [kazuhikoarase/qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), MIT). **Don't introduce CDN `<script>` tags** for anything — a compromised CDN would let an attacker inject code into a payment flow. The SW's `isCacheableCdn` is hard-coded to `false` for the same reason.
- **No build pipeline** in production → no `npm install` supply-chain surface. The repo *is* the deployed artifact.
- **No analytics, no third-party trackers, no fonts from Google.** If you need a new dependency, vendor it.
- **Payment data never leaves the browser.** Share-back links use `#hash` so the URL fragment doesn't reach servers; no fetch/XHR posts payment fields anywhere.
- **First-visit disclaimer modal** (`#disclaimer-modal`) gates the app until acknowledged. Persistent via `localStorage["qrpay-disclaimer-ack"]`. Inline `.notice` banners sit above Generate and the share row. Footer carries the same disclaimer. If you remove or weaken these, you're removing a layer the owner explicitly asked for.
- **GitHub org has 2FA.** Commits to `main` should preserve that — never push tokens, never link a less-protected automation account.

## Storage

- `localStorage["qrpay-theme"]` — `"light"` | `"dark"`. Default uses `prefers-color-scheme`.
- `localStorage["qrpay-saved-codes"]` — JSON array of `{ id, label, createdAt, account, amount, name, street, city, paymentCode, purpose, payer, reference }`. Newest first when rendered.
- No IndexedDB, no cookies, no backend storage.

## URL hash for share-back links

`buildAutoLink(data)` produces `<base>#a=...&n=...&i=...&sf=...&pu=...&pl=...&rb=...`. On load, `applyHashIfAny()` reads the hash, fills the form, fires Generate. **Use hash (not query)** so payment data never reaches the server in HTTP logs or referers.

Param names (kept short for URL length):

| Key | Field             |
|-----|-------------------|
| `a` | account           |
| `n` | name (recipient)  |
| `s` | street            |
| `c` | city + postal     |
| `i` | amount            |
| `sf`| payment code      |
| `pu`| purpose           |
| `pl`| payer             |
| `rb`| reference         |

Don't change these without considering existing shared links breaking.

## Sharing model

Three layers in order of preference:

1. **Web Share API Level 2** (`navigator.share({files, text})`). Preferred — opens system share sheet with PNG attached. Viber/WhatsApp/Email buttons all try this first. Browser support: Chrome on Android, Safari iOS 15+.
2. **Clipboard image** (`navigator.clipboard.write([new ClipboardItem({"image/png": blob})])`) + URL-scheme deep link (`viber://forward?text=`, `https://wa.me/?text=`, `mailto:?subject=...&body=...`). Used when Web Share API can't share files. User long-presses → Paste in the chat.
3. **Text-only** — last fallback when clipboard write fails. The shared text always includes the autogenerate link, so even text-only sharing reproduces the QR on the recipient's phone.

The shared PNG **includes a caption** (recipient, account, amount, purpose) baked into the image by `renderQrToCanvas(canvas, ips, size, info)`. Don't render plain QR without the info object — recipients seeing just a QR have no context.

## Service worker

Strategy is in the file header. Key invariants:

- `CACHE_VERSION` (currently bumped per change) namespaces the cache. On `activate`, old `qrpay-*` caches are deleted.
- `SCOPE` is read from `self.registration.scope` so the SW works at any deploy path (`/`, `/qrcode/`, `/qrpay/`).
- The SW responds to a `CLEAR_CACHE` message — useful for a future "refresh assets" button (parking has one).
- HTML navigations are **network-first** so deploys propagate immediately. Other same-origin requests are stale-while-revalidate (next visit gets the fresh version).

## Icon regeneration

`icon-source.svg` is the only icon source. See `ikonica.md` for the full pipeline. TL;DR: render via **Chromium headless** (not ImageMagick — librsvg isn't installed; the Inkscape snap can't read `/tmp`; ImageMagick's internal MSVG parser drops stroke-only elements). Always re-render all 5 sizes + `.ico` after editing the SVG, and bump SW version.

## Screenshot regeneration

`screenshots/desktop.png` and `screenshots/mobile.png` are generated by `/tmp/qrpay-shots/screenshot.js` (not committed — it's a dev tool). To regenerate:

```bash
mkdir -p /tmp/qrpay-shots && cd /tmp/qrpay-shots
npm init -y
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm install puppeteer-core
# Copy the screenshot.js from prior session or rewrite — it seeds localStorage
# with demo "Moji QR kodovi" entries, fills the form with Petar Petrović data,
# clicks Generate, then captures 1280×900 desktop + 412×900 mobile.
python3 -m http.server 8765 &   # if not running
node screenshot.js
```

Outputs land directly in `/home/acop/websites/qrpay/screenshots/`.

## Common edits

- **Bump SW after touching shell files** (`index.html`, `postal-codes.js`, manifest, icons). Look for `const CACHE_VERSION = 'vN'` and increment.
- **Add a payment code option** — edit the `<select id="payment-code">` block in `index.html`. The schema-validation regex `^[12]\d{2}$` already accepts new ones.
- **Add a bank to the parser** — append a lowercase fragment to `BANK_FRAGMENTS`. Order doesn't matter; the matcher sorts by length and tries longest first.
- **Update postal codes** — re-run the conversion in `postal-codes.js`. Original source: [stefancode/Srbija-gradovi](https://github.com/stefancode/Srbija-gradovi)'s `srbija-svi-gradovi.json`.

## Gotchas

- **Don't use absolute paths** anywhere in HTML/JS/manifest/SW. The app must run at `/`, `/qrcode/`, `/qrpay/`, etc. without changes.
- **The QR caption is part of the PNG**, not separate HTML. Recipients paste the image in a chat and immediately see recipient/amount/purpose — don't refactor caption into a side panel.
- **`viber://` URL scheme cannot accept files**, only text. The "share PNG to Viber" flow goes through Web Share API + system share sheet, not a Viber-specific URL. If a user reports "Viber didn't get the image", check if their browser supports Web Share API L2 — that's the actual gate.
- **Pages deploy URL is `acosonic.github.io/qrpay/`** with a trailing slash; without slash GitHub Pages returns 404 on relative `manifest.json` lookups.
- **Service worker scope is determined at registration time** by the SW file's path. Don't move `service-worker.js` into a subdirectory — it'll lose visibility of `/index.html`.
- **iOS Safari clipboard image is flaky.** Don't rely on the clipboard fallback for iOS — the Web Share API path is the only reliable one. Test on Android + iOS independently when changing share flow.
