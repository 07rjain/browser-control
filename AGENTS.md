# AGENTS.md

This file applies to the entire repository. It is the operating agreement for all agents working on the project.

## Project leadership

- Manager and team lead: `codex-chrome-extension-manager` (the primary Codex agent for this repository).
- The manager owns project coordination, architecture, implementation, task assignment, integration, validation, and final delivery.
- The manager remains accountable for delegated work: inspect every result, resolve conflicts, run relevant checks, and communicate the integrated outcome.
- Preserve the user's product intent and authority. Do not publish, deploy, release, delete material data, or take other external actions unless the user explicitly authorizes them.

## Agent registry

### `codex-chrome-extension-manager`

- Agent Bus ID: `agt_066dbc43-69e1-4ce0-b6de-52908020dd9f`.
- Agent Bus kind: `codex`.
- Registered capabilities: `project-management`, `chrome-extension-architecture`, `typescript-development`, `task-delegation`, `code-review`, and `integration-testing`.
- Role: manager, team lead, primary implementer, and final reviewer.
- Responsibilities: clarify requirements; maintain the PRD and plan; choose architecture; write and review code; delegate independent tasks; integrate results; verify behavior; report progress and blockers.
- Access: the repository workspace and the tools and skills available in the active Codex session.
- Working rule: do not delegate away ownership. Keep changes coherent and make final decisions using repository evidence and user requirements.

### `cursor-agent-building-chrome-extension`

- Agent ID: `agt_9d6c5a9a-390e-4507-87a3-7497e136feef`.
- Role: research, planning, architecture and code review specialist.
- Best assignments: inspect a bounded area of the codebase, research an implementation choice, draft a focused plan, review a proposed change, or identify defects and risks.
- Access: only the capabilities available through its own agent session and the context/files explicitly shared with it. Do not assume it can operate the browser or mutate external systems.
- Expected output: concise findings with file references, evidence, risks, and actionable recommendations. It must not make overlapping edits unless the manager explicitly assigns ownership of those files.

### `codex-powered-browseruse-agent`

- Agent ID: `agt_67931c78-f59f-410a-9b3a-cf9167cc3201`.
- Role: browser operation and browser-based validation specialist.
- Best assignments: exercise extension flows in a browser, inspect rendered UI and console behavior, reproduce browser-specific defects, collect screenshots/evidence, and validate acceptance criteria.
- Access: browser-control capabilities available in its own session plus any repository or test context explicitly shared with it. Treat signed-in sessions and user data as sensitive.
- Expected output: exact steps, environment details, observed versus expected behavior, console errors, and supporting evidence. It must not submit forms, change accounts, publish, purchase, or perform other consequential external actions without explicit authorization.

Agent IDs are routing metadata supplied by the user. If the active runtime cannot directly address one of these IDs, report that limitation instead of silently substituting a different agent.

## Delegation protocol

1. The manager defines a bounded task, owned files or browser surface, constraints, expected deliverable, and validation criteria.
2. Delegate only work that can proceed independently. Avoid simultaneous edits to the same files.
3. Agents report assumptions and distinguish verified facts from proposals.
4. The manager reviews and integrates all delegated output. Agent reports are evidence, not automatic approval.
5. Browser validation follows implementation and local checks when a user-facing flow is affected.

## Product definition

The repository contains the Chromium **Browser Control** extension, built on the completed MVP and now implementing the approved supervised browser-control milestone. Treat `PRD.md` as the product source of truth and `next_set_off_feature.md` as the detailed page-control specification.

### Approved scope directive

