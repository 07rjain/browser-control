# Browser Control

A Chrome side-panel extension powered by the user's ChatGPT Codex subscription through the official Codex App Server interface.

The repository contains the implemented MVP plus the approved supervised browser-control milestone: sidebar chat, managed ChatGPT sign-in, model selection, explicit current-page attachment, seven tab tools, eleven typed page tools, and message Copy/Fork actions. It does not contain remote control, unattended automation, arbitrary JavaScript/selectors, connectors, analytics, publisher API keys, or ChatGPT cookie scraping.

## Local file attachments

Attach PNG/JPEG/WebP/GIF images, text/code files, Markdown, and PDFs from the picker, by dropping files, or by pasting an image. PDFs are rendered locally with packaged PDF.js; Codex receives selected page images and available text, including images of scanned pages. No document conversion application or container runtime is required. Export Word documents and presentations to PDF before attaching them.

Limits: five files, 8 MiB per image, 20 MiB per PDF/text file, 40 MiB of source files per message, and 20 visual pages/images total. PDFs over 20 pages require a page range; PDFs over 200 pages are rejected. Prepared images are bounded to 2,048 pixels on the long edge, four megapixels, and 2 MiB each; the total prepared payload is capped at 32 MiB. Text is capped at 24,000 characters per file and 80,000 characters per message including context and labels. Previews and notices show resizing, static animation frames, and text truncation. Encrypted PDFs must be unlocked separately.

Preparation stays in sidebar memory until Send. The companion stores only prepared images/text under `~/.codex-sidebar/uploads` (30 days for sent assets; 24 hours for incomplete uploads), with bounded metadata in conversation history. Delete All Data removes this local data. Provider-side retention is unaffected. Stop cancels preparation/transfer or interrupts a submitted turn. Attachments grant no browser permissions or filesystem tools to the model.

The extension CSP adds `worker-src 'self'` for the packaged PDF parser, `img-src 'self' blob:` for local previews, and `connect-src 'self'` for packaged fonts/CMaps/decoder assets. PDF evaluation and WASM are disabled; no new Chrome permission or remote converter is introduced. Rebuild, refresh the native host, and reload the unpacked extension after updating.

Manual attachment checks: prepare and remove images/text/Markdown; preview text and scanned PDFs; choose a range from a PDF over 20 pages; reject corrupt/encrypted PDFs and unsupported Word/slides; cancel preparation and transfer; send an image-only and scanned-PDF question through the actual sidebar; verify transcript previews, retry/fork ownership, expiry, and both extension consoles. See the [implementation plan](docs/FILE_ATTACHMENTS_PLAN.md) for recorded evidence.

## Project status

The MVP and supervised browser controls are available on the Chrome Web Store. The desktop native companion is distributed separately from the public support site. Manual Chrome validation and reliability hardening on dynamic applications such as Google Calendar remain release gates for updates.

Known limitation: `page.inspect` currently returns the first 80 visible interactive controls in document order. Dense pages can place the requested control beyond that limit, so Codex may report that it cannot see or click a control that is visibly present. Active-dialog and viewport prioritization are not implemented yet.

Product scope and delivery decisions live in:

- [`PRD.md`](PRD.md) — product requirements and acceptance criteria.
- [`MVP.md`](MVP.md) — MVP boundary and implementation plan.
- [`next_set_off_feature.md`](next_set_off_feature.md) — supervised page-control requirements.
- [`docs/FILE_ATTACHMENTS_PLAN.md`](docs/FILE_ATTACHMENTS_PLAN.md) — implementation and validation plan for local text, Markdown, images, and visual PDFs.
- [`docs/decisions/0001-native-codex-bridge.md`](docs/decisions/0001-native-codex-bridge.md) — authentication and native bridge architecture.
- [`docs/decisions/0002-supervised-page-control.md`](docs/decisions/0002-supervised-page-control.md) — browser-action architecture and safety policy.
- [`store/README.md`](store/README.md) — public site source, Chrome Web Store copy, privacy disclosures, and release asset checklist.

## Architecture

```text
React side panel
      |
      | validated extension messages
      v
Manifest V3 service worker -----> Chrome tabs, permissions, storage, scripting
      |                                      |
      | native messaging                     v
      v                              isolated page executor
Local Codex companion -----> Codex App Server / ChatGPT authentication
```

