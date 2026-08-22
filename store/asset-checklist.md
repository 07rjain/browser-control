# Chrome Web Store asset checklist

All screenshots must use disposable pages and redact email addresses, account
details, private URLs, prompts, page content, identifiers, and credentials.

## Required packaged icons

- [x] 16x16 PNG: toolbar/favicon scale
- [x] 32x32 PNG: Windows and high-density toolbar scale
- [x] 48x48 PNG: extension management page
- [x] 128x128 PNG: Chrome Web Store/package icon
- [x] Add the four paths to `manifest.icons` and appropriate action icon paths
- [x] Keep the 128x128 artwork visually centered with transparent breathing room
- [x] Confirm every declared file exists in the final ZIP

Use original Browser Control artwork. Do not use OpenAI, ChatGPT, Codex, Chrome,
or Google logos, confusingly similar marks, screenshots, or UI fragments as the
icon.

## Required Store assets

- [x] Store icon: 128x128 PNG
- [x] Small promo tile: 440x280 PNG
- [x] Three Store screenshots, each 1280x800 PNG
  - [x] Ready side-panel home state
  - [x] Explicit disposable page attachment
  - [x] Harmless completed request and result
- [x] Square corners, full bleed, no distortion
- [x] Verify screenshots match the exact submitted build
- [x] Verify copy remains readable when screenshots are downscaled to 640x400

## Optional assets

- [ ] Marquee promo image: 1400x560, only if launch promotion needs it
- [ ] YouTube promo video, only if the live dashboard marks it required or the
      release benefits from it
- [ ] Localized screenshots and listing copy for any supported language beyond
      English

Chrome's official pages conflict on whether a promotional video is mandatory;
the image guidance identifies icon, small promo, and screenshot as mandatory.
Treat live dashboard validation as authoritative.

## Listing and site verification

- [x] Product name availability checked in the live Store
- [x] Publisher identity and contact in the privacy policy match the verified
      Developer Dashboard account before the site is deployed
- [x] Manifest description is no more than 132 characters
- [x] Detailed description accurately states macOS, Node, Codex CLI, eligible
      account, and separate companion requirements above the fold
- [x] Independent/non-affiliation disclaimer is visible
- [x] Privacy, support, and homepage URLs work without login
- [x] GitHub Pages contains no analytics, cookies, remote scripts, remote fonts,
      or externally loaded images
- [ ] Dashboard single purpose, permission justifications, data checkboxes, and
      privacy policy use consistent terminology
- [ ] Public distribution, regions, and deferred-publishing choice reviewed
- [ ] Reviewer instructions tested from a clean macOS user and Chrome profile

## Package evidence

- [x] `manifest.json` is at ZIP root
- [x] No source maps, secrets, test fixtures, node_modules, private keys, or
      companion executable are in the extension ZIP
- [x] Extension ZIP and companion archive have recorded SHA-256 hashes
- [x] Final unpacked ID matches the Store Item ID
- [x] Native host `allowed_origins` contains the exact Store ID
- [ ] Companion GitHub Release is live before Submit for Review
- [x] Privacy/support pages are live before Submit for Review