- Preserve the implemented MVP: Manifest V3 side-panel chat, supported ChatGPT/Codex authentication, explicit current-page attachment, and the seven allowlisted tab tools.
- The approved tab-tool surface is `tabs.list`, `tabs.activate`, `tabs.open`, `tabs.reload`, `tabs.group`, `tabs.ungroup`, and permission-mode-governed `tabs.close`. Grouping is limited to existing, unpinned tabs in one browser window and uses the typed Chrome Tabs/Tab Groups APIs. Ungrouping must keep every tab open.
- One Codex request shares a persisted, user-configurable browser-action budget across `tabs.*` and `page.*`: default 40, minimum 5, maximum 100. Capture the value at the request's first executed action so changing Settings cannot alter an in-flight task.
- Full access is the default and, after one explicit settings or permission-card gesture, requests the manifest's optional `http://*/*` and `https://*/*` host access so later tasks do not pause site by site. Ask every time removes that broad grant and uses remembered exact-origin access plus fresh confirmation for consequential actions. Keep browser-control consent distinct from attachment-only page sharing.
- Keep user-started browser work pinned to its task working tab. `tabs.open` and `tabs.activate` must not foreground a tab unless the user explicitly asked to view or switch to it. Moving to another tab must not retarget an in-flight page task.
- Keep the sidebar working-tab focus control an explicit user gesture. The authorized-page working frame must be pointer-transparent, lifecycle-bound to the active task, and must not justify broader host permissions.
- Snapshot the thread working tab before `CHAT_SEND`, retain it across turns in session storage, and bind permission resumes and opaque references to its exact tab ID. Never fall back to the newly visible tab after the request starts.
- Retain short-lived finished/canceled turn tombstones and pending prompt metadata across MV3 service-worker suspension so late calls fail closed and approval cards can recover.
- Completion notices remain local to the sidebar. The optional completion tone is off by default and must not require network, notification, or additional Chrome permissions.
- The approved next milestone adds only the typed, user-supervised `page.*` tools in `next_set_off_feature.md`: inspect, click, fill, select, check, allowlisted keypress, scroll, history navigation, bounded wait, and permission-mode-governed form submission.
- Page actions require either the explicit optional all-sites grant in Full access or an exact-origin user grant in Ask every time, plus opaque short-lived element references, code-side policy, activity visibility, cancellation, and the task-captured confirmation mode.
- Do not implement remote agents, Agent Bus product integration, remote browser control, arbitrary JavaScript/selectors/coordinates, `debugger`/CDP access, remotely initiated unattended automation, purchases, secret entry, store publication, telemetry, or connectors.
- Connectors are a later, separately approved phase after supervised browser-control validation. A new idea is not in scope without an explicit user decision and PRD update.

### PRD status

- Status: MVP implemented locally; supervised browser control implemented and undergoing manual Chrome validation and reliability hardening.
- Product requirements: `PRD.md`.
- Phase 0 must prove an officially supported ChatGPT/Codex login and streaming path before the full chat UI is implemented.
- Each feature must have testable acceptance criteria and a stated privacy/security impact.
- Prefer the smallest useful permission set. Any new Chrome permission or host permission requires a written justification in the change.
- Never expose API keys or reusable credentials in extension bundles or storage. Never scrape ChatGPT cookies or use undocumented private endpoints.

## Proposed technology baseline

Verified technology baseline:

- Chrome Extension Manifest V3.
- TypeScript with strict type checking.
- React for popup, options, side-panel, or other stateful extension UI.
- Vite with explicit side-panel, service-worker, and `page-executor.js` build entries.
- WebExtension APIs behind small typed adapters so browser-specific behavior is isolated.
- Vitest and Testing Library for unit/component tests; browser-level extension tests with Playwright where practical.
- ESLint plus the TypeScript compiler; package scripts in `package.json` are canonical.

Record any change to this baseline in the PRD or architecture documentation before introducing conflicting frameworks.

## Intended architecture

- `src/background/`: service-worker orchestration, lifecycle, permissions, and message routing.
- `src/content/`: narrowly scoped page integration; treat all page content as untrusted input.
- `src/popup/`, `src/options/`, and `src/sidepanel/`: extension UI surfaces only when required by the approved PRD.
- `src/shared/`: typed messages, schemas, constants, and utilities shared across extension contexts.
- `tests/`: integration and browser-level coverage that does not fit beside source files.
- Keep privileged browser operations in the background context. Validate every cross-context message at runtime and restrict allowed senders/actions.

