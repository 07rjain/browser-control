# Product Requirements Document: Browser Control MVP

- Status: MVP implemented locally; supervised browser-control milestone approved and implemented, Chrome validation pending
- Owner: `codex-chrome-extension-manager`
- Last updated: 2026-08-21
- Target platform: Chromium browsers supporting Manifest V3 and `chrome.sidePanel`

## 1. Executive summary

### Product vision

Give Chromium users a persistent Codex-powered assistant beside the page they are viewing, with an explicit, safe path for sharing browser context and performing a small set of local tab actions.

### Core problem

Using an AI assistant while browsing usually requires switching applications, manually copying page context, and separately manipulating tabs. Users need a lightweight assistant that stays beside their browsing session and can understand explicitly shared context without surrendering control of the browser.

### MVP solution

Build a Manifest V3 extension whose toolbar action toggles a chat UI in Chrome's side panel. A user authenticates with their ChatGPT account for Codex subscription access, starts or resumes a local chat, optionally attaches current-page context, and can ask the assistant to perform a tightly limited set of tab actions governed by a visible, user-selected permission mode.

The original MVP is a local, user-driven chat, attachment, and tab-tool experience. The approved next milestone adds a narrow set of supervised page controls while remote agents, remote control, arbitrary scripting, remotely initiated automation, and general-purpose computer control remain deferred. A user-started task may continue in its own background working tab while the user views another tab.

### Target users

- Primary: existing Codex/ChatGPT users who want assistance while researching or working in Chromium.
- Secondary: technical early adopters willing to install a development build and, if required, a local Codex companion during MVP validation.

### MVP success metrics

- At least 90% of test users can install, authenticate, open the side panel, and send a first message without developer help.
- At least 95% of valid chat submissions either stream a response or show a useful recoverable error.
- A user can open the side panel and begin typing within two seconds on the reference development machine, excluding first-time authentication.
- Every use of page content is initiated or enabled by the user and visibly indicated in the composer.
- No known critical security defect, credential exposure, silent destructive action, or undeclared data transmission remains at MVP sign-off.

## 2. Product goals and non-goals

### Goals

1. Deliver a persistent, polished sidebar chat experience in Chromium.
2. Use the user's Codex entitlement through an officially supported ChatGPT sign-in path.
3. Preserve conversation continuity while the user changes tabs.
4. Let users explicitly attach useful current-page context.
5. Provide a narrow, auditable set of local tab tools that demonstrate “chat with your browser.”
6. Establish secure extension messaging, permissions, and confirmation patterns that future capabilities can build on.

### Non-goals for the MVP

- Remote control from other agents, devices, or users.
- Agent Bus integration in the shipped extension.
- Remotely initiated or unattended browser automation that was not started in the sidebar.
- Arbitrary clicking, typing, form submission, purchasing, or account changes.
- General DOM automation or arbitrary JavaScript execution.
- Full-page crawling, cross-site browsing history analysis, or continuous capture of every tab.
- Multi-browser parity beyond Chromium.
- Chrome Web Store publication, billing, team administration, telemetry, or analytics.
- Recreating every feature of an existing OpenAI/Codex extension.

## 3. Product principles

- MVP first: do not add a post-MVP feature unless it is necessary for a must-have acceptance criterion.
- User control: browser context and actions are explicit, visible, and revocable.
- Least privilege: request the smallest permissions that satisfy the approved flow.
- Local by default: keep chat metadata and settings local unless the model service requires transmission.
- Honest capability: never imply the assistant can see a page, tab, or account state that has not been supplied.
- Safe failure: authentication, model, permission, and browser-tool failures must leave the browser usable and explain recovery.

## 4. MVP requirements

Priority meanings: P0 is required for MVP sign-off; P1 is desirable only after every P0 requirement passes.

### Epic A — Side-panel shell (P0)

#### User stories

- As a user, I can click the extension toolbar icon to open or focus the assistant beside my current page.
- As a user, I can move among tabs without losing the current conversation.
- As a user, I can close and reopen the panel without losing completed messages from the current local session.

#### Acceptance criteria