- `src/sidepanel/` renders chat, local conversation history, settings, confirmations, attachments, and grouped activity.
- `src/background/` owns privileged Chrome APIs, policy enforcement, and message routing.
- `src/content/page-executor.ts` performs allowlisted DOM actions using short-lived opaque references.
- `src/shared/` contains runtime-validated protocol and tool schemas.
- `bridge/` contains the native-messaging companion and Codex App Server transport.
- `scripts/` installs and smoke-tests the desktop native host.
- `tests/` covers protocol validation, action policy, activity grouping, and page execution.

## Requirements

- Desktop Google Chrome or Brave on macOS, Linux, or Windows
- Node.js 20+
- Codex CLI `0.148.0` or a compatible release available as `codex` (on Windows, `codex.exe` or the npm `codex.cmd` shim)

## Setup

```sh
npm install
npm run build
npm run install:host
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's `dist` directory.

The manifest has a fixed public key, so the development extension ID should be:

```text
mpdfhhhjgbpdpfnkjbnboebdjokfjglf
```

If Chrome shows a different ID, native messaging will be rejected. Confirm that Chrome loaded `dist/manifest.json`, then rebuild and reload.

For a fresh Windows or Linux desktop using the Store extension, follow the
[companion installation guide](docs/INSTALL_WINDOWS_LINUX.md) instead of building
the extension locally. On Windows, run the native-host installer and smoke test
from your own normal PowerShell session, not a Codex sandbox account: host
registration is written to that user's `HKCU`. A clean Windows x64 checkout at
`5fe1987` passed the launcher tests, installer, installed-host smoke test, and
Chrome/Brave registration checks. A working sidebar reply was user-reported,
not independently captured. Linux still needs real-desktop validation; neither
platform has a public companion download yet.

## First sign-in

1. Click the extension toolbar icon to open the side panel.
2. Select **Sign in with ChatGPT**.
3. The extension opens the normal ChatGPT browser sign-in flow.
4. Finish authentication; Codex App Server receives the localhost callback.
5. Return to the side panel. It will display the email and plan information returned by Codex App Server.

The companion uses the legacy compatibility path `~/.codex-sidebar` as an isolated Codex home. Taught skills live in `~/.codex-sidebar/skills` and are offered automatically when a request matches. Settings can record a demonstration on pages Browser Control is already allowed to use; review it, then save it on this computer. The companion does not reuse the normal `~/.codex` configuration or place reusable credentials in Chrome storage. The path and native-host identifier `com.codex.sidebar` intentionally remain unchanged so existing development installations keep their authentication and extension connection.

## Commands

```sh
npm run dev             # Vite development server (UI work only)
npm run typecheck       # Strict TypeScript checks
npm run lint            # ESLint
npm test                # Unit tests
npm run test:bridge     # Signed-out host checks, tool isolation, concurrent reviewer probe
npm run test:reviewer   # Local fake-provider reviewer protocol checks; no account inference
npm run test:installed-host # Verify Chrome-style launch environment after host installation
npm run build           # Production extension in dist/
npm run install:host
npm run uninstall:host
```

After rebuilding, select **Reload** for the extension on `chrome://extensions`.

## Automated validation

Run the standard local gate before manual browser testing:

```sh
npm run typecheck
npm run lint
npm test
npm run test:bridge
npm run build
```

After installing the native host, also run:

```sh
npm run test:installed-host
```

`test:bridge` exercises a real signed-out Codex App Server/native-host exchange. It does not replace testing the installed extension in Chrome.

## Manual Chrome testing

Manual testing is required for browser-visible or browser-action changes because unit tests cannot fully reproduce Chrome permissions, native messaging, side-panel lifecycle, dynamic DOM updates, or real site behavior.

### Prepare the build

1. Run the automated validation commands above.
2. Run `npm run install:host` if the host or extension ID changed.
3. Open `chrome://extensions`, enable **Developer mode**, and load `dist/` unpacked.
4. Confirm the extension ID is `mpdfhhhjgbpdpfnkjbnboebdjokfjglf` and select **Reload** after every rebuild.
5. Open the extension service-worker inspector and keep the Console visible while testing.

