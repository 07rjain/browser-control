# Test automatic memory and incognito chat

Current scope supersedes the earlier confirmed-memory release. Automatic changes run through the answering model during an active user turn; there is no separate background learner or cloud sync. This branch is not a Chrome Web Store release.

## Load the matching build

1. Run `npm run build`.
2. Refresh the companion as the desktop user running the browser: `npm run install:host`, then `npm run test:installed-host`. This preserves sign-in, custom prompts and saved records. It does not enable memory.
3. Reload the unpacked `dist/` extension on `chrome://extensions`. Confirm ID `mpdfhhhjgbpdpfnkjbnboebdjokfjglf`. Use a disposable profile if a Store installation already owns that ID; do not remove the user's installation without preserving needed browser history/settings.
4. Open Settings → Memory, enable Use saved memory, then start a regular new chat. Existing chats retain their captured participation mode. Both extension and companion must support memory protocol version 2.

Memory remains in `~/.codex-sidebar/memory.json` on Linux/macOS and `%USERPROFILE%\.codex-sidebar\memory.json` on Windows. Browser/extension reinstallation can reload it after companion reconnection when this file is kept. A removed native-host registration needs companion reinstallation. Deleting the companion data, changing computers/OS users, or reinstalling the OS has no automatic cloud restore.

## Manual acceptance checks

Record OS/browser/Node/Codex/build versions, exact prompt/model, tool calls and approvals, both extension consoles, and pass/fail/blocked. A fresh specific confirmation is required before an agent sends each live prompt or deletes user data; use synthetic facts and disposable profiles.

1. **Direct save:** in a participating regular chat send “My test name is Rishabh.” Verify `memory.update` saves a fact without a memory approval popup/card. Settings shows it automatically. The assistant claims success only after the host confirms.
2. **Correction and deletion:** send “Change my test name to Alex,” then “Forget my test name.” Verify the original record ID is replaced, no conflicting name remains, and deletion survives restart and a duplicate/late send. Existing transcript/provider context can still contain earlier text.
3. **Recall and mode:** in a new regular chat ask for a saved synthetic preference. Confirm the bounded profile/search provides it. Disable memory and verify future access stops. A page/file instruction alone cannot save/delete memories or alter browser permissions.
4. **Inline list:** edit the existing row directly, save/cancel, add a row, prioritize, search and delete. There must be no second edit box, expiry field, Refresh button, or memory-free-chat button in Settings. Switch tabs, reopen, and regain window focus to check automatic loading. A concurrent write must show an error, load the latest state, and preserve the unsaved draft.
5. **Incognito:** start Incognito chat from the header; verify its indicator and retention explanation. Send a synthetic prompt, then leave/close/reopen. No incognito messages or activity transcript may appear in saved history, memory profile/search, or a persisted Codex rollout. Fork is disabled. Existing regular history remains. Provider retention, normal attachment retention and transient browser-action session metadata still apply. Browser permission rules are unchanged.
6. **Reinstall-style recovery:** with a synthetic enabled memory store kept outside the profile, start a clean browser profile/load the extension and reconnect the same companion. Settings and a new regular chat should read that existing store without import. Do not uninstall a user's browser to simulate this.
7. **Settings layout:** General sound toggle before theme; Models visibility toggles before selected model; Agent permission/action controls before prompt editors; Skills availability toggles before descriptions/delete; Memory enable toggle before list/guidance; Account destructive actions last. Check keyboard focus, narrow widths, light/dark themes, and console output.

## Automated coverage and limits

- `npm test` exercises the actual native host with a synthetic App Server for source/turn/client binding, immediate add/replace/delete, old-client refusal, replay across restart and incognito isolation. UI tests verify inline editing/conflict preservation, automatic updates and incognito exclusion from save payloads/history.
- `npm run test:memory` uses actual files/processes for persistence, exact evidence, direct changes, no-expiry migration, idempotency, canceled/stale/reset writes, competing writers, corrupt data, read-only failures and links. Uncertain locks fail busy; there is no automatic lock stealing.
- `npm run test:bridge` uses a real Codex CLI against a local synthetic provider. It checks dynamic memory writes, profile input, memory-off behavior, ephemeral incognito/no rollout, prompts and existing recording/image behavior without account inference.
- `npm run test:browser` uses the packaged extension in an isolated Chromium profile. Its synthetic companion fixture covers Settings/inline memory controls, automatic reload, incognito entry/exit, missing-host guidance and page attachment; it never sends a live account chat.
- CI runs standard desktop/bridge/package/Chromium checks on Linux, Windows and macOS, plus Node 20/24 memory probes and reviewer isolation matrices. Configuration alone is not a remote pass; record results from an authorized push.
- Passing fixtures do not establish real-model memory selection/personalization quality or replace native signed-in manual scenarios. Report those separately.

## Validation recorded for this update

macOS 27.0.1 ARM64, Node 20.20.1, working branch `feat/automatic-memory-incognito` based on `0863f8f`. Typecheck, lint, production build and all **257 active tests** passed; the Windows-only launcher test is skipped locally. The real-file/process memory smoke passed, including migration from legacy expiry, source/reset/cancel checks, concurrency and forgotten-text removal from change receipts. The inline-editing test fails against the previous UI, and the legacy-companion incognito test fails when its capability guard is removed; both pass with the implementation.

Real Codex protocol checks passed on **0.162.1, 0.164.0 and 0.165.0**, using synthetic localhost providers: direct memory saves, no review event/card, off behavior, incognito with no memory/no persisted rollout, prompt preservation across restart/fork, and unchanged skill-recording transport. The complete 0.162.1 bridge gate also passed reviewer isolation/concurrency and image-input checks. Newer CLIs transmit a fork's replacement prompt inside a developer `<model_instructions>` message; the probe verifies exact saved bytes in that form or the earlier direct form. Production fork behavior is unchanged. The [official App Server documentation](https://learn.chatgpt.com/docs/app-server#message-schema) explains version-specific schema generation; protocol behavior was verified with the actual binaries rather than inferred from a schema alone.

The actual packaged sidebar passed in an isolated **Chromium 156.0.8078.4** profile: missing-host recovery, Attach → Detach → Attach → Remove, General/Models control ordering, inline memory editing, automatic native-change reload, removed expiry/refresh/card controls, incognito entry/exit and protected-page refusal, with zero sidebar console errors. Its account/memory transport is synthetic and it sends no chat. A narrow sidebar screenshot was inspected. The extracted companion archive passed native imports, versioned memory/incognito capabilities, memory CRUD, prompt bytes, image transfer and cancellation. Existing release archives were preserved by staging the package in a temporary directory.

The local companion was refreshed and its installed Chrome-like launcher check passed with the existing ChatGPT sign-in and Auto review available. Browser/native computer control is unavailable, so the user's running extension was not reloaded, and fresh signed-in model/Chrome scenarios remain unrun. Linux/Windows CI and native desktop scenarios for this new branch remain unrun until the changes are pushed and tested there. The existing three-platform workflow will exercise the updated checks on push. A local build or companion refresh does not publish a Chrome Web Store release.
