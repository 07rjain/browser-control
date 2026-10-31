# Test the confirmed-memory development build

Status: implemented locally on `feat/local-memory`, based on `main` at `22ed870`. Not published to the Chrome Web Store. Automatic background learning is not part of this release.

## Load the matching extension and companion

1. Build with `npm run build`.
2. Refresh the companion as the same desktop user who runs Chrome: `npm run install:host`, followed by `npm run test:installed-host`. This preserves sign-in/custom prompts and records; it does not enable memory.
3. Open `chrome://extensions`. For an existing unpacked Browser Control entry, choose Reload. Otherwise choose Load unpacked and select this repository's `dist/` directory. Confirm ID `mpdfhhhjgbpdpfnkjbnboebdjokfjglf`.
4. If a Store installation prevents loading the same ID, stop before removing it: extension removal can erase browser-local history/settings. Use a separate Chrome test profile with an unpacked build, or explicitly choose the migration after preserving needed data. Companion data is shared by profiles for the same desktop user, so keep tests synthetic.
5. Open Browser Control → Settings → Memory. A missing/old companion shows an update error. Enable **Use saved memory**, then start a new chat. Existing chats keep their original participation mode.

Default memory locations are `~/.codex-sidebar/memory.json` on Linux/macOS and `%USERPROFILE%\.codex-sidebar\memory.json` on Windows. Runtime installation paths and browser registrations are unchanged. No new Chrome permission or native dependency is required.

## Manual scenarios

Record OS/browser/Node/Codex/build versions, exact prompt/model, observed tools and approvals, both consoles, and pass/fail/blocked for each scenario. Obtain the repository's required fresh specific confirmation before an agent sends each live test prompt or resets/deletes user data. The user can run these steps directly.

1. **Manual save and personalization:** add preference `Prefer concise answers with one example.` in Settings. Start a new chat and ask `Explain what a browser tab group is.` Confirm relevant personalization without asking explicitly for memory retrieval.
2. **Reviewed remember:** send `Remember that my favorite test animal is an otter.` Confirm a memory review card appears below the completed answer and above Copy/Fork. It must not be in Settings until Save memory is clicked. Confirm the success label follows the host acknowledgement. Dismiss another proposal and verify nothing is saved.
3. **Cross-chat lookup:** start a new chat and ask `What is my favorite test animal?` Confirm the saved value. Use a fact outside the small profile to exercise `memory.search` explicitly.
4. **Correction/forget:** ask to correct the test animal, review the exact change, and verify one current record. Delete only the synthetic test memory through its card/Settings. Restart and verify a new chat cannot retrieve it. Existing transcript text can still contain the earlier fact.
5. **Memory off/free chat:** turn memory off and confirm later search/proposal calls fail safely. Turn it on, choose Start a chat without memory, and confirm there is no profile or memory-tool access. Reopening that chat must retain its captured mode; use a fresh ordinary chat to participate again.
6. **Lifecycle/failures:** Stop during a proposal, reopen the panel, try an expired/stale card, and change a record from another companion. No unreviewed write or stale overwrite is allowed. A memory failure must leave ordinary chat usable. Confirm a page/file instruction alone cannot save a fact or change permissions.
7. **Settings usability:** add/edit/pin an entry, supply a temporary expiry, inspect its source, switch Settings sections, close/reopen, and verify keyboard focus and draft/error handling. Verify the required memory guidance is visible and existing custom chat prompts were preserved.

## Automated evidence and limits

- `npm test` includes a real native host with a synthetic App Server for client/chat opt-in, source validation, reviewed writes, restart, and forgotten-fact replay. UI checks cover Settings and the card acknowledgement/order separately.
- `npm run test:memory` uses actual files/processes for profile/search, exact text persistence, modes, expiry, confirmation, stale revisions, competing writers, corrupt state, and links. An uncertain lock returns busy; no automatic lock stealing is performed.
- `npm run test:bridge` with verified CLI 0.162.1 exercises the real Codex dynamic-tool protocol against a local synthetic Responses provider, including memory profile input and reviewed proposals. It sends no account inference. Reviewer isolation remains a separate probe.
- The extracted release smoke checks packaged memory modules and native RPC CRUD. Installed-host checks validate the actual launcher environment separately.
- CI adds Node 20/24 memory runtime jobs on Ubuntu, Windows, and macOS. Remote results must be recorded after an authorized push; configuration alone is not a pass.
- Manual browser access was unavailable during initial implementation (`browser access host is unavailable` and native pipe startup failure). A built `dist/` or passing fixtures are not evidence that the signed-in Chrome sidebar scenarios above ran. Native Linux/Windows memory UI and real-model personalization remain outstanding.

## Local validation recorded for this build

Environment: macOS 27.0.1 ARM64, Node 20.20.1, `feat/local-memory` working changes based on `22ed870`. Typecheck, lint, production build, and the full suite passed: **246 passed, one Windows-only skip**. Focused memory/skill-offer checks passed after the final native lifecycle changes. The dependency-free memory smoke passed, including read-only save failure and old-source rejection after reset.

The verified Codex CLI 0.162.1 passed the signed-out bridge suite against a synthetic localhost provider. It exercised memory profile input, a real dynamic memory proposal, explicit reviewed persistence, deletion/reset, and turning memory off before a new thread's first turn. The initial thread-resume defect was reproduced by this probe before being fixed. Reviewer isolation, existing prompt preservation, skill recording offers, and image input checks also passed. No signed-in model inference was sent.

An isolated package staging directory built the extension/companion archives and passed extracted native memory CRUD plus existing prompt/image/cancel checks without overwriting previous release artifacts. The actual macOS companion was refreshed with the final source, matching runtime/config hashes were verified, and `npm run test:installed-host` passed with the existing ChatGPT sign-in through the installed Codex CLI 0.164.0. This checks startup/account/catalog, not a live memory response on that version.

The unpacked build is in this repository's `dist/`. Browser/native computer access remained unavailable, so this run did not load/reload Chrome or perform any of the manual sidebar scenarios. Linux/Windows runner results and native desktop checks remain unverified until run. The feature changes have not been pushed or published.