Use a disposable test page or test account when an action could send, publish, delete, invite, or otherwise change external state. Do not use real secrets, payment fields, authentication codes, or private data.

### Core MVP checklist

- Open, close, and reopen the side panel from the toolbar; verify the current chat remains usable and the composer stays pinned correctly.
- Sign in with ChatGPT, return to the panel, and verify the account state. Then sign out and verify credentials are not exposed in extension storage or logs.
- Open Settings, change the model, send a message, start a new chat, and verify the selected model and thread behavior.
- Under **Models in composer**, choose visible models. Verify the composer dropdown contains only those choices, keeps at least one model enabled, and retains the selection after reopening the panel.
- Send messages in two chats, open **History**, switch between them, and verify both transcripts and their matching browser-activity dropdowns are restored after closing and reopening the side panel.
- On a completed assistant response, verify **Copy** preserves Markdown. Fork an earlier response, continue the fork, and confirm History retains an unchanged original plus an independently continued fork.
- Stream a response, press **Stop**, retry, and verify reconnecting does not duplicate a message or tool action.
- Attach a normal `http` or `https` page, inspect the preview, remove it, and verify no page content is shared before attachment.
- Click **Attach page → Detach page → Attach page**, including cancellation before capture completes. Verify no late response restores a removed attachment and no browser-control grant changes.
- Attempt attachment on `chrome://extensions` and verify the extension reports the protected-page limitation cleanly.
- Exercise tab list, activate, open, reload, group, ungroup, and close in all three permission modes. Verify Full access closes directly with an activity preview and Ask every time shows the exact confirmation. For grouping, verify the tabs share one window, pinned tabs are refused, the requested title/color are applied, and unrelated tabs are unchanged. Verify ungrouping removes group labels without closing tabs.

### Browser-action checklist

- From a clean profile, enable Full access and approve Chrome's all-sites prompt once. Verify page actions on two different normal origins run without extension site cards. Switch to Ask every time, verify the broad grant is removed, and confirm a fresh origin shows **Allow this site** plus Chrome's exact-origin prompt.
- Start a task on tab A, immediately switch to tab B before its first tool call, and verify all page activity remains on A. Continue in a second message and verify the thread still targets A.
- Pause on an exact-origin permission prompt, switch tabs, grant access, and verify the action resumes only on the tab named by the original prompt.
- Inspect and click an ordinary link, button, menu item, and SPA control. Verify the action result instead of trusting only the click event.
- Fill and clear text fields; select an option; toggle a checkbox/radio; and send an allowlisted key. Confirm sensitive inputs are refused and their values never appear in activity logs.
- Scroll up, down, top, bottom, to an element, and within a scrollable container. Verify bounded movement and honest no-progress results.
- Drag between two visible controls on the same page. Verify file, cross-frame, cross-tab, and coordinate-only drags are refused.
- Trigger a reactive re-render between inspection and action. Verify unique controls can be rebound and ambiguous or changed controls fail safely as stale.
- Open a disposable local form. Verify Full access submits directly while showing the skipped-approval destination/field preview in activity. Then select Ask every time and verify one specific confirmation, rejection makes no change, approval runs only once, and success or validation failure is reported.
- Press **Stop** during an active browser task. Verify pending work becomes canceled and does not resume after reopening the panel.
- Complete a second request and verify each request keeps its own collapsed activity dropdown in chronological order.
- Verify each tool call occupies one row as its state changes; skipped-approval previews and terminal errors remain visible. While the task runs, verify the composer border animates (static with reduced motion), then clears on completion, failure, or Stop. The completion banner disappears after 10 seconds and does not reappear after reopening the panel.

Sidebar polish validation (2026-10-16): typecheck, lint, build, bridge smoke checks, and 168 active tests pass (one existing skipped test). Chrome 155.0.8059.79 on macOS 27.0.1 loaded unpacked ID `mpdfhhhjgbpdpfnkjbnboebdjokfjglf` from branch `feat/file-attachments`, base commit `7595794` with local changes.

