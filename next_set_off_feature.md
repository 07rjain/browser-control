# Next Set of Features: Interactive Browser Control

- Status: Approved and implemented locally; Chrome validation and hardening pending
- Owner: `codex-chrome-extension-manager`
- Created: 2026-08-20
- Depends on: the Browser Control MVP defined in `PRD.md` and `MVP.md`
- Product rule: connectors are added only in the final phase of this milestone

## 1. Outcome

Extend Browser Control from a chat and tab-management assistant into a user-supervised browser assistant that can perform the basic actions people use to navigate ordinary websites.

The user should be able to ask the assistant to inspect a page, click a visible item, enter information, select an option, scroll, navigate backward or forward, and submit a form. Every action must be visible in an activity log, limited to the page and tab the user authorized, and governed by code-side safety policy.

This document describes the approved feature set after the original MVP. The user approved implementation on 2026-08-20; its requirements are incorporated into `PRD.md`, `MVP.md`, and `AGENTS.md`.

## 2. User value

The current MVP can discuss an attached page and manage tabs, but it cannot complete common browser tasks. This milestone closes that gap for ordinary, user-directed navigation.

Example requests include:

- “Click the pricing link.”
- “Open the first search result.”
- “Scroll down until you find the FAQ.”
- “Fill in my name and email.”
- “Choose Sunday at 10:00 PM.”
- “Submit this search form.”
- “Go back to the previous page.”

The assistant must never claim an action succeeded until it has inspected the resulting browser state.

## 3. Scope

### Included browser capabilities

#### Page inspection

- Read a bounded semantic snapshot of the active page after the user grants access.
- Identify visible interactive elements such as links, buttons, inputs, text areas, checkboxes, radio buttons, select controls, menus, and form submit controls.
- Return stable, short-lived element references containing useful context such as role, accessible name, text, state, and destination when safe to expose.
- Re-inspect the page after navigation or meaningful DOM changes rather than reusing stale references.

#### Clicking and item activation

- Click a visible element by a validated element reference.
- Activate links, buttons, menu items, tabs, accordions, and other ordinary interactive controls.
- Support a double-click only where the page exposes a clear double-click interaction.
- Refuse hidden, disabled, covered, detached, ambiguous, or stale targets.
- Verify the result by observing a URL, page-state, focus, or DOM change.

#### Text and form controls

- Focus an input or text area.
- Fill, replace, append to, or clear non-sensitive text fields.
- Select an option from a native select control.
- Check or uncheck checkboxes and choose radio buttons.
- Send a small allowlist of keyboard actions such as Enter, Escape, Tab, and arrow keys when required for an accessible control.
- Never read, retain, or echo password values, payment-card data, authentication codes, private keys, or browser-managed autofill contents.

#### Form submission

- Inspect the form and summarize the fields and destination before submission.
- Validate that required visible fields appear complete.
- In Ask every time mode, require explicit user confirmation immediately before any supported form submission that creates, changes, sends, books, posts, deletes, or otherwise affects external state. In the default Full access mode, execute supported submissions without another approval card while retaining hard safety refusals and activity visibility.
- Use normal page behavior such as activating the visible submit control or calling the form's standard submission path; do not bypass client-side validation.
- Verify and report the resulting success, validation error, or navigation state.

#### Scrolling and navigation

- Scroll the current viewport up or down by a bounded amount.
- Scroll to the top or bottom of the page.
- Scroll a referenced element into view.
- Scroll a referenced inner container when the page uses a scrollable panel.
- Navigate backward and forward in the task's working tab.
- Wait briefly for a page, route transition, or interactive element to become ready, with a strict timeout.
- Stop immediately when the user presses Stop or closes the active task.

#### Activity and user control

- Show a chronological activity log for every proposed and executed action.
- Display the action, target, tab, origin, status, and result without exposing sensitive field values.
- Use the states `planned`, `awaiting confirmation`, `running`, `succeeded`, `failed`, `rejected`, `canceled`, and `stale`.
- Let the user stop an active browser task at any point.
- Keep consequential confirmations specific: show exactly what will be submitted and where.
- Prevent retries, reconnects, and model repetition from executing the same action twice.

### Basic tool surface

The first implementation should expose a small typed tool namespace rather than arbitrary JavaScript:

