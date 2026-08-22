# Browser Control

A Chrome side-panel extension powered by the user's ChatGPT Codex subscription through the official Codex App Server interface.

The repository contains the implemented MVP plus the approved supervised browser-control milestone: sidebar chat, managed ChatGPT sign-in, model selection, explicit current-page attachment, seven tab tools, and eleven typed page tools. It does not contain remote control, unattended automation, arbitrary JavaScript/selectors, connectors, analytics, or ChatGPT cookie scraping.

## Project status

The MVP and supervised browser controls are implemented locally. A first public Chrome Web Store release is approved and in release preparation, with a public privacy/support site and separately distributed macOS native companion. It is not yet published. Manual Chrome validation and reliability hardening on dynamic applications such as Google Calendar remain release gates.

Known limitation: `page.inspect` currently returns the first 80 visible interactive controls in document order. Dense pages can place the requested control beyond that limit, so Codex may report that it cannot see or click a control that is visibly present. Active-dialog and viewport prioritization are not implemented yet.

Product scope and delivery decisions live in:

- [`PRD.md`](PRD.md) — product requirements and acceptance criteria.
- [`MVP.md`](MVP.md) — MVP boundary and implementation plan.
- [`next_set_off_feature.md`](next_set_off_feature.md) — supervised page-control requirements.
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
- `scripts/` installs and smoke-tests the macOS native host.
- `tests/` covers protocol validation, action policy, activity grouping, and page execution.

## Requirements

- macOS and current stable Google Chrome or Brave
- Node.js 20+
- Codex CLI `0.148.0` or a compatible release available as `codex`

## Setup

```sh
npm install
npm run build
npm run install:host:mac
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's `dist` directory.

The manifest has a fixed public key, so the development extension ID should be:

```text
mpdfhhhjgbpdpfnkjbnboebdjokfjglf
```

If Chrome shows a different ID, native messaging will be rejected. Confirm that Chrome loaded `dist/manifest.json`, then rebuild and reload.

## First sign-in

1. Click the extension toolbar icon to open the side panel.
2. Select **Sign in with ChatGPT**.
3. The extension opens the normal ChatGPT browser sign-in flow.
4. Finish authentication; Codex App Server receives the localhost callback.
5. Return to the side panel. It will display the email and plan information returned by Codex App Server.

The companion uses the legacy compatibility path `~/.codex-sidebar` as an isolated Codex home. It does not reuse the normal `~/.codex` configuration or place reusable credentials in Chrome storage. The path and native-host identifier `com.codex.sidebar` intentionally remain unchanged so existing development installations keep their authentication and extension connection.

## Commands

```sh
npm run dev             # Vite development server (UI work only)
npm run typecheck       # Strict TypeScript checks
npm run lint            # ESLint
npm test                # Unit tests
npm run test:bridge     # Real native-host/App Server signed-out smoke test
npm run test:installed-host # Verify Chrome-style launch environment after host installation
npm run build           # Production extension in dist/
npm run install:host:mac
npm run uninstall:host:mac
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
2. Run `npm run install:host:mac` if the host or extension ID changed.
3. Open `chrome://extensions`, enable **Developer mode**, and load `dist/` unpacked.
4. Confirm the extension ID is `mpdfhhhjgbpdpfnkjbnboebdjokfjglf` and select **Reload** after every rebuild.
5. Open the extension service-worker inspector and keep the Console visible while testing.

Use a disposable test page or test account when an action could send, publish, delete, invite, or otherwise change external state. Do not use real secrets, payment fields, authentication codes, or private data.

### Core MVP checklist

- Open, close, and reopen the side panel from the toolbar; verify the current chat remains usable and the composer stays pinned correctly.
- Sign in with ChatGPT, return to the panel, and verify the account state. Then sign out and verify credentials are not exposed in extension storage or logs.
- Open Settings, change the model, send a message, start a new chat, and verify the selected model and thread behavior.
- Send messages in two chats, open **History**, switch between them, and verify both transcripts and their matching browser-activity dropdowns are restored after closing and reopening the side panel.
- Stream a response, press **Stop**, retry, and verify reconnecting does not duplicate a message or tool action.
- Attach a normal `http` or `https` page, inspect the preview, remove it, and verify no page content is shared before attachment.
- Attempt attachment on `chrome://extensions` and verify the extension reports the protected-page limitation cleanly.
- Exercise tab list, activate, open, reload, group, ungroup, and close in both permission modes. Verify Full access closes directly with an activity preview and Ask every time shows the exact confirmation. For grouping, verify the tabs share one window, pinned tabs are refused, the requested title/color are applied, and unrelated tabs are unchanged. Verify ungrouping removes group labels without closing tabs.

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