- **Page toggle — passed:** on `https://example.com/`, missing site access changed the button to **Cancel attachment**; clicking again cleared the pending error. After explicit approval of that origin grant, **Attach → Detach → Attach → Detach** added/removed the 905-character page preview each time. A capture attempted while the Extensions tab was active correctly reported the protected-page restriction.
- **Models — passed:** hiding GPT-6-Astra removed it from the composer menu and survived closing/reopening the sidebar. The original choices were restored after testing.
- **Actual sidebar tool path — passed:** with GPT-6.1-Sol, one specifically approved prompt was sent: `Use tabs.list exactly once, then reply "Tab check complete." Do not open, activate, reload, group, close, or otherwise change any tab. Do not use page tools or skills.` The recorded Codex call was `tools.tabs__list({})` once. One succeeded activity row appeared within the running group; the group collapsed on completion, expanded to one row on demand, and the final answer was `Tab check complete.` No page was attached to this prompt, and no additional approval card appeared for the read-only call.
- **Running/completion UI — passed:** a screenshot during the real request showed the colored composer border; the idle screenshot after completion showed it cleared. The completion notice appeared, expired automatically, and remained absent after reopening. Fake-timer tests verify the exact 10-second lifetime and remaining lifetime on reopen. Component tests also cover Stop/error cleanup, repeated capture and late-result cancellation, model persistence, in-place state updates, and separate-turn activity grouping.
- **Consoles:** the sidebar inspector before the request and service-worker inspector afterward each showed zero console messages. Sidebar DevTools Issues reported an unnamed form-field improvement and a blocked-eval issue in the shared Zod chunk; the installed Zod source confirms a caught `Function` capability probe. CSP remains restrictive. Live Stop, reduced-motion rendering, and a second newly sent Chrome request were not exercised in this check; their automated coverage and the manual checklist above remain distinct from the one successful end-to-end request.


### Dense-page regression

Google Calendar is the current representative dynamic-site test:

1. Open one Calendar tab on the target week and wait until its data has loaded.
2. Ask Codex to inspect and open a named event, then open its Edit view.
3. Record whether the event and Edit control appear in `page.inspect`, whether `truncated` is true, and the number of stale retries.
4. Verify the extension does not silently switch to another Calendar tab.
5. Do not save or send an invitation unless that exact consequential action was intentionally approved for the test.

Inspection prioritizes usable in-viewport controls ahead of off-screen controls and omits controls currently covered by a modal. If a dense page still omits the intended target after the 80-control cap, record it as truncation rather than misreporting it as an unsupported click.

### Record the result

For every manual pass, record Chrome version, operating-system version, extension commit, test URL/origin, expected result, observed result, console errors, and screenshots for visual failures. Mark each scenario **pass**, **fail**, or **blocked**. A browser-visible feature is not complete solely because the automated gate passes.

## Supervised browser actions

Ask Codex to inspect or navigate a normal `http` or `https` page. Full access asks for Chrome's optional all-sites permission once when enabled; after that, supported tasks proceed across sites without extension approval cards. Ask every time uses an **Allow this site** card and Chrome's exact-origin prompt for fresh origins.

- Inspection returns at most 80 visible interactive controls using opaque references that expire after 30 seconds or any meaningful page change.
- After that grant, routine navigation (including external/new-tab links), ordinary buttons, field edits, scrolling, and drag-and-drop run automatically and remain visible in the activity log.
- Full access is the default and, after its one-time Chrome permission, runs supported actions across normal sites without site or consequential-action cards. Ask every time removes broad host access, requests exact origins as needed, and requires a fresh one-action confirmation for consequential actions. All modes keep activity previews, Stop, action limits, and hard refusals.
- **Settings → Browser actions per request** controls the shared `tabs.*` and `page.*` execution budget for one Codex request. It defaults to 40, accepts 5–100, and a change applies to the next request.
- Browser tasks snapshot a thread working tab before the request begins and retain it across follow-up requests. Opening or selecting another work tab updates that pin in the background, so changing the tab you are viewing does not pull focus back or retarget the task. An explicit user request to show or switch to a tab may foreground it.
- After a response begins browser-tool activity, **View working tab** focuses the pinned tab and its browser window. Chat-only replies do not show the control. On an authorized normal page, a pointer-transparent illuminated frame identifies that Browser Control is operating the page; it clears when the task finishes, is stopped, or moves to another tab.
- New-tab links opened by page actions are created in the background and become the thread working tab. Discarded tabs reload in place. If a working tab is closed, the task remains active, invalidates its old element references, and can open or activate a background replacement before continuing from a fresh inspection; it never falls back to the currently visible tab.
- Completed browser work shows a dismissible sidebar message that survives side-panel recreation. **Settings → Task completion sound** optionally plays a quiet, primed local tone; it is off by default and suppressed when reduced motion is requested.
- Fill/select/check tools refuse passwords, payment fields, authentication codes, private keys, and similar sensitive controls.
- Stop cancels the model turn and pending browser task without silently revoking remembered site choices.
- Activity is grouped beneath the request that caused it and collapses into a dropdown when the request completes.
- Semantic `page.drag` supports visible DOM controls from one inspection. File, cross-frame, cross-tab, coordinate-only, and native drag surfaces are unsupported.

