# Chrome Web Store submission draft

This is the copy source for the first public listing. Reconcile it with the
live package, privacy policy, and dashboard immediately before submission.

## Product details

### Name

Browser Control

### Manifest description

Chat with Codex and run user-initiated, supervised tab and page actions from Chrome's side panel.

### Category and language

- Primary category: Productivity
- Primary language: English
- Mature content: No

### Detailed description

Browser Control puts Codex in Chrome's side panel so you can chat, explicitly
attach the page you are reading, organize tabs, and request a fixed set of
supervised browser actions without switching applications.

Key features:

- Chat with the models available to an eligible ChatGPT/Codex account.
- Review and attach the current page's title, URL, selected text, and bounded
  readable text only when you choose.
- List, open, select, reload, group, ungroup, and close browser tabs.
- Inspect visible controls and request allowlisted clicking, filling, selecting,
  checking, keypress, scrolling, history, waiting, dragging, and form submission.
- See chronological browser activity, use short-lived element references, set a
  per-request action limit, and stop active work.
- Choose Ask every time for exact-site access and supported consequential-action
  confirmations, or explicitly enable Full access once for normal HTTP and HTTPS
  pages.

Full access can perform supported submit, save, send, publish, delete, schedule,
and tab-close actions after your request without an additional Browser Control
confirmation card. Both modes show activity, enforce limits, support Stop, and
refuse purchases, financial transactions, passwords, payment data,
authentication codes, private keys, CAPTCHAs, and security bypasses.

Requirements:

- macOS and current stable Google Chrome or Brave
- Node.js 20 or newer
- A compatible Codex CLI installation
- An eligible ChatGPT/Codex account
- The free Browser Control native companion, installed separately from the
  official support page

The companion is required because a Chrome extension cannot start Codex CLI
directly. It runs locally through Chrome Native Messaging. Browser Control does
not ask for an API key, scrape ChatGPT cookies, use remotely hosted executable
code, or include publisher analytics or advertising.

Current limitations: page inspection returns at most 80 visible interactive
controls. Protected Chrome pages, cross-origin frames, closed shadow roots,
browser dialogs, and canvas-only controls are unsupported. Browser Control is
not remote or unattended automation.

Privacy policy: https://07rjain.github.io/browser-control-support/privacy.html

Installation and support: https://07rjain.github.io/browser-control-support/support.html

Browser Control is an independent extension and is not affiliated with or
endorsed by OpenAI.

## Dashboard URLs

- Homepage: https://07rjain.github.io/browser-control-support/
- Privacy policy: https://07rjain.github.io/browser-control-support/privacy.html
- Support: https://07rjain.github.io/browser-control-support/support.html
- Companion downloads: https://github.com/07rjain/browser-control-support/releases

Verify all four links without authentication before submission.

## Single-purpose declaration

Browser Control's single purpose is to provide user-initiated Codex chat and
supervised, visible actions on Chrome tabs and normal web pages from the browser
side panel.

## Permission justifications

### `sidePanel`

Provides the extension's only primary interface: a persistent Codex chat and
browser-activity panel beside the current page.

### `storage`

Stores non-secret preferences, up to 30 bounded local conversation records,
browser-action activity, working-tab references, short-lived task state, and
remembered exact-origin consent. Reusable authentication credentials are not
stored in Chrome storage.

### `activeTab`

Provides temporary access after an explicit user gesture so the user can attach
the current page without granting persistent required access to every website.

### `scripting`

Injects only the packaged page extractor or fixed isolated-world page executor
after the applicable user gesture and Chrome host permission. Browser Control
does not evaluate model-provided code, JavaScript, selectors, XPath, or
coordinates.

### `tabs`

Supports the disclosed tab tools and exposes the title and URL needed to list,
select, open, reload, group, ungroup, or close the user's requested tabs. It does
not request Chrome history access.

### `tabGroups`

Names, colors, collapses, and removes groups for existing unpinned tabs selected
by the user. Ungrouping keeps every tab open.

### `nativeMessaging`

