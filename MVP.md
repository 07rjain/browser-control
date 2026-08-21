# Browser Control MVP and Supervised Browser-Control Build Plan

- Status: MVP implementation complete locally; approved supervised browser control implemented, Chrome validation pending
- Product requirements: `PRD.md`
- Owner: `codex-chrome-extension-manager`
- Updated: 2026-08-21

## 1. Outcome

Ship a private development MVP of a Chromium Manifest V3 extension that opens as a persistent side panel, lets a user authenticate through a supported ChatGPT/Codex flow, streams a Codex chat, optionally attaches current-page context, and performs a small allowlist of local tab actions.

The MVP remains the product foundation. The approved follow-on milestone adds only the supervised, allowlisted page controls defined here and in `next_set_off_feature.md`; this is not remote or arbitrary browser automation.

## 2. What ships

The MVP must include:

- Toolbar-icon toggle for a global Chrome side panel.
- Sign in with ChatGPT for Codex subscription access through the supported local Codex integration proved in Phase 0.
- Signed-out, authenticating, ready, streaming, stopped, offline, and error states.
- Streaming text chat with safe Markdown, stop, retry, new chat, and active-chat continuity.
- Explicit “Attach current page” control with preview and removal before sending.
- Current-page title, URL, selected text, and size-limited readable text extraction.
- Seven validated tab tools: list, activate, open, reload, group, ungroup, and permission-mode-governed close.
- Eleven validated page tools with exact-origin permission, opaque references, activity visibility, Stop, and task-captured Full access or Ask every time behavior for consequential actions.
- Task-scoped background working tabs that do not steal focus, plus an optional local completion tone and sidebar completion notice.
- Local settings, active-conversation state, logout, and clear-local-data controls.
- Automated checks plus real-browser validation of the unpacked extension.

## 3. What does not ship

- Remote browser control or remote access.
- Agent Bus integration in the user-facing extension.
- Actions initiated by other agents or devices.
- Unattended or remotely initiated automation.
- Purchases, downloads, arbitrary JavaScript/selectors/coordinates, secret entry, or security bypasses.
- Connectors until supervised browser-control validation passes and a connector PRD is approved.
- Continuous collection of tabs, page contents, browsing history, or cookies.
- Telemetry, analytics, billing, organization administration, or sync.
- Chrome Web Store submission or production release.
- Firefox, Safari, mobile, or guaranteed cross-platform companion packaging.

Any request to add one of these items requires explicit user approval and an update to `PRD.md` and this file.

## 4. Primary user flow

1. Install the development build and required local companion.
2. Click the toolbar icon; Browser Control opens in the sidebar.
3. Select “Sign in with ChatGPT” and finish the supported browser flow.
4. Send a message and receive a streamed response.
5. Optionally attach the current page after reviewing what will be shared.
6. Ask about open tabs or request one of the seven allowed tab actions.
7. Ask Codex to navigate the current site; grant exact-origin access when Chrome prompts.
8. Review the activity log. Full access runs supported consequential controls, form submission, form-associated Enter, and tab closing directly; Ask every time pauses for explicit confirmation.
9. Stop any active browser task or close/reopen the panel without silently repeating actions.
10. Sign out or clear locally retained chat data.

## 5. System boundary

```text
Side-panel React UI
        |
        | typed extension messages
        v
Manifest V3 service worker ----> Chrome Tabs / Side Panel / Storage / Scripting APIs
        |
        | validated page commands after exact-origin grant
        v
Packaged isolated-world page executor ----> current tab DOM
        |
        | authenticated, schema-validated local protocol
        v
Local Codex bridge ----> supported Codex app-server/authentication interface
```

- The side panel renders state and asks for user decisions; it does not execute privileged browser actions.
- The service worker validates requests, applies browser-action policy, owns approvals/idempotency, and is the only extension component allowed to invoke tab or page tools.
- A content extractor runs only after an explicit user gesture using temporary `activeTab` access.
- The local bridge owns Codex credentials and streaming transport. Reusable credentials never enter extension storage or logs.
- Model and page output are untrusted. Code-side policy, not model prose, decides whether an action is allowed.

## 6. Technology baseline

- Chrome Manifest V3, minimum Chrome 114.
- TypeScript in strict mode.
- React for the side-panel UI.
- Vite with a maintained Manifest V3 extension integration.
- Runtime schemas for every cross-context and bridge message.
- `chrome.storage.local` for non-secret local state.
- Vitest and Testing Library for unit and component tests.
- Playwright or extension-aware Chrome DevTools automation for browser tests.
- Node.js native-messaging host selected by the Phase 0 spike; it launches Codex app-server over JSONL stdio with an isolated `CODEX_HOME`.

Dependencies and canonical commands are recorded in `package.json` and `README.md`; update both when tooling changes.

## 7. Manifest permission budget