Unsupported surfaces such as protected Chrome pages, cross-origin frames, canvas-only controls, browser dialogs, and closed shadow roots return capability errors. Connectors are intentionally deferred.

## Permissions

- `sidePanel`: primary extension UI.
- `storage`: non-secret theme, up to 30 local conversation transcripts with matching browser activity, and active-thread references.
- `activeTab` and `scripting`: explicit current-page attachment and injection of the packaged page executor.
- Optional `http`/`https` host access: never granted at installation. Full access requests normal-web all-sites access once through a sidebar user gesture; Ask every time removes it and requests only the exact current origin.
- `tabs`: list and perform the seven approved tab actions, including grouping and ungrouping without closing tabs.
- `tabGroups`: name, color, and collapse a group created from explicitly selected same-window tabs.
- `nativeMessaging`: communicate with the local Codex companion.

No host access is granted at installation. Full access can request the manifest's optional normal-web all-sites patterns from an explicit user gesture; Ask every time removes them. Cookies, history, bookmarks, downloads, `webRequest`, and debugger access are never requested.

## Troubleshooting

**Native host not found:** from any folder, run `git clone --depth 1 -b feat/desktop-companion https://github.com/07rjain/browser-control.git "$HOME/browser-control" || git -C "$HOME/browser-control" pull --ff-only && node "$HOME/browser-control/scripts/install-native-host.mjs"`. Node, Codex, and the extension can be installed in any order. Then choose **Retry connection** in the side panel.

**Codex not found or Sign in with ChatGPT does nothing on Windows:** pull this branch and run the installer again so the companion is recopied. The host looks for `codex.exe` under `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`, `%USERPROFILE%\.codex\packages\standalone\current`, and WinGet Links, and it starts an npm `codex.cmd` shim through Node instead of launching the `.cmd` file. Set `CODEX_BIN` only when Codex lives somewhere else. After ChatGPT approval, Windows may prompt for a local listener on `::1`; allow it so the sign-in callback can reach Codex on `127.0.0.1`.

**Cannot attach a page:** Chrome blocks scripting on internal pages such as `chrome://extensions`. Open a normal `http` or `https` page and click the toolbar icon again before attaching.

**Codex cannot see a visible control:** `page.inspect` may have reached its 80-control limit, the reference may have expired after a DOM update, the wrong tab may be active, or the control may be inside an unsupported frame/shadow root. Re-inspect the intended tab and check the activity result for `truncated` or `stale` before assuming clicking itself is broken.

**Reset product authentication:** sign out in the side panel. For development-only cleanup, uninstall the host registration and remove `~/.codex-sidebar` manually only after confirming no sidebar data is needed.

Authentication architecture is recorded in [ADR 0001](docs/decisions/0001-native-codex-bridge.md). Page-control architecture and policy are recorded in [ADR 0002](docs/decisions/0002-supervised-page-control.md).


### Settings layout

Settings opens as a full-width panel within the sidebar. General contains appearance and completion sound; Models contains model selection and composer visibility; Agent contains permissions, the action budget, main instructions, and Auto review; Skills contains taught procedures; Account contains sign-out and local-data controls. Prompt editors start collapsed, even when Auto review is enabled. Switching sections keeps unsaved prompt edits. Use the Close button or Escape to return to chat; arrow keys, Home, and End navigate the section tabs. The panel uses a native modal dialog so focus stays in Settings and returns when it closes. Preferences and permission behavior are unchanged.