Connects the service worker to the separately installed local Browser Control
companion, which starts the user's Codex CLI/App Server. This keeps reusable
ChatGPT/Codex credentials out of the extension and produces Chrome's
“Communicate with cooperating native applications” install warning.

### Optional `http://*/*` and `https://*/*` host access

No host access is granted at installation. Ask every time requests only the
exact current origin when needed. Full access lets the user explicitly grant
optional normal-web access once so a user-started browser task can continue
across sites without repeated permission prompts. Chrome site controls and
Browser Control settings can revoke access.

## Privacy-practices draft

### Data categories to disclose

- Personally identifiable information: account email and account/plan state
  returned by Codex for display.
- Authentication information: Browser Control initiates and signs out the
  dedicated Codex login; credentials remain managed by Codex outside Chrome
  extension storage.
- Personal communications and user-generated content: prompts, responses, and
  locally retained conversation records.
- Website content: user-attached page context, inspected visible controls, and
  bounded non-sensitive visible form values.
- Web history or browsing activity: open-tab titles/URLs and origins used for
  user-requested browser work. Browser Control does not use the Chrome History
  API.
- User activity: requested browser actions and approval/result activity.
- Form data: non-sensitive values used for user-requested fill/select/check and
  reviewed submission.

Do not select financial information, health information, or location as an
intentionally collected category. The privacy policy must continue to explain
that user-selected website content can incidentally contain sensitive data and
that sensitive fields and transactions are refused.

### Use and Limited Use certifications

- Used only for app functionality and related security, maintenance, and support.
- Not sold or transferred for unrelated purposes.
- Not used for personalized, retargeted, or interest-based advertising.
- Not used for creditworthiness or lending.
- Human reading is prohibited except for the consent, security, legal, and
  aggregated/anonymized internal-operation exceptions allowed by policy.
- Collection is limited to what is necessary for the disclosed single purpose.
- The public policy contains the Chrome Web Store Limited Use statement.

### Data recipients

OpenAI's Codex service receives prompts and user-attached or browser-tool-returned
context under the user's authenticated account. The publisher does not operate
a telemetry, analytics, advertising, or transcript-storage server. Chrome Native
Messaging between the extension and companion remains local to the computer.

## Reviewer test instructions

Browser Control requires a separately installed macOS companion and an eligible
ChatGPT/Codex account. No publisher-managed test credential is embedded in the
extension. Do not use the publisher's personal account.

1. On macOS with current Chrome, install Node.js 20+ and a compatible Codex CLI.
   Confirm `node --version` and `codex --version` in Terminal.
2. Download the companion and `SHA256SUMS` from
   https://github.com/07rjain/browser-control-support/releases, verify the release as
   documented, extract it, and run `node scripts/install-native-host.mjs`.
3. Restart Chrome and open Browser Control from its toolbar action. The side
   panel should report the companion as available.
4. Select Sign in with ChatGPT and authenticate with an eligible reviewer-owned
   test account.
5. Open `https://example.com/`, attach the page, verify the attachment preview,
   remove it, attach again, and ask for a short summary.
6. Open two disposable tabs and ask Browser Control to list them. Verify activity
   appears and no tab is foregrounded or closed without that request.
7. In Ask every time mode, ask it to inspect and scroll `https://example.com/`.
   Approve the exact-origin access request and verify the activity/result.
8. Press Stop during a response and verify the task settles without repeating an
   action.
9. Use Clear browser data and permissions; confirm Chrome-side history and grants
   are removed while the Codex session remains. Then use Delete all Browser
   Control data and sign out; confirm the side panel returns to signed out and can
   reconnect without reinstalling the companion.

Do not test passwords, payment details, authentication codes, purchases, real
messages, real form submission, or private page data. Contact
cu.16bcs2797@gmail.com if the reviewer environment cannot install the companion
or access an eligible test account.

## Distribution

- Visibility: Public
- Regions: All regions unless legal/account availability requires exclusions
- In-app purchases: None sold by Browser Control
- Publishing: Publish publicly after approval; deferred publishing is not enabled
