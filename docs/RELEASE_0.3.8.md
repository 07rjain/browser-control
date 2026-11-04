# Browser Control 0.3.8

This release packages `main` at `b9285aa` plus release metadata and updated public documentation. It retains the Store extension ID `mpdfhhhjgbpdpfnkjbnboebdjokfjglf`, permissions and CSP.

## Features and fixes

- Enable saved memory to let the answering model add, correct and delete useful personal facts/preferences directly from the current user message. No save/review card is required. Page/file/tool/assistant content cannot authorize changes.
- Edit memories in one inline Settings list. Saved memory has no automatic expiry and loads on open, change events and focus; the Refresh button is removed. The companion-owned store can survive a same-computer browser reinstall when its files are kept.
- Start Incognito chat from the header without saved memory or local conversation history. Ephemeral Codex threads close on leaving the chat/panel; Fork is disabled there. Provider retention, normal attachment retention and transient browser-action metadata still apply.
- Put Settings toggles/primary controls before editors and destructive actions.
- Restore Auto review on verified Codex 0.162.1, 0.164.0 and 0.165.0, show actionable compatibility reasons, and retain configurable reviewer model/prompt choices.
- Retain companion connection errors, legacy chat text compatibility and Windows process/stream cleanup fixes.

## Companion update

Memory and incognito require **companion 0.3.8**. Chrome updates the extension separately from this local runtime. Basic chat and page attachment retain the older-companion compatibility path; incognito fails closed on an old companion instead of creating a saved chat.

The companion ZIP contains portable JavaScript and installers for macOS/Linux/Windows. Its `macos` filename suffix identifies the build machine; it is the same source distribution installed on all three systems. After extraction run `node scripts/install-native-host.mjs`, then restart/reconnect the browser. Installation preserves existing sign-in, custom prompts and saved memory.

Published companion release: https://github.com/07rjain/browser-control-support/releases/tag/companion-v0.3.8

## Validation

The feature commit passed all 15 GitHub compatibility jobs on main:
https://github.com/07rjain/browser-control/actions/runs/41215691600

The local 0.3.8 release checks passed typecheck, lint, 257 active tests (one Windows-only skip on macOS), real Codex 0.162.1 signed-out localhost bridge probes, production packaging and extracted-companion smoke checks. Earlier implementation probes also passed direct memory/incognito on Codex 0.164.0 and 0.165.0. No account inference was sent by these release checks.

ZIP checks confirmed manifest-at-root, version 0.3.8, unchanged identity/permissions/CSP, no source maps/dependencies/tests/companion files in the extension ZIP, and packaged memory modules plus matching installer metadata in the companion ZIP. Release commit `a67a00a` passed all 15 compatibility jobs, including the full desktop/Chromium workflows on Linux, Windows and macOS: https://github.com/07rjain/browser-control/actions/runs/41760187846. The additional local Chromium launch stalled and was stopped; the remote browser checks passed. Signed-in model behavior and actual Linux/Windows desktop scenarios remain distinct manual checks; see `docs/MEMORY_TESTING.md`.

## Archive checksums

```text
35f1dbdfadc6b9b97542564b61d530a1f5a09845c4b1ac349fe42a032a73ed7a  browser-control-extension-0.3.8.zip
28d7b96f0913039e3cd31b5c43a151485d45685bc7035e3c12f6cc68c123186b  browser-control-companion-macos-0.3.8.zip
```

## Submission status

On November 4, 2026, uploaded the verified extension ZIP through Brave's normal UI using Codex native computer control, signed in to the publisher account `cu.16bcs2797@gmail.com`. The browser-extension scripting bridge could not operate the protected Store page; no browser credentials or private publishing endpoints were used.

The dashboard showed **Draft 0.3.8** and **Published 0.3.7**, with identical Chrome permission lists. Saved the 0.3.8 description and 473-character reviewer instructions, including the matching-companion requirement and synthetic memory/incognito checks. Set the listing's Homepage/developer-contact website to **https://bothrarishabh.com** at the user's request. Support and privacy URLs retain the official support site, whose updated memory/incognito disclosures were deployed and verified before submission.

The matching companion and checksum were published at the link above. GitHub's server-side asset SHA-256 digest matches the local companion checksum. The public site commit is `164d8fc` in `browser-control-support`.

Submitted for review with **Publish automatically after it has passed review** checked. The confirmation read **Your extension was submitted for review**, and the dashboard then showed **Pending review** and **Item submitted**. Public/free/all-regions distribution is retained. Version 0.3.8 will become publicly available after Google's approval; submission is not approval or live availability. The existing 0.3.7 remains published while review is pending.
