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

Intended public release: https://github.com/07rjain/browser-control-support/releases/tag/companion-v0.3.8

## Validation

The feature commit passed all 15 GitHub compatibility jobs on main:
https://github.com/07rjain/browser-control/actions/runs/41215691600

The local 0.3.8 release checks passed typecheck, lint, 257 active tests (one Windows-only skip on macOS), real Codex 0.162.1 signed-out localhost bridge probes, production packaging and extracted-companion smoke checks. Earlier implementation probes also passed direct memory/incognito on Codex 0.164.0 and 0.165.0. No account inference was sent by these release checks.

ZIP checks confirmed manifest-at-root, version 0.3.8, unchanged identity/permissions/CSP, no source maps/dependencies/tests/companion files in the extension ZIP, and packaged memory modules plus matching installer metadata in the companion ZIP. Fresh release-branch desktop CI is required before submission. Signed-in model behavior and actual Linux/Windows desktop scenarios remain distinct manual checks; see `docs/MEMORY_TESTING.md`.

## Archive checksums

```text
35f1dbdfadc6b9b97542564b61d530a1f5a09845c4b1ac349fe42a032a73ed7a  browser-control-extension-0.3.8.zip
28d7b96f0913039e3cd31b5c43a151485d45685bc7035e3c12f6cc68c123186b  browser-control-companion-macos-0.3.8.zip
```

## Submission status

Prepared on November 4, 2026. The public listing currently serves 0.3.7. The extension ZIP has not yet been uploaded or submitted. Brave's Codex browser extension reports “The extensions gallery cannot be scripted” for the Store developer dashboard; an authenticated dashboard upload path is still required. Publish the matching companion and updated privacy/support pages before submitting 0.3.8. Automatic publication after Google's approval is the existing release preference.