Settings layout validation, 2026-10-16, base commit `7595794` plus local changes on `feat/file-attachments`: typecheck, lint, all **212 active tests** (one existing Windows skip), native bridge checks, and build passed. The focused sidebar suite preserves the model, reviewer, main-prompt, and activity tests through the new navigation and adds one navigation/draft-retention/dismissal scenario. Final self-review compared these changes against `/tmp/browser-control-before-settings-layout`, preserving the prior feature work. No manifest, permission, or native-host change was needed.

Manual visual/interaction checks used the built side panel in the connected **Brave** browser at a synthetic localhost preview, `http://127.0.0.1:9863/after/sidepanel.html`. Account, skills, preferences, and bridge replies were fixtures; there was no real account, live inference, grant, submission, sign-out, or deletion. Checked all five sections, collapsed reviewer controls with Auto review enabled, unsaved main-prompt retention across Models → Agent, arrow navigation, native focus containment, Escape, and focus return to the Settings button. The first focus-return check failed; explicit restoration corrected it, and the browser recheck passed. Light/dark themes and actual CSS widths of 320 and 560 pixels showed no horizontal overflow; expanded reviewer controls and Account actions fit within the scrollable content. The preview console had no application errors. Temporary viewport changes were reset after testing.

The actual unpacked **Chrome extension UI check remains blocked** because the native computer-control pipe could not start. The preview validates rendering and native-dialog interaction, not Chrome side-panel/native-message integration. Remaining manual checklist: reload `dist/`, confirm the fixed extension ID, open/close Settings and check focus, switch all sections, save/reopen a preference or prompt, inspect both extension consoles, and confirm the underlying task/Stop flow still works. Any live send, permission grant, or destructive data test requires the specific confirmation described in `AGENTS.md`.

### Main chat system prompt

Open **Settings → Agent → Main chat system prompt** to inspect or edit the main assistant's full default prompt. Choose **Save main prompt**, then start a new chat; **Reset main prompt to default** restores the built-in text. Saved changes apply to new chats and forks. Existing chats keep their original prompt, including after restarting the companion. This is separate from the reviewer prompt under Auto review settings.

The prompt accepts up to 12,000 characters and preserves whitespace and line breaks. Empty, whitespace-only, oversized, or null-containing prompts are rejected. Editing is disabled while the current chat runs. A failed save retains the draft. Settings requires the updated companion; saving is acknowledged by the host rather than silently ignored by an older version.

The prompt is stored locally at `~/.codex-sidebar/chat-settings.json`, with owner-only file permissions, and is removed by **Delete all local data**. It is sent to the existing model provider as chat instructions when a new conversation runs. Saving alone starts no inference. Browser permission checks and tool restrictions remain enforced by code. No new Chrome permission, model provider, or API key is needed.