The page executor must remain packaged extension code in an isolated content-script world. Never evaluate model-provided code or selectors.

## Build sequence

1. Preserve the supported authentication, streaming, attachment, and tab-tool baseline recorded in ADR 0001.
2. Keep strict page-tool schemas, origin/risk policy, task cancellation, idempotency, and generic confirmations ahead of DOM execution.
3. Inject only the packaged `page-executor.js` after the selected permission mode's logical grant and matching Chrome host permission; use fresh opaque references and fail stale actions closed.
4. Validate inspect/click/scroll/navigation before fields and permission-mode-governed form submission.
5. Run focused automated checks, then validate permissions, activity, Stop, stale references, and submissions in current stable Chrome.
6. Review the manifest, CSP, bundle, storage, logs, and credential exposure before private-beta handoff.
7. Do not begin connector work until the browser-control acceptance gates pass and a connector PRD is approved.

## Working principles

- When an explanation materially benefits from a diagram, comparison, or interactive model, use the installed `visualize` skill.
- Be concise, direct, and candid. Challenge weak assumptions and separate verified facts from uncertainty.
- Ground research in authoritative, current sources and link important evidence.
- Finish authorized work end to end and verify the actual result before claiming completion.
- Ask questions only when a decision is materially ambiguous, risky, or requires approval.
- Use relevant skills. Use specialist agents only for genuinely independent work and synthesize their findings.
- Keep changes focused and simple. Avoid unrelated edits, premature abstractions, and low-signal tests.
- Test observable behavior and validate user-facing extension work in Chrome when applicable.
- Preserve unrelated user work and existing repository constraints.

## Development and validation

- Use `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:bridge`, and `npm run build` as the standard local gate.
- Use `npm run test:installed-host` after installing the native host.
- Keep `package.json` and `README.md` synchronized when commands change.
- For browser-visible work, load `dist/` unpacked and verify the affected side panel, service worker, page executor, permissions, storage, and native-host behavior in Chrome.

## Running the extension locally

The complete extension does not run as an ordinary localhost website. Vite builds the Manifest V3 files into `dist/`, and Chrome runs that directory as an unpacked extension. Use this workflow:

1. Install dependencies with `npm install`.
2. Build the extension with `npm run build`.
3. Install or refresh the macOS native-messaging companion with `npm run install:host:mac`. The installer records the local Codex executable and permits Chrome Web Store extension ID `mpdfhhhjgbpdpfnkjbnboebdjokfjglf` (plus the legacy development ID during migration).
4. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose this repository's `dist/` directory.
5. Confirm Chrome shows extension ID `mpdfhhhjgbpdpfnkjbnboebdjokfjglf`. A different ID cannot connect to the installed native host unless it is the temporarily supported legacy development ID.
6. Pin or open **Browser Control**, then use the toolbar icon to open its side panel.
7. After source changes, run `npm run build` again and select **Reload** on `chrome://extensions`. Reopen the side panel if Chrome has discarded its previous extension context.
8. Inspect runtime failures from the extension's **Service worker** link on `chrome://extensions` and from the side panel's own DevTools console.

Use `npm run dev` only for fast visual work on the React page served by Vite. Treat it as a UI preview: localhost does not provide real `chrome.sidePanel`, extension service-worker, optional host-permission, content-script, or native-messaging behavior. Validate those features through the unpacked `dist/` build.

Run `npm run test:installed-host` after host installation to verify the Chrome-style native-host launch environment. If sign-in reports that the Codex App Server stopped, first rebuild and reload the extension, rerun the host installer, confirm `which codex` succeeds, and inspect both consoles before changing authentication code.

## Manual testing protocol