| Tool | Purpose | Default approval |
| --- | --- | --- |
| `page.inspect` | Return a bounded semantic page and interactive-element snapshot. | Automatic on an authorized origin. |
| `page.click` | Activate one visible element by a fresh reference. | Automatic in Full access; confirmation when consequential in Ask every time. |
| `page.fill` | Set or clear a non-sensitive form field. | Automatic, visibly logged; sensitive categories refused. |
| `page.select` | Choose an option, checkbox, or radio value. | Automatic, visibly logged. |
| `page.drag` | Drag one visible referenced control onto another referenced control from the same inspection. | Automatic, visibly logged. |
| `page.keypress` | Send one allowlisted navigation key to a referenced element. | Automatic, visibly logged. |
| `page.scroll` | Scroll viewport, container, or referenced element. | Automatic. |
| `page.history` | Move backward or forward in the task's working tab. | Automatic. |
| `page.wait` | Wait for bounded navigation or element readiness. | Automatic with timeout. |
| `page.submit` | Submit a reviewed form through normal page behavior. | Automatic in Full access; explicit confirmation in Ask every time. |

Tool arguments and results must use runtime-validated schemas. Unknown tools, unknown fields, coordinate-only clicks, arbitrary selectors from model output, arbitrary scripts, and unsupported key combinations fail closed.

## 4. Safety policy

### Action levels

#### Level 1 — Observation

Inspection, waiting, and reading visible non-sensitive state may run automatically after the user has authorized the current origin.

#### Level 2 — Reversible interaction

Scrolling, ordinary clicks, opening menus, changing a local field, and navigating backward or forward may run automatically while remaining visible in the activity log. The user can stop the task at any time.

Exact-origin access is requested once and remembered until the user clears local data or revokes it in Chrome. Activity for each request is shown inline with that request and collapses into a reviewable dropdown when the turn finishes.

#### Level 3 — Consequential external action

The Settings permission level governs supported consequential actions. Full access is the default and may run them without an approval card; Ask every time pauses for a just-in-time confirmation before submission, sending data, creating an appointment, publishing content, changing an account, deleting data, or communicating with another person.

When Ask every time is selected, the confirmation must name the site, action, relevant non-secret values, and expected effect. Approval applies to one exact action only and expires if the page, tab, origin, form, or values change. Both modes retain the activity log, task action budget, Stop, stale-reference checks, exact-origin access, and Level 4 refusals. A mode change is captured when the next browser task starts and cannot alter an in-flight task.

#### Level 4 — Prohibited in this milestone

The extension must refuse:

- Purchases, money transfers, wagers, or financial transactions.
- Entering or handling passwords, one-time codes, payment-card data, government identifiers, private keys, or recovery secrets.
- CAPTCHA solving or attempts to evade anti-bot, rate-limit, access-control, or security systems.
- Download execution, browser-setting changes, extension installation, permission escalation outside the approved flow, or arbitrary code execution.
- Dragging files, dragging across frames or tabs, coordinate-only dragging, and native operating-system drag surfaces.
- Unattended automation not started in the sidebar, cross-origin crawling, or actions initiated remotely by other agents or devices. A user-started task may continue in its pinned background working tab while the user views another tab.
- Deceptive actions, impersonation, spam, mass messaging, or bulk account creation.

Additional restricted categories can be added before implementation, but protections in this section cannot be weakened without an explicit product and security review.

## 5. Permission and privacy model

- Continue using `activeTab` for action access gained from a direct user gesture where possible.
- If a multi-step task must survive navigation within an origin, request optional permission only for that exact `http` or `https` origin and explain why.
- Never silently promote optional origin access into required `<all_urls>` access. Full access controls extension approval cards; it does not bypass Chrome's initial exact-origin permission prompt.
- Display the currently controlled tab and origin in the side panel throughout an active task.
- Revoke task-scoped element references when the tab navigates, reloads, changes origin, closes, or the task ends.
- Do not collect browser history, cookies, saved passwords, autofill data, or unrelated tab contents.
- Do not place page text, typed values, or action details in production logs.
- Clear locally retained action history through the existing “Clear local data” control.

Every new Chrome permission or host-permission change requires a written justification and a clean-profile permission test before release.