| Permission | MVP reason |
| --- | --- |
| `sidePanel` | Host the primary assistant UI beside web pages. |
| `storage` | Persist non-secret settings and active-chat continuity. |
| `activeTab` | Grant temporary current-page access following a user gesture. |
| `scripting` | Inject the page extractor only after the user attaches the page. |
| `tabs` | Read tab titles/URLs for the requested all-tabs view and manage allowed tab actions. |
| `nativeMessaging` | Connect only to the exact-origin local Codex companion. |
| Optional `http://*/*`, `https://*/*` | Permit a later, user-activated request for only the current origin when `activeTab` is unavailable. These patterns grant no install-time site access. |

Native messaging is required by the accepted Phase 0 decision. Its host manifest pins `allowed_origins` to the extension's fixed ID; no loopback listener is exposed.

Do not request persistent required `<all_urls>`, `cookies`, `history`, `bookmarks`, `downloads`, `webRequest`, or `debugger` for the MVP.

## 8. Work packages

### M0 — Authentication and streaming spike

Deliverables:

- Start the supported local Codex interface.
- Initiate ChatGPT browser login and observe success, cancellation, failure, account state, refresh/relaunch behavior, and logout.
- Complete one streamed user-message/assistant-response round trip.
- Prove that the extension can communicate through either native messaging or an authenticated loopback bridge.
- Write an architecture decision record describing protocol, origin checks, credential ownership, installation, version pinning, and failure behavior.

Exit gate:

- A repeatable demo works after restarting Chrome and the local bridge.
- No raw credential is exposed to extension code, storage, console output, or repository files.
- If the gate fails, stop. Do not substitute scraped ChatGPT cookies or undocumented endpoints.

### M1 — Extension shell

Deliverables:

- Create the Manifest V3 project and canonical package scripts.
- Configure the global side panel and toolbar toggle.
- Implement typed side-panel/service-worker messaging.
- Build the responsive application shell and authentication state machine.
- Add local preferences and clear-data behavior.

Exit gate:

- The unpacked extension installs without manifest errors.
- Clicking the toolbar action toggles the side panel.
- Side panel and service-worker consoles contain no uncaught errors.

### M2 — Chat vertical slice

Deliverables:

- Connect account state and logout to the UI.
- Stream chat events through the bridge.
- Add safe Markdown rendering, stop, retry, and new chat.
- Persist only the minimum state needed to restore the active local conversation.
- Handle bridge unavailable, auth expired, request failed, canceled, and reconnecting states.

Exit gate:

- A user can authenticate, exchange multiple messages, stop a turn, close/reopen the panel, and sign out.
- Retrying a failed message cannot duplicate an already executed action.

### M3 — Current-page attachment

Deliverables:

- Add an explicit attachment button and preview chip/card.
- Inject a bounded extractor with `activeTab` and `scripting`.
- Extract title, URL, selected text, and normalized readable body text.
- Exclude form values, password fields, hidden inputs, extension pages, and protected browser pages.
- Enforce size limits and disclose truncation.

Exit gate:

- Page data is never captured before a user gesture.
- Removing the attachment prevents its content from entering the outgoing request.
- Unsupported pages produce a useful, recoverable message.

### M4 — Allowlisted tab tools

Deliverables:

- Add runtime schemas for `tabs.list`, `tabs.activate`, `tabs.open`, `tabs.reload`, `tabs.group`, `tabs.ungroup`, and `tabs.close`.
- Let `tabs.group` create a titled, optionally colored/collapsed group from validated unpinned tab IDs in one window.
- Let `tabs.ungroup` remove groups from validated tab IDs without closing their tabs.
- Validate tab IDs and allow only `http`/`https` destinations for model-proposed opens.
- Show requested, awaiting approval, rejected, running, succeeded, and failed states.
- In Ask every time, require explicit confirmation for `tabs.close` with the target title and origin. In Full access, execute it directly and record the skipped-approval target in activity.
- Add idempotency keys so reconnect/retry cannot repeat an action.

Exit gate:

- Each tool succeeds in a real Chrome profile and fails closed for malformed or stale input.
- No unlisted Chrome API action can be reached from a model response.

### M5 — Hardening and private-beta handoff

Deliverables:

- Run type-check, lint, unit, component, integration, and browser tests.
- Inspect the side panel, service worker, content extraction, permissions, CSP, storage, and bridge connection in Chrome DevTools.
- Search source, built bundles, extension storage, and logs for credentials.
- Document installation, development, build, test, unpacked-loading, login, logout, and troubleshooting steps in `README.md`.
- Have the browser-validation specialist independently exercise the primary flow.

Exit gate:

- All P0 acceptance criteria in `PRD.md` pass.
- No critical/high security defect or known credential leak remains.
- The permission list matches the table above and each permission has a concrete justification.
- The private-beta installation is repeatable from a clean test profile.

### M6 — Supervised page-control foundation

Deliverables:

