# Browser Control 0.3.7

This maintenance release includes compatibility fix `0d515a7` on top of 0.3.6.

## Fixes

- Restore the `chat.send.text` field expected by older native companions. An
  independently updated Store extension previously sent only `userText`, which
  produced `Invalid request: missing field` immediately when a message was sent.
- Preserve explicitly attached page text for older companions. Current
  companions receive raw intent and structured page context once.
- Point companion setup instructions to current `main` rather than the old
  desktop-companion development branch.

No Chrome permissions, CSP, model tools, dependencies or data collection change.

## Companion compatibility

The published 0.3.6 companion remains compatible. Users with that version do not
need to reinstall it for this extension fix. Files, custom prompts and Auto
review still require companion 0.3.6 or later. Older companions support the
basic-chat/page compatibility path; a Store update does not update them.

New source/package builds identify themselves as 0.3.7. The companion runtime
changes since 0.3.6 consist only of version metadata.

## Validation

The exact compatibility fix passed all three GitHub desktop jobs:
https://github.com/07rjain/browser-control/actions/runs/39120404258

The Windows job passed the actual C# launcher compile/live-pipe test, native
bridge probes with Codex 0.162.1, production packaging and the extracted
companion's image transfer/cancellation and prompt persistence checks. Windows
paths with spaces/Unicode, npm shims and localhost callback handling are covered.

The prior approved Chrome sidebar check on macOS sent one synthetic prompt
through GPT-6.1-Sol and received the exact expected answer with no tool calls or
console messages. Real Windows/Linux desktop sign-in and browser acceptance
remain unverified; automated Windows results are not a claim of those checks.

On October 22, 2026, the release working tree passed typecheck, lint, all 246
active tests (one Windows-only skip on macOS), real Codex 0.163.0 bridge probes,
the production release build and extracted-companion smoke test. ZIP integrity
and content checks passed: 275 entries, manifest at root, no source maps,
tests, dependencies, credentials or companion executable. The manifest differs
from 0.3.6 only in its version; permissions, CSP and extension identity match.

The extension archive SHA-256 is:

```text
4201a9043fbbdae3ad3102e58121df5272e59383dac45e4cd537590ee87eb852  browser-control-extension-0.3.7.zip
```

The final release commit `52a3c74` passed all three desktop CI jobs, including
the Windows native launcher, bridge, release build and extracted-package checks:
https://github.com/07rjain/browser-control/actions/runs/39809636679

## Submission record

On October 22, 2026, uploaded the checked 0.3.7 extension archive to the existing
Store item `mpdfhhhjgbpdpfnkjbnboebdjokfjglf`. The dashboard confirmed draft
version 0.3.7 and the same permission list as published version 0.3.6. Saved
the listing's updated companion-compatibility paragraph, then submitted after
all release CI jobs passed.

The confirmation dialog reported **Your extension was submitted for review**;
the dashboard then showed **Pending review**. Automatic publication after
approval is enabled. Version 0.3.7 is not yet claimed publicly available;
Google's review is pending. The existing public companion 0.3.6 remains
compatible and its download is unchanged.