`npm run test:bridge` exercises the real companion and Codex app-server against a synthetic localhost Responses provider. It verifies exact prompt bytes for new chats and forks, preservation of existing-chat instructions, persistence across host restart, invalid-input rejection, reset, and local-data deletion. Codex CLI 0.162.1 accepts `baseInstructions` on thread creation/resume/fork, but the local executable probe confirmed that resuming an already loaded thread does not replace its base prompt; the new-chat behavior avoids claiming an update that did not happen. See the [official app-server lifecycle documentation](https://learn.chatgpt.com/docs/app-server).

Manual checklist: reload `dist/` after rebuilding and refreshing the companion, expand the main prompt setting, edit/save/reopen it, reject a whitespace-only edit, reset it, verify reviewer settings retain their values, and inspect the sidebar and worker consoles. Live inference requires one fresh approved synthetic send under the repository's manual testing protocol.

Main prompt validation, 2026-10-16: typecheck, lint, all **211 active tests** (one existing Windows skip), bridge probes, build, and installed-host smoke test passed. The companion and both new runtime files match their source hashes. The localhost probe completed six synthetic turns through the real native host and Codex, covering new chats, existing-chat preservation before and after restart, forks, and reset; invalid writes and local-data deletion also passed. The original default prompt was preserved exactly. Manual Chrome validation is **blocked**: the computer-control native pipe failed to start, and discovery exposed no Chrome UI surface. No Chrome UI scenario is marked passed for this change; the checklist above remains outstanding. No live model send was performed.

### Auto review

Settings → Agent → Agent permission → **Auto review** enables an independent reviewer, defaulting to `gpt-6-luna`. It uses the existing Codex sign-in and additional model usage, while the composer keeps its own selected model. CLI **0.162.1** and the updated companion are required; an unavailable model, slow response, invalid result, exhausted budget or incomplete evidence falls back to your normal confirmation card. Open **Auto review settings** to select any model in your Codex model list, regardless of composer model visibility. An unavailable model or unsupported structured result asks you; the companion never silently substitutes another model.

The **Reviewer system prompt** editor shows the exact saved system prompt used for review. Edit it and choose **Save prompt**, or **Reset prompt to default** to restore the built-in prompt while keeping the chosen model. The limit is 6,000 characters, in addition to the 8,000-character action-evidence budget. Empty/invalid prompts cannot replace the saved prompt. **Required response rules** shows the fixed structured-response instructions. Code-enforced permissions, hard refusals, eligibility, exact-state checks and human escalation limits remain in force. Model/prompt changes apply to the next task; switching permission modes preserves these preferences. Unsaved prompt edits remain in the editor when changing models.

Routine actions already allowed by Ask every time continue directly. The selected reviewer can review complete same-origin search forms, bounded display preferences, explicitly private drafts, and reversible private notes whose values match your actual request. Generic forms and Save controls often require your review because the page cannot establish their full effects. Deletion, sending, publication, invitations, bookings, security changes, tab closing, site grants and unknown destinations remain user decisions; existing hard blocks still apply.

Auto review stores the legacy permission mode as Ask plus an additive versioned configuration. Turning it on removes the broad Full access grant. Permission mode, reviewer configuration and review budget are captured for the task. Reviews have a 10-second deadline, no retries, and a maximum of 20 per request bounded by the configured action limit. Stop cancels review; changed forms/origins/permissions invalidate approval. Interrupted reviews recover to a human card, and uncertain executions are never replayed automatically.

Review evidence contains your bounded request and the proposed action/target/form, sent to the same authenticated model provider. Reviewer threads are ephemeral and have no executable tools. The default Luna model uses low reasoning effort; other selected models use their native default. Configured prompt text is deliberately saved in local Settings and captured with the model for each task; action evidence is not appended to the saved prompt. Activity keeps one row with reviewer/user attribution and generic explanations, without saving model reasoning or raw reviewer responses. Bounded request text and pending form previews remain in Chrome session storage for recovery; request text is cleared when the task ends. No Chrome permission or external service was added.

For a disposable end-to-end check, run `node scripts/auto-review-fixture.mjs`, open `http://127.0.0.1:9845/`, choose Auto review and a new chat, then authorize one exact test send:

> Inspect the current local test page, fill Search terms with blue otter, then submit its Search form. Use only page tools on this page. Do not open other sites or tabs.

Grant only this local origin. Expected: inspect/fill followed by one reviewing → running → succeeded submission row; the page shows “Search complete: blue otter”. Record the selected model, actual tools/arguments, review decision and latency, page result, Stop/recovery checks and both extension consoles. Live sends and submissions follow AGENTS.md's fresh confirmation protocol.


Auto review verification, 2026-10-16 (macOS, branch `feat/file-attachments`, base commit `7595794` plus uncommitted work): `npm run typecheck`, `npm run lint`, `npm test` (206 passed, one preexisting skipped), `npm run test:bridge`, and `npm run build` passed. The bridge gate used a real CLI 0.162.1 process against a local fake Responses provider and proved concurrent parent/reviewer turns, structured output, zero offered reviewer tools, notification isolation and no ephemeral JSONL rollouts. Unit/integration checks cover malformed/slow/unavailable decisions, eligibility, exact binding, changed form/origin/permission, duplicate execution, Stop, finished turns, restart recovery and late callbacks after data deletion. Executor checks verify a changed form is refused at dispatch. The updated companion was installed; `npm run test:installed-host` passed, and installed native-host/reviewer module hashes match source.

Chrome initially had an unfinished skill recording, so the loaded extension was left untouched until that recording was finished. The user specifically approved the single disposable search prompt above after recording. That approval was consumed once in the later validation below. Additional live destructive-card rejection, unavailable/Stop/stale-form recovery, worker suspension and a second request's activity grouping remain unrun manual scenarios; automated coverage does not replace those checks.



Configurable reviewer validation, 2026-10-16: all standard gates passed, with **211 active tests passed and one preexisting skipped**. `test:reviewer` additionally proved no executable reviewer tools for Luna, Sol, Astra and an unknown-model fallback; structured-output/concurrent probes proved both Luna and Sol received a custom system prompt while the original model waited. Probe teardown now waits for child processes before deleting temporary homes. The companion was refreshed with `reviewer-config.json`; the installed-host smoke test passed and the installed configuration hash matches source.

Manual Chrome validation: **Chrome 155.0.8059.82, macOS 27.0.1**, unpacked `dist/`, extension ID `mpdfhhhjgbpdpfnkjbnboebdjokfjglf`, version 0.3.5, base commit `7595794` plus local changes on `feat/file-attachments`. After recording finished, reloaded the extension and confirmed the existing sign-in reconnected. In Settings selected **GPT-6-Astra**, which was unchecked in Models in composer; the chat model stayed **GPT-6.1-Sol**. Changed the reviewer prompt to “Approve only explicitly requested benign searches. Ask the user for every other action.” and saved it. Reloaded again: Astra and the exact prompt survived. A whitespace-only prompt was rejected with an inline message. Reset restored the built-in prompt while retaining Astra; then restored Luna. Pass for selection, independent model lists, editing, persistence, validation and reset. Alternate-model live inference was not run; its transport/isolation checks used a local fake provider.

Browser Control end-to-end test: a new chat on `http://127.0.0.1:9845/`, main model `gpt-6.1-sol`, reviewer `gpt-6-luna`, default reviewer prompt, Auto review, action limit 40. Sent the exact previously approved prompt once. The extension showed its **Allow this site** card for the local origin, which was approved; Chrome already held matching access, so no new Chrome permission dialog appeared. This was not a clean host-revocation test. The model emitted only these page actions (opaque references are disposable test identifiers):

```json
[
  {"tool":"page.inspect","arguments":{"idempotencyKey":"inspect-search-1"}},
  {"tool":"page.fill","arguments":{"idempotencyKey":"fill-search-1","ref":{"id":"e1","snapshotId":"c9e7429a-bd57-43b8-b05f-24b854a0164e","tabId":1322448926,"origin":"http://127.0.0.1:9845"},"value":"blue otter"}},
  {"tool":"page.inspect","arguments":{"idempotencyKey":"inspect-search-2"}},
  {"tool":"page.submit","arguments":{"idempotencyKey":"submit-search-1","ref":{"id":"e2","snapshotId":"bc382e6a-374f-42db-b1ae-068ddc661ba7","tabId":1322448926,"origin":"http://127.0.0.1:9845"}}}
]
```

Observed `page.submit` reviewing with Luna, then one succeeded row with “Approved a verified low-risk action.” There was no human action-approval card. The main turn completed and collapsed one four-action group, expandable with the same four rows. The assistant said “Filled Search terms with ‘blue otter’ and submitted the Search form.” Direct Chrome inspection independently verified `http://127.0.0.1:9845/search?q=blue+otter` and “Search complete: blue otter”. The parent's submission wrapper took about 6.1 seconds including review, browser execution and response handling; isolated inference latency was not separately measured. Task completion notice subsequently disappeared. Pass for this benign live approval and model access; no repeated send was made.

Both service-worker and sidebar DevTools consoles showed **0 messages** after the test. The sidebar Issues panel retained the existing blocked `eval`/Function capability-probe issue and missing id/name form-field improvement; CSP was not relaxed. Inspectors were closed, and the disposable result page was left visible with default reviewer settings restored. Remaining manual cases are listed above.