## 6. Proposed architecture

```text
Codex model proposes typed page action
                |
                v
Native bridge validates tool envelope
                |
                v
Service worker policy + approval gate
                |
                v
Authorized content executor in task working tab
                |
                v
DOM action + bounded result inspection
                |
                v
Activity log and normalized tool result
```

### Semantic page snapshot

The content executor should build a compact representation from visible, user-relevant DOM and accessibility information. Interactive elements receive opaque references generated by extension code. Model output chooses among these references; it does not supply executable selectors or JavaScript.

References are scoped to the tab, frame, document, origin, and snapshot generation. They expire after navigation, meaningful DOM mutation, or a short timeout. A stale reference forces a new `page.inspect` call.

### Execution boundary

- The side panel displays progress and gathers confirmations; it does not directly modify pages.
- The service worker validates every tool request, applies origin and risk policy, enforces idempotency, and routes only allowlisted actions.
- A narrowly scoped content executor performs validated DOM operations in the authorized tab.
- The native bridge and Codex app-server transport typed tool calls but do not decide browser safety.
- No layer evaluates model-provided code, CSS selectors, XPath, URLs with unsafe schemes, or event-handler strings.

### Frames and dynamic applications

- Same-origin frames may be supported after frame identity is included in element references.
- Cross-origin iframes are unsupported until the user has granted the corresponding origin and the implementation can preserve the same policy boundary.
- Open and closed shadow DOM, canvas applications, browser-internal pages, extension pages, PDF viewers, and native browser dialogs must return honest capability errors when they cannot be safely controlled.
- DOM operations must accommodate common controlled inputs by using standards-based value changes and input/change events, followed by state verification.

## 7. Interaction lifecycle

1. The user asks for a browser task in the sidebar.
2. The extension identifies or creates the task's working tab and confirms that its origin is authorized without foregrounding it by default.
3. `page.inspect` returns a fresh semantic snapshot.
4. Codex proposes one typed action using a valid element reference.
5. The service worker validates the request and assigns its risk level.
6. If confirmation is required, the extension pauses and shows an exact preview.
7. The content executor performs the action once.
8. The extension inspects the resulting state and records the result in the activity log.
9. The loop continues until the requested outcome is verified, the user stops it, a safety rule refuses it, or a bounded step/time limit is reached.

A task must have configurable hard limits for maximum actions, elapsed time, repeated failures, and unchanged-state loops. The implemented browser-action setting applies one shared 5–100 action budget to `tabs.*` and `page.*` calls in a Codex request, defaults to 40, and is captured on the request's first executed action. Reaching a limit stops safely and asks the user how to continue.

## 8. Delivery phases

### Phase 1 — Control foundation

- Add typed page-action schemas, origin checks, idempotency keys, task cancellation, timeouts, and risk classification.
- Add the activity-log data model and side-panel UI.
- Add origin-specific permission request and revocation behavior for active tasks.
- Unit-test malformed requests, duplicate actions, stale task IDs, navigation changes, and policy decisions.

Exit gate: an unlisted, malformed, stale, cross-tab, or unauthorized action cannot reach page execution.

### Phase 2 — Inspect, click, and scroll

- Implement semantic page snapshots and short-lived element references.
- Add visible-element clicking, viewport/container scrolling, scroll-to-element, top, and bottom.
- Add backward/forward navigation and bounded waits.
- Re-inspect and verify page state after every action.

Exit gate: the assistant can reliably navigate representative static and single-page sites without coordinate-only clicks or arbitrary selectors.

### Phase 3 — Fields and forms

- Implement fill, clear, select, check, radio, and allowlisted keypress actions.
- Detect sensitive fields and prevent their values from entering model context or logs.
- Implement form previews, code-side validation, permission-mode approval handling, submission, and result verification.

Exit gate: representative search, contact, and scheduling forms work; Ask every time never submits consequential forms without a fresh explicit approval, while Full access records the skipped-approval preview in activity.

### Phase 4 — Multi-step reliability and hardening

- Add bounded autonomous step loops within the active user task.
- Handle DOM changes, stale references, new tabs, redirects, same-origin navigation, failures, and user cancellation.
- Complete accessibility, security, privacy, performance, unit, integration, and real-Chrome testing.
- Independently validate the primary flows in a clean Chrome profile.

