# Chrome Web Store release material

This directory contains the public site and submission copy for the first
public Chrome Web Store release of Browser Control.

## Layout

- `site/` is a dependency-free static site ready to publish as the root of a
  GitHub Pages deployment.
- `chrome-web-store-listing.md` contains copy for the Store Listing, Privacy,
  and Test instructions tabs.
- `asset-checklist.md` records required image sizes, content, and release
  checks.

The intended public URLs are:

- Product: `https://07rjain.github.io/browser-control-support/`
- Privacy: `https://07rjain.github.io/browser-control-support/privacy.html`
- Support: `https://07rjain.github.io/browser-control-support/support.html`
- Companion releases: `https://github.com/07rjain/browser-control-support/releases`

Publish `store/site/` as the GitHub Pages artifact so that it becomes the site
root. Verify every URL without authentication before copying it into the Chrome
Web Store dashboard.

The site intentionally contains no analytics, cookies, remote scripts, remote
fonts, or third-party media. Keep that property when updating it.