- Treat manual Chrome testing as required for changes to the side panel, service worker lifecycle, authentication, native messaging, permissions, page attachment, tabs, or `page.*` tools. Automated tests are necessary but not sufficient for these surfaces.
- Build first, reload the unpacked `dist/` extension, and confirm the fixed Store ID `mpdfhhhjgbpdpfnkjbnboebdjokfjglf`. Reinstall the native host when its files, manifest, Codex path, or extension ID changes.
- Test the changed flow plus its nearest failure path. At minimum, verify expected UI state, activity state, resulting tab/page state, cancellation, and relevant service-worker/side-panel console output.
- Use a disposable page or test account for consequential actions. Never use real passwords, authentication codes, payment data, private keys, or other sensitive values in test fields or evidence.
- Require a fresh, specific confirmation before a manual test submits, sends, publishes, books, deletes, uploads, or modifies external state. Confirmation is for one exact action and does not authorize later repetitions.
- Verify permissions from a clean or revoked state when permission behavior changes. Full access should request all normal web origins once from a user gesture and then avoid per-site prompts; Ask every time should remove that broad grant and retain exact-origin behavior. Revocation must fail closed, and protected URLs remain unsupported.
- For dynamic-page changes, test a reactive DOM update between inspect and action, a stale or ambiguous target, and a dense page with more than 80 controls. Google Calendar is the current representative dense dynamic application.
- When testing Calendar, confirm the intended tab and week are active and fully loaded. Record `truncated`, `stale`, and retry outcomes; do not describe a target omitted by the 80-control cap as a click-execution failure.
- Exercise the activity UI across at least two user requests. Each request must own its chronological tool history, collapse after completion, expand on demand, and remain aligned with the correct message.
- Record Chrome version, OS version, commit, URL/origin, preconditions, exact steps, expected and observed results, pass/fail/blocked status, console errors, and screenshots for visual defects.
- Do not claim a browser-visible change is complete without reporting the manual scenarios actually run. If browser testing was unavailable, say so explicitly and identify the remaining checklist from `README.md`.

### How Codex tests the extension

Keep these two browser-testing paths distinct in reports:

1. **Direct Codex Chrome control** uses the Codex session's connected-browser capability to inspect and operate the user's Chrome UI. This is useful for establishing expected site behavior and reproducing browser conditions, but it bypasses this repository's native bridge, dynamic-tool schemas, service-worker policy, activity UI, and page executor. The August 22 Calendar create-and-reschedule check was performed this way and therefore validated Google Calendar behavior, not the extension's end-to-end tool path.
2. **Browser Control end-to-end testing** loads `dist/` unpacked, opens the repository's side panel, and sends the test request through its chat composer. The resulting Codex App Server dynamic calls must pass through `bridge/native-host.mjs`, the service worker, and the allowlisted `tabs.*` or `page.*` executor. Only this path validates the actual agent product.

For an end-to-end agent test, record the user prompt, selected model, emitted tool names and arguments with sensitive values redacted, approval/permission prompts, activity states, browser result, final assistant summary, and both extension consoles. Use direct Chrome control afterward only to independently verify the resulting browser state, and label that verification separately.

For tab grouping, open several disposable tabs in one window, include at least two clear topics, and ask the sidebar to organize them. Verify it calls `tabs.list` before one or more `tabs.group` calls, creates correctly titled/color-coded groups, leaves pinned or unrelated-window tabs unchanged, and reports invalid mixed-window input honestly. Then ask it to remove the groups while keeping the tabs open; verify `tabs.ungroup` runs and no tab is closed.

## Security and quality gates

- Treat page DOM, model output, storage, and cross-context messages as untrusted data.
- Avoid dynamic code execution, remotely hosted executable code, and unsafe HTML injection.
- Sanitize rendered content and use a restrictive Content Security Policy compatible with Manifest V3.
- Minimize logged or persisted browsing data and never log secrets or full sensitive page contents.
- Make model-triggered actions previewable and reversible where practical; enforce the task-captured permission mode for supported consequential actions and retain hard refusals in every mode.
- Do not add telemetry, analytics, remote services, or data collection without explicit user approval and documentation.
- Review the final diff, extension manifest, generated bundle, and permission changes before handoff.