Exit gate: actions are observable, stoppable, non-duplicating, recoverable, and honest about unsupported surfaces.

### Phase 5 — Connectors, last

Only after Phases 1–4 pass their exit gates, add purpose-built connectors for services where APIs are safer and more reliable than page automation.

Initial connector candidates may include Google Calendar, Gmail, contacts, or other user-approved services. Each connector requires:

- Official OAuth and API integration rather than scraped cookies or private endpoints.
- The minimum scopes needed for the approved feature.
- Clear account and permission state in the sidebar.
- A preview and explicit confirmation before external side effects.
- Revocation, logout, error handling, audit visibility, and connector-specific tests.
- A separate requirements and security review before implementation.

Browser automation remains available for ordinary navigation, but a supported connector should be preferred for structured actions such as creating a calendar event.

## 9. Acceptance criteria

This milestone is complete only when all of the following are true:

- A user can ask the sidebar to inspect a normal authorized page and receive an accurate list of relevant interactive controls.
- The assistant can click a named visible item and verify the resulting state.
- The assistant can scroll up, down, to the top, to the bottom, to an element, and within a referenced scroll container.
- The assistant can fill common non-sensitive fields, choose options, and correct validation errors.
- Ask every time cannot submit a consequential form without a fresh, specific user confirmation; Full access may submit supported forms directly and records the skipped-approval preview in activity.
- The user sees every action and result in a chronological activity log and can stop an active task.
- Reloads, redirects, DOM changes, and retries do not cause stale or duplicate actions.
- Unsupported pages, frames, elements, and security-sensitive requests fail with a clear explanation.
- No arbitrary model-generated JavaScript, selector, or unsafe URL reaches execution.
- Origin access is explicit, minimal, visible, and revocable.
- Automated policy and executor tests pass, and the core flows pass in a clean current-stable Chrome profile.
- Connector development begins only after the browser-control phases satisfy their exit gates.

## 10. Test matrix

| Area | Minimum coverage |
| --- | --- |
| Inspection | Visible/hidden controls, duplicate names, disabled controls, ARIA roles, DOM mutation, stale references. |
| Click | Links, buttons, menus, SPA navigation, detached/covered targets, popup/new-tab behavior. |
| Fields | Input, textarea, select, checkbox, radio, contenteditable, controlled components, sensitive-field refusal. |
| Submit | Native validation, application validation, Full access bypass visibility, Ask every time approval/rejection/expiry, duplicate prevention, success/error detection. |
| Scroll | Viewport, nested container, element target, top/bottom boundaries, lazy-loaded content, no-progress loop. |
| Navigation | Back, forward, reload interaction, redirects, origin changes, closed or switched tabs. |
| Activity | Every state, redaction, stop, retry, reconnect, sidebar reopen, clear local data. |
| Security | Message spoofing, unsafe schemes, arbitrary selector/script attempts, cross-origin frames, permission revocation, malicious page text. |
| Accessibility | Keyboard-only approvals, focus restoration, live status announcements, reduced motion, 320–600 px widths. |

## 11. Explicit non-goals until separately approved

- Remote control by Agent Bus, another agent, another device, or another user.
- Continuous or unattended browsing after the initiating user task ends.
- General-purpose scripting, DevTools Protocol exposure, or `debugger` permission.
- CAPTCHA bypass, stealth automation, fingerprint evasion, or anti-bot circumvention.
- Autonomous purchases, financial actions, password entry, authentication-code handling, or legal acceptance on the user's behalf.
- Connector implementation before the browser-control foundation is complete.
- Chrome Web Store publication or production rollout as part of this feature document.

## 12. Documentation updates required before implementation

Implementation approval has been recorded. The required documentation changes are:

1. Update `PRD.md` with these post-MVP user stories, requirements, permissions, and acceptance criteria.
2. Update `MVP.md` so it records the MVP as the foundation and identifies this work as the next approved milestone.
3. Update `AGENTS.md` to replace the current prohibition on general DOM interaction with this exact allowlisted, supervised scope.
4. Add an architecture decision record for semantic element references, content execution, permissions, and the confirmation policy.
5. Update `README.md` with setup, permissions, usage, limitations, and Chrome validation steps.