- The extension uses Manifest V3 and declares a global `side_panel.default_path`.
- The manifest declares the `sidePanel` permission.
- The toolbar action is configured with `openPanelOnActionClick: true`.
- The UI has signed-out, authenticating, ready, streaming, canceled, offline, and error states.
- The panel remains usable at widths from 320 px through 600 px and supports keyboard-only navigation.
- A visible “New chat” action clears the active transcript only after confirmation when unsent or active work would be lost.

Chrome documents that the Side Panel API is available to Manifest V3 extensions in Chrome 114+ and that the toolbar action can open the panel through `setPanelBehavior`. See [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).

### Epic B — Codex authentication and session (P0)

#### User stories

- As an eligible user, I can choose “Sign in with ChatGPT” and complete authentication in a browser flow.
- As a user, I can see whether I am signed in and can sign out.
- As a user, I am not asked to paste a secret API key into the extension.

#### Acceptance criteria

- Phase 0 proves the complete sign-in, token/session refresh, account-status, sign-out, and relaunch flow before chat UI implementation proceeds.
- The extension never reads cookies from `chatgpt.com`, scrapes an existing ChatGPT session, or stores raw credentials in bundled code, page storage, or logs.
- Authentication uses an officially documented Codex mechanism. The development MVP uses a native-messaging companion around Codex app-server; Codex owns credentials and the companion exposes only a narrow authenticated protocol to the extension.
- The extension displays the authenticated account state returned by the supported Codex interface without claiming unsupported account attributes.
- Failed, canceled, or expired login returns the user to a retryable signed-out state.
- Sign-out clears local extension session metadata and invokes the supported Codex logout path.

