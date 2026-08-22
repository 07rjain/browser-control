# Chrome Web Store asset checklist

All screenshots must use disposable pages and redact email addresses, account
details, private URLs, prompts, page content, identifiers, and credentials.

## Required packaged icons

- [ ] 16x16 PNG: toolbar/favicon scale
- [ ] 32x32 PNG: Windows and high-density toolbar scale
- [ ] 48x48 PNG: extension management page
- [ ] 128x128 PNG: Chrome Web Store/package icon
- [ ] Add the four paths to `manifest.icons` and appropriate action icon paths
- [ ] Keep the 128x128 artwork visually centered with transparent breathing room
- [ ] Confirm every declared file exists in the final ZIP

Use original Browser Control artwork. Do not use OpenAI, ChatGPT, Codex, Chrome,
or Google logos, confusingly similar marks, screenshots, or UI fragments as the
icon.

## Required Store assets

- [ ] Store icon: 128x128 PNG
- [ ] Small promo tile: 440x280 PNG or JPEG
- [ ] At least one screenshot; prepare three, each 1280x800 PNG or JPEG
  - [ ] Companion-required/sign-in onboarding state
  - [ ] Ready side-panel chat with an explicit disposable page attachment
  - [ ] Supervised activity with permission mode and Stop visible
- [ ] Square corners, full bleed, no padding, no distortion
- [ ] Verify screenshots match the exact submitted build
- [ ] Verify copy remains readable when screenshots are downscaled to 640x400

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

- [ ] Product name availability checked in the live Store
- [ ] Publisher identity and contact in the privacy policy match the verified
      Developer Dashboard account before the site is deployed
- [ ] Manifest description is no more than 132 characters
- [ ] Detailed description accurately states macOS, Node, Codex CLI, eligible
      account, and separate companion requirements above the fold
- [ ] Independent/non-affiliation disclaimer is visible
- [ ] Privacy, support, homepage, and companion download URLs work without login
- [ ] GitHub Pages contains no analytics, cookies, remote scripts, remote fonts,
      or externally loaded images
- [ ] Dashboard single purpose, permission justifications, data checkboxes, and
      privacy policy use consistent terminology
- [ ] Public distribution, regions, and deferred-publishing choice reviewed
- [ ] Reviewer instructions tested from a clean macOS user and Chrome profile

## Package evidence

- [ ] `manifest.json` is at ZIP root
- [ ] No source maps, secrets, test fixtures, node_modules, private keys, or
      companion executable are in the extension ZIP
- [ ] Extension ZIP and companion archive have recorded SHA-256 hashes
- [ ] Final unpacked ID matches the Store Item ID
- [ ] Native host `allowed_origins` contains the exact Store ID
- [ ] Companion GitHub Release is live before Submit for Review
- [ ] Privacy/support pages are live before Submit for Review