### Dense-page regression

Google Calendar is the current representative dynamic-site test:

1. Open one Calendar tab on the target week and wait until its data has loaded.
2. Ask Codex to inspect and open a named event, then open its Edit view.
3. Record whether the event and Edit control appear in `page.inspect`, whether `truncated` is true, and the number of stale retries.
4. Verify the extension does not silently switch to another Calendar tab.
5. Do not save or send an invitation unless that exact consequential action was intentionally approved for the test.

Until inspection prioritization is fixed, a target after the first 80 controls is an expected known failure and must be recorded rather than misreported as an unsupported click.

### Record the result

For every manual pass, record Chrome version, macOS version, extension commit, test URL/origin, expected result, observed result, console errors, and screenshots for visual failures. Mark each scenario **pass**, **fail**, or **blocked**. A browser-visible feature is not complete solely because the automated gate passes.

## Supervised browser actions

Ask Codex to inspect or navigate a normal `http` or `https` page. Full access asks for Chrome's optional all-sites permission once when enabled; after that, supported tasks proceed across sites without extension approval cards. Ask every time uses an **Allow this site** card and Chrome's exact-origin prompt for fresh origins.

- Inspection returns at most 80 visible interactive controls using opaque references that expire after 30 seconds or any meaningful page change.
- After that grant, routine navigation (including external/new-tab links), ordinary buttons, field edits, scrolling, and drag-and-drop run automatically and remain visible in the activity log.
- Full access is the default and, after its one-time Chrome permission, runs supported actions across normal sites without site or consequential-action cards. Ask every time removes broad host access, requests exact origins as needed, and requires a fresh one-action confirmation for consequential actions. Both modes keep activity previews, Stop, action limits, and hard refusals.
- **Settings → Browser actions per request** controls the shared `tabs.*` and `page.*` execution budget for one Codex request. It defaults to 40, accepts 5–100, and a change applies to the next request.
- Browser tasks snapshot a thread working tab before the request begins and retain it across follow-up requests. Opening or selecting another work tab updates that pin in the background, so changing the tab you are viewing does not pull focus back or retarget the task. An explicit user request to show or switch to a tab may foreground it.
- After a response begins browser-tool activity, **View working tab** focuses the pinned tab and its browser window. Chat-only replies do not show the control. On an authorized normal page, a pointer-transparent illuminated frame identifies that Browser Control is operating the page; it clears when the task finishes, is stopped, or moves to another tab.
- New-tab links opened by page actions are created in the background and become the thread working tab. Closed or discarded working tabs fail closed or reload without falling back to the currently visible tab.
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

**Native host not found:** run `npm run install:host:mac`, confirm the extension ID above, then fully reload the extension.

**Codex not found:** make sure `which codex` succeeds before running the host installer; the installer records its absolute path.

**Cannot attach a page:** Chrome blocks scripting on internal pages such as `chrome://extensions`. Open a normal `http` or `https` page and click the toolbar icon again before attaching.

**Codex cannot see a visible control:** `page.inspect` may have reached its 80-control limit, the reference may have expired after a DOM update, the wrong tab may be active, or the control may be inside an unsupported frame/shadow root. Re-inspect the intended tab and check the activity result for `truncated` or `stale` before assuming clicking itself is broken.

**Reset product authentication:** sign out in the side panel. For development-only cleanup, uninstall the host registration and remove `~/.codex-sidebar` manually only after confirming no sidebar data is needed.

Authentication architecture is recorded in [ADR 0001](docs/decisions/0001-native-codex-bridge.md). Page-control architecture and policy are recorded in [ADR 0002](docs/decisions/0002-supervised-page-control.md).
