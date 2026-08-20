# Codex Sidebar

A private-development Chrome side-panel extension powered by the user's ChatGPT Codex subscription through the official Codex App Server interface.

The repository contains the private-development MVP plus the approved supervised browser-control milestone: sidebar chat, managed ChatGPT sign-in, explicit current-page attachment, five tab tools, and ten typed page tools. It does not contain remote control, unattended automation, arbitrary JavaScript/selectors, connectors, analytics, or ChatGPT cookie scraping.

## Requirements

- macOS and current stable Google Chrome
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
fodoakcimglhplkoohggjdggdffhkdam
```

If Chrome shows a different ID, native messaging will be rejected. Confirm that Chrome loaded `dist/manifest.json`, then rebuild and reload.

## First sign-in

1. Click the extension toolbar icon to open the side panel.
2. Select **Sign in with ChatGPT**.
3. The extension opens the normal ChatGPT browser sign-in flow.
4. Finish authentication; Codex App Server receives the localhost callback.
5. Return to the side panel. It will display the email and plan information returned by Codex App Server.

The companion uses `~/.codex-sidebar` as an isolated Codex home. It does not reuse the normal `~/.codex` configuration or place reusable credentials in Chrome storage.

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

## Supervised browser actions

Ask Codex to inspect or navigate the active `http` or `https` page. The first page action for a site pauses until you select **Allow this site** in the sidebar and approve Chrome's exact-origin permission prompt.

- Inspection returns at most 80 visible interactive controls using opaque references that expire after 30 seconds or any meaningful page change.
- Ordinary same-origin links may run automatically. Buttons, external/new-tab links, Enter, tab closing, and form submission require confirmation.
- Fill/select/check tools refuse passwords, payment fields, authentication codes, private keys, and similar sensitive controls.
- Stop cancels the model turn and pending browser task. Task-scoped site access is revoked when that turn ends.
- The activity log records requested, permission/confirmation, running, success, failure, rejection, cancellation, and stale-reference states.

Unsupported surfaces such as protected Chrome pages, cross-origin frames, canvas-only controls, browser dialogs, and closed shadow roots return capability errors. Connectors are intentionally deferred.

## Permissions

- `sidePanel`: primary extension UI.
- `storage`: non-secret theme, transcript, and active-thread reference.
- `activeTab` and `scripting`: explicit current-page attachment and injection of the packaged page executor.
- Optional `http`/`https` host access: requested through a sidebar user gesture for the exact current origin; required for supervised page actions and never granted automatically.
- `tabs`: list and perform the five approved tab actions.
- `nativeMessaging`: communicate with the local Codex companion.

No broad host permission, cookies, history, bookmarks, downloads, `webRequest`, or debugger access is requested.

## Troubleshooting

**Native host not found:** run `npm run install:host:mac`, confirm the extension ID above, then fully reload the extension.

**Codex not found:** make sure `which codex` succeeds before running the host installer; the installer records its absolute path.

**Cannot attach a page:** Chrome blocks scripting on internal pages such as `chrome://extensions`. Open a normal `http` or `https` page and click the toolbar icon again before attaching.

**Reset product authentication:** sign out in the side panel. For development-only cleanup, uninstall the host registration and remove `~/.codex-sidebar` manually only after confirming no sidebar data is needed.

Authentication architecture is recorded in [ADR 0001](docs/decisions/0001-native-codex-bridge.md). Page-control architecture and policy are recorded in [ADR 0002](docs/decisions/0002-supervised-page-control.md).