- Add strict `page.*` schemas, exact-origin policy, task state in `chrome.storage.session`, idempotency, activity history, cancellation, and generic confirmations.
- Build a stable packaged `page-executor.js`; never accept scripts, selectors, XPath, coordinates, or unsafe URLs from the model.
- Redeclare the exact dynamic tool set when a Codex thread resumes.

Exit gate:

- Unauthorized, malformed, stale, cross-tab, cross-origin, duplicate, or canceled actions fail closed before DOM execution.

### M7 — Navigation controls

Deliverables:

- Implement bounded semantic inspection, ordinary same-origin link clicking, scrolling, history navigation, and load waits.
- Use no more than 80 elements per snapshot, 30-second references, eight-second waits, and the user-selected 5–100 browser-action budget per request (default 40).

Exit gate:

- Inspect, click, scroll, back/forward, stale-reference refusal, Stop, and permission revocation pass in Chrome.

### M8 — Fields and permission-mode-governed forms

Deliverables:

- Implement non-sensitive fill, select, check, allowlisted keypress, form preview, and permission-mode-governed submission.
- Refuse password, OTP, payment, private-key, CAPTCHA, purchase, and financial workflows in code-side policy.

Exit gate:

- Representative search/contact/scheduling forms work, sensitive values never enter tool output, Ask every time requires a fresh exact confirmation, and Full access records the skipped-approval preview.

## 9. Intended project layout

Create only paths needed by implemented features:

```text
src/
  background/       service worker, message policy, tab tools
  content/          user-triggered current-page extractor
  sidepanel/        React UI and interaction state
  shared/           schemas, message types, URL/action policy
bridge/             local Codex adapter or native host, if Phase 0 selects it
tests/              integration and browser-level tests
docs/decisions/     authentication/bridge architecture decision
```

Do not create empty popup, options, remote-control, telemetry, or automation modules.

## 10. Validation matrix

| Area | Minimum validation |
| --- | --- |
| Install | Load unpacked build in a clean Chrome profile without errors. |
| Side panel | Toggle from toolbar; change tabs; close/reopen; test 320–600 px widths. |
| Authentication | Success, cancel, invalid/expired state, restart, logout, bridge unavailable. |
| Chat | Stream, stop, retry, new chat, link safety, Markdown injection, reconnect. |
| Page context | Attach, preview, remove, truncate, protected page, form/password exclusion. |
| Tab tools | Success, rejection, stale ID, bad URL scheme, close behavior in both permission modes, duplicate prevention. |
| Page tools | Exact-origin grant reuse, inspect bounds, routine link/button click, consequential-button behavior in both modes, configurable task limit, scroll, history, wait timeout, stale ref, Stop. |
| Forms | Fill/select/check, controlled inputs, sensitive refusal, preview, Full access bypass visibility, Ask every time approval expiry, validation failure, submit. |
| Persistence | Browser restart, service-worker suspension, clear data, logout. |
| Accessibility | Keyboard flow, focus, labels, contrast, reduced motion, streaming announcements. |
| Security | Message-schema failures, origin rejection, CSP, bundle/log/storage credential scan. |

## 11. Coding-agent and Chrome testing workflow

The Chrome guide [Build extensions with coding agents](https://developer.chrome.com/docs/extensions/ai/build-with-ai) recommends two relevant practices for this project:

1. Give coding agents current Chrome-extension knowledge through Chrome's Modern Web Guidance and `chrome-extensions` skill pack.
2. Validate generated code in Chrome with extension-aware DevTools tooling capable of inspecting the side panel, service worker, and other extension surfaces.

For this repository:

- Treat installation of Modern Web Guidance as a development-environment setup task, not a runtime extension dependency.
- Use extension-aware Chrome testing with the extensions category enabled.
- Prefer connection to a user-approved existing Chrome profile when authentication behavior must be tested; keep a separate clean profile for install and permission tests.
- Remote debugging must be explicitly enabled by the user for each relevant Chrome session.
- Record screenshots, console errors, expected/observed behavior, Chrome version, and extension build identifier for browser-validation findings.
- Do not create `CHROMEWEBSTORE.md` merely for the private MVP. Create and maintain it when the user authorizes store-preparation work, including granular permission justifications.

## 12. Definition of done

The MVP is complete only when:

- M0 through M5 exit gates pass.
- The primary user flow works end to end in a clean Chrome profile.
- `PRD.md`, this file, `AGENTS.md`, and `README.md` agree on scope and commands.
- Authentication uses a supported Codex mechanism and exposes no reusable credential to the extension.
- Page content is attached only through an explicit user action.
- Only the seven approved tab tools and eleven approved supervised page tools exist; consequential supported actions follow the task-captured permission mode and prohibited actions remain refused.
- Remote control, external agents, arbitrary scripting/automation, connectors, telemetry, and store submission remain absent.
- The manager reviews the final diff and browser evidence and signs off the private development beta.