Official OpenAI documentation says Codex supports ChatGPT sign-in for subscription access and API-key sign-in for usage-based access on documented Codex surfaces. It also documents a browser login flow in Codex app-server. It does not establish a standalone third-party Chrome-extension OAuth flow. See [OpenAI authentication](https://learn.chatgpt.com/docs/auth#openai-authentication) and [Codex app-server login](https://learn.chatgpt.com/docs/app-server#3-log-in-with-chatgpt-browser-flow).

#### Authentication feasibility gate

Before feature implementation, produce a small proof that answers:

1. Can the extension communicate with a locally running Codex app-server through an approved local bridge?
2. Can the bridge initiate ChatGPT login, survive browser/extension restarts, report account state, and log out?
3. Can chat turns be streamed without exposing reusable credentials to the extension?
4. What installation step is required for the local companion or native-messaging host?
5. Is the selected app-server interface sufficiently stable for an MVP, or must the MVP temporarily use an explicitly user-approved API-key development mode?

If this gate fails, stop and request a product decision. Do not improvise authentication by reusing private cookies or undocumented endpoints.

### Epic C — Streaming chat (P0)

#### User stories

- As a signed-in user, I can send a text message and see the response stream into the sidebar.
- As a user, I can stop an in-progress response.
- As a user, I can retry a failed message and start a new conversation.

#### Acceptance criteria

- Empty or whitespace-only messages cannot be submitted.
- The composer remains responsive while a turn streams.
- User and assistant messages are visually distinct and rendered safely without executable HTML.
- Markdown supports, at minimum, paragraphs, lists, links, inline code, and fenced code blocks.
- External links clearly indicate their destination and open in a new tab only after user activation.
- Stop cancels the active turn through the bridge and leaves the transcript in a valid state.
- Retry never duplicates browser actions from the failed turn.
- Conversations have locally stored IDs and titles; only the active conversation must be supported for the first vertical slice.

### Epic D — Explicit current-page context (P0)

#### User stories

- As a user, I can attach the current tab's title, URL, selected text, and readable page text to a message.
- As a user, I can inspect and remove the attachment before sending.
- As a user, I can understand when a page cannot be read.

#### Acceptance criteria

- Page content is captured only after an explicit user gesture such as “Attach page.”
- Use `activeTab` plus `scripting` for temporary current-page access instead of broad `<all_urls>` access in the MVP.
- The composer shows the page origin, included content types, and approximate size before submission.
- Extraction excludes password fields, form values, hidden inputs, browser-internal pages, and extension pages.
- Content is size-limited and normalized before it reaches the model; truncation is disclosed.
- Removing an attachment guarantees that its content is not included in the outgoing turn.
- Unsupported or protected pages return a specific, nonfatal explanation.

Chrome documents `activeTab` as temporary access granted after a user gesture and as an alternative to broad host permissions. See [Chrome activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

### Epic E — Local tab tools (P0, narrow scope)

#### User stories

- As a user, I can ask the assistant what tabs are open.
- As a user, I can ask it to select a working tab, open a URL, reload a tab, or close a tab without losing the tab I am currently viewing.
- As a user, I can explicitly ask to foreground a selected or newly opened tab when I do want to view it.
- As a user, I choose whether supported destructive tab actions require approval before they run.

#### Allowed MVP tools

- `tabs.list`: return tab ID, window ID, active state, title, and URL when permission permits.
- `tabs.activate`: select an existing task working tab in the background by default; foreground only with explicit user intent.
- `tabs.open`: create a task working tab for an `http` or `https` URL in the background by default; foreground only with explicit user intent.
- `tabs.reload`: reload a specified tab.
- `tabs.group`: organize one or more existing unpinned tabs from the same window into a named, optionally colored/collapsed Chrome tab group.
- `tabs.ungroup`: remove grouping from selected tabs while keeping every tab open.
- `tabs.close`: close a specified tab directly in Full access mode or after explicit confirmation in Ask every time mode.

#### Acceptance criteria

- Tool calls use a fixed schema and runtime validation; model text cannot directly call Chrome APIs.
- The background service worker is the only extension context authorized to execute tab tools.
- Unknown tools, malformed arguments, disallowed URL schemes, and stale tab IDs fail closed.
- `tabs.close` presents a confirmation containing the target tab title and origin in Ask every time mode; Full access mode may execute it directly while recording it in activity.
- The UI records requested, approved/rejected, succeeded/failed status for every action.
- Retrying or reconnecting a turn cannot execute the same action twice.
- No MVP tool clicks page elements, types text, submits a form, downloads a file, changes browser settings, or accesses history/bookmarks.

Chrome documents that `chrome.tabs` can create, modify, and rearrange tabs, while the `tabs` permission exposes sensitive properties such as URL and title. See [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs).

### Epic F — Local persistence and settings (P0)

#### Requirements

- Store non-secret preferences and the active conversation reference in `chrome.storage.local`.
- Store only the minimum transcript data needed for MVP continuity; provide “Clear local data.”
- Do not store raw authentication credentials in extension storage.
- Include settings for theme (`system`, `light`, `dark`) and whether page attachments include readable body text by default; the safe default is off.
- Load the models available to the signed-in Codex account and let the user choose a model. The selection is stored locally and applies to the next message without requiring a new conversation.
- Include a locally persisted agent-permission setting. Full access is the default and skips per-action approval cards for supported actions; Ask every time restores confirmations for consequential actions and tab closing. The selected value is captured when the next browser task begins.
- Do not add analytics or telemetry in the MVP.

### Epic G — Supervised page control (post-MVP, approved P0)

#### User stories

- As a user, I can explicitly allow browser actions on the current site once and keep that exact-origin grant until I clear local data or revoke it in Chrome.
- As a user, I can ask Codex to inspect visible controls, follow an ordinary same-origin link, scroll, navigate backward or forward, and wait for a page to load.
- As a user, I can ask Codex to fill non-sensitive fields, choose options, check controls, and submit a reviewed form.
- As a user, I can see every requested and executed action, stop the task, and choose whether consequential supported actions require approval.
- As a user, I can jump from the sidebar to the tab where the active browser task is running without changing which tab the task controls.
- As a user viewing the active working tab, I can see a non-interactive illuminated frame that makes it clear Browser Control—not me—is currently operating the page.

#### Allowed page tools

- `page.inspect`, `page.click`, `page.fill`, `page.select`, `page.check`, `page.drag`, `page.keypress`, `page.scroll`, `page.history`, `page.wait`, and `page.submit`.
- Tools use strict runtime schemas, opaque short-lived element references, bounded inputs, exact-origin matching, and idempotency keys. One Codex request shares a configurable 5–100 action budget across `tabs.*` and `page.*`; the default is 40 and the selected value is captured when the request first executes.
- The packaged isolated-world page executor is the only component that touches the DOM. Model output cannot provide JavaScript, selectors, XPath, coordinates, or unsafe URLs.

#### Permission and confirmation policy

- A page tool cannot execute until the user grants optional host access for the exact active `http` or `https` origin.
- An approved browser-control grant is remembered only for the exact origin. Attachment-only permission does not silently become browser-control consent. The user can revoke remembered grants through Clear local data or Chrome site-access controls.
- Routine navigation (including external/new-tab links), menu buttons, field edits, scrolling, and drag-and-drop may run automatically under the remembered origin grant and remain visible in activity. Downloads remain unsupported.
- Full access is the default permission mode and may automatically run supported form submission, Enter that may submit, tab closing, and recognized Save/Send/Publish/Delete/Book/Schedule actions. Ask every time requires a fresh one-action confirmation for those actions. Hard refusals apply in both modes.
- Purchases, financial transactions, passwords, authentication codes, payment data, private keys, CAPTCHAs, security bypasses, arbitrary downloads, and browser-setting changes are refused.
- In Ask every time mode, form confirmation shows the destination and non-sensitive visible values. Approval expires when the tab, origin, form, values, or element reference changes. Full access records the same preview in activity when it skips the approval card.

#### Acceptance criteria

- Inspection returns no more than 80 visible interactive elements and never returns sensitive field values.
- Element references expire after 30 seconds, navigation, origin change, or tab closure. Unrelated DOM mutations do not invalidate them; uniquely identifiable controls may be rebound after a reactive render.
- Waits time out within eight seconds and unsupported frames or protected pages return honest errors.
- The activity log records requested, awaiting permission/confirmation, running, succeeded, failed, rejected, canceled, and stale states.
- Tool activity is grouped with the request that caused it, expands while running, and collapses to a summary dropdown after completion.
- A completed browser task produces a dismissible sidebar notice. An off-by-default local completion tone can be enabled in Settings.
- Stop cancels the Codex turn, pending page action, and pending confirmation. It does not revoke an exact-origin grant the user chose to remember. Permission-mode changes apply only to the next browser task.
- Service-worker suspension, reconnect, or retry cannot silently repeat a completed action.
- The visible tab is snapshotted as the thread working tab before a turn begins. Page tools and permission resumes remain bound to that tab even when the user changes tabs, and the pin persists across follow-up turns until explicitly replaced or closed.
- After an active turn begins browser-tool activity, the sidebar offers a **View working tab** control that focuses the pinned tab and its window only after that explicit user gesture. Chat-only responses do not claim that a browser tab is being operated.
- On an authorized normal web page, the pinned working tab displays a non-interactive Browser Control frame while its browser task is active. The frame moves with the working-tab pin and is removed on completion or cancellation; protected and unapproved pages fail without requesting broader access.
- Pending permission/confirmation metadata, completion notices, and finished/canceled turn tombstones survive MV3 service-worker suspension in session storage.
- Page tools are redeclared when a Codex thread resumes; authentication remains the ADR 0001 ChatGPT browser flow.
- The Chrome validation matrix in `next_set_off_feature.md` passes before private-beta sign-off.

## 5. User experience

### Primary journey

1. User installs the extension and clicks its toolbar icon.
2. The sidebar opens to a short value statement and “Sign in with ChatGPT.”
3. The supported Codex browser-auth flow opens; the user completes login.
4. The panel shows a ready composer and a clear indicator that no page content is attached.
5. The user optionally attaches the current page, reviews the attachment, and sends a message.
6. The answer streams in the sidebar.
7. If the response proposes an allowed tab action, the activity log shows it; consequential actions require confirmation only in Ask every time mode.
8. The user changes tabs while the sidebar and conversation remain available.

### Key screens and states

- Welcome/signed out
- Authentication in progress
- Authentication error or canceled
- Empty chat
- Active chat with optional page attachment
- Streaming response with stop control
- Tool approval card and tool result
- Recoverable connection/model error
- Settings and local-data controls

### Accessibility

- Target WCAG 2.2 AA for the extension UI.
- All controls have visible focus, accessible names, and predictable keyboard order.
- Streaming updates use non-disruptive live-region announcements.
- Color is never the only indication of role, state, success, warning, or failure.
- Respect reduced-motion and system color-scheme preferences.

## 6. Technical architecture

### Components

1. **Side-panel web application** — React/TypeScript UI, transcript, attachments, approval cards, and settings.
2. **Manifest V3 service worker** — Chrome API boundary, validated message router, permissions, tab tools, and connection lifecycle.
3. **Content extraction module** — injected only after a user gesture via `activeTab`/`scripting`; returns sanitized structured text.
4. **Local Codex bridge** — owns Codex authentication and chat transport; never exposes reusable credentials to page or extension code.
5. **Codex app-server** — selected development-MVP interface for account state, login, threads, turns, streaming events, and cancellation. The stdio transport, account read, browser-login start/cancel, thread creation, turn creation, and streaming path have passed local feasibility checks; completing login inside a clean Chrome profile remains a browser-validation gate.

### Data flow

1. Side panel sends a schema-validated request to the service worker.
2. The service worker performs an allowed Chrome operation or forwards a chat request to the authenticated local bridge.
3. The bridge communicates with the supported Codex interface and streams normalized events back.
4. The service worker validates events before forwarding them to the side panel.
5. Proposed tab actions return to the UI for policy checks and, where required, user approval before execution.

### Proposed stack

- Manifest V3, minimum Chrome version 114.
- TypeScript with strict mode.
- React and Vite with a maintained Manifest V3 build integration.
- Zod or an equivalent runtime-schema library for all boundary messages.
- Vitest and Testing Library for unit/component tests.
- Playwright plus a persistent Chromium context for browser-level validation.
- A minimal local bridge/native host selected by the authentication spike; its language must be justified by the supported Codex integration and packaging needs.

### Initial permissions

- `sidePanel`: required for the primary UI surface.
- `storage`: local settings and transcript continuity.
- `activeTab`: temporary user-initiated page access.
- `scripting`: user-initiated extraction from the active page.
- `tabs`: title/URL visibility across tabs for the explicitly requested tab-listing capability.
- `nativeMessaging`: exact-origin connection to the selected local Codex companion.
- Optional `http://*/*` and `https://*/*`: declares the sites that may be requested later, but grants nothing at installation. If `activeTab` is unavailable, the user can grant only the current origin from the attachment UI and can revoke retained grants with Clear local data.

Do not request persistent required `<all_urls>`, `history`, `bookmarks`, `downloads`, `cookies`, `webRequest`, or debugger access in the MVP.

## 7. Non-functional requirements

### Security and privacy

- Enforce a restrictive Manifest V3 Content Security Policy; no remotely hosted executable code.
- Validate every message across side panel, service worker, content script, and local bridge boundaries.
- Bind a loopback bridge to localhost only, authenticate each extension session, restrict allowed origins, and reject non-extension callers; prefer native messaging if it yields a stronger boundary.
- Never scrape ChatGPT cookies or call undocumented private endpoints.
- Never send browser context until the user has attached or explicitly enabled it.
- Redact credentials and sensitive values from logs. Production builds default to minimal logging.
- Make data-clearing and logout behavior testable.

### Performance and reliability

- Side-panel shell becomes interactive within two seconds on the reference machine.
- Local tab actions acknowledge within 500 ms under normal browser conditions.
- First streamed model content target: within five seconds under normal network/service conditions; display activity immediately and do not promise an external-service SLA.
- Survive service-worker suspension, side-panel reopening, tab closure, and bridge reconnection without corrupting stored state or duplicating actions.

### Compatibility

- MVP support target: current stable Google Chrome on macOS first.
- Chromium-based browser support is best-effort until each browser's side-panel and local-bridge behavior is tested.
- Windows, Linux, ChromeOS, mobile, Firefox, and Safari packaging are post-MVP unless required to validate the chosen bridge.

## 8. Delivery plan

### Phase 0 — Feasibility spike

- Prove supported ChatGPT/Codex authentication and logout.
- Prove one streamed chat round-trip through the proposed local bridge.
- Document installation, credential ownership, protocol, and threat model.
- Decide native messaging versus authenticated loopback transport.
- Exit criterion: a repeatable demo and an architecture decision record; otherwise request a product/authentication decision.

### Phase 1 — Extension foundation

- Scaffold Manifest V3, TypeScript, React, build, lint, type-check, and test tooling.
- Implement the side panel, toolbar toggle, service-worker messaging, and local settings.
- Add signed-out/authenticating/ready/error states.

### Phase 2 — Chat vertical slice

- Integrate account state and streaming chat.
- Add safe Markdown rendering, stop, retry, new chat, and session continuity.
- Add current-page attachment with preview/removal.

### Phase 3 — Narrow browser tools and hardening

- Add the seven allowlisted tab tools and approval/result UI.
- Test permission denials, protected pages, stale tabs, reconnection, cancellation, and duplicate-action prevention.
- Review manifest permissions, bundle contents, logs, CSP, and local bridge exposure.
- Run end-to-end acceptance testing in an unpacked Chrome profile.

### Phase 4 — Supervised page control

- Add strict `page.*` schemas, code-side action policy, task state, cancellation, idempotency, activity history, and generalized confirmations.
- Add exact-origin permission prompts and the packaged persistent page executor.
- Deliver inspect/click/scroll/history/wait first, then fields and permission-mode-governed submission.
- Validate stale references, sensitive-field refusal, permission revocation, Stop, form preview expiry, and Chrome MV3 restart behavior.
- Connectors remain blocked until this phase passes and a separate connector PRD is approved.

### MVP release criterion

The MVP is ready for a private development beta when all P0 acceptance criteria pass, no critical/high security findings remain, authentication installation is documented, and the manager plus browser-validation specialist have verified the primary journey in Chrome.

Chrome Web Store submission is a separate, explicitly authorized post-MVP activity.

## 9. Testing strategy

- Unit tests: schemas, reducers/state machines, content sanitization, URL policy, permission policy, and action idempotency.
- Component tests: authentication states, composer, attachment preview, streaming transcript, approval cards, errors, and accessibility basics.
- Integration tests: side-panel/service-worker messaging, bridge reconnect, account-state changes, and tool execution policy.
- Browser tests: install unpacked extension, toolbar toggle, sign-in callback, chat stream, tab switching, page attachment, each allowed tab tool, confirmation rejection/approval, restart recovery, and logout.
- Security review: credential search in source/bundle/logs, origin enforcement, malformed-message fuzz cases, HTML/Markdown injection, protected-page handling, and permission diff.

## 10. Risks and mitigations

| Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- |
| No supported direct ChatGPT OAuth flow for a third-party extension | High | High | Make auth a Phase 0 gate; use a supported local Codex bridge; never scrape cookies/private endpoints. |
| Codex app-server interface changes | High | Medium | Isolate it behind a versioned bridge adapter, pin versions for MVP, and surface compatibility errors. |
| Native companion makes installation difficult | High | Medium | Keep packaging minimal, document it, measure onboarding success, and revisit when an official direct integration exists. |
| Broad tab/page access erodes trust | High | Medium | Use explicit attachments, `activeTab`, visible indicators, an allowlisted tool set, a clear permission-mode setting, activity previews, and Stop. |
| Prompt injection causes unsafe actions | High | High | Treat page/model content as untrusted; enforce code-side hard refusals, exact-origin grants, task budgets, and the selected confirmation mode independent of model instructions. |
| Service-worker suspension interrupts streaming | Medium | Medium | Keep streaming transport in the appropriate durable component and implement reconnect/resume semantics. |
| Scope expands into remote control/general automation | High | High | Enforce the supervised allowlist and require a PRD revision before adding remote, arbitrary, or unattended capabilities. |

## 11. Open questions

These questions do not block Phase 0 but must be answered before private beta:

1. Is requiring a locally installed Codex CLI/companion acceptable for the MVP audience?
2. Should the first private beta support ChatGPT subscription login only, or also an explicit developer API-key mode?
3. Is macOS-only acceptable for the first private beta if the local bridge is platform-specific?
4. What is the final product name and visual identity?
5. How many local conversations should be retained, and for how long?
6. Should all-tab URL/title access be requested at install time, or offered later as an optional permission after the basic chat flow works?

## 12. Post-MVP roadmap

The following require a new or revised PRD and separate security review:

- Remote access from other agents or devices.
- Agent Bus task routing.
- Connectors for Calendar, Gmail, contacts, or other services.
- Remote or unattended browser plans initiated outside the active user task.
- Cross-device conversation sync.
- Additional Chromium platforms and other browser engines.
- Store publication, telemetry, billing, organization controls, and managed deployment.

Long-term, the product may become a user-governed bridge between Codex and the browser. That direction must preserve least privilege, explicit approvals, and clear visibility into what context and actions are available.
