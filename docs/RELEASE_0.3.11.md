# Browser Control 0.3.11

Settings now identifies an outdated companion when it rejects a supported Codex
CLI, and provides the correct repair path on Linux, macOS and Windows.

## What changed

- Recognize a legacy companion's refusal of a verified CLI, including 0.169.0.
  Explain that the running companion needs updating or restarting, rather than
  repeating its outdated claim that the CLI still needs verification.
- Add an official companion download, platform-specific Terminal/PowerShell and
  restart guidance, and **Check support again** under Settings → Agent. Recheck
  support when Settings opens. Keep the user's existing permission choice.
- Report the actual packaged companion version and its verified CLI list.
  Previously the bridge status contained a hard-coded 0.3.7. Local version queries
  no longer require starting Codex.
- Name the shared download `browser-control-companion-0.3.11.zip`, reflecting its
  support for all three desktop operating systems. Node.js 20+ and an installed
  compatible Codex CLI remain required. Windows registration uses the existing
  .NET Framework launcher; no additional package dependency is introduced.
- Resolve unpublished companion drafts by their release record, so a draft can
  be populated before its Git tag exists. Preserve immutable asset checks.

## Existing installations

The Chrome Web Store update installs extension 0.3.11. It cannot replace a native
companion already installed on the computer. If Auto review is disabled because
the running companion is older, download the matching companion from:

https://github.com/07rjain/browser-control-support/releases/tag/companion-v0.3.11

Verify the ZIP against SHA256SUMS.txt, extract it, and run
`node scripts/install-native-host.mjs` in the extracted folder. Finish active
tasks, fully quit Chrome or Brave (⌘Q on macOS), then reopen it. Select Auto review
under Settings → Agent. Sign-in, saved memory and skills are preserved. If the
new companion is already installed, the full restart may be sufficient.

No native auto-updater, new Chrome permission, telemetry, model tool, or change
to Auto review's eligibility and safety checks was added. Unverified CLI
versions remain unavailable; a supported CLI alone cannot override an older
companion's refusal.

## Validation

Regression tests cover the reported legacy-host response, supported/unsupported
CLI handling, platform-specific repair instructions, capability rechecking
without permission changes, and accurate runtime/package versions. Isolated
packaged Chromium checks exercise the repair flow with synthetic native
responses; no live account inference or external browser action is used.
Local validation passed typecheck, lint, 316 tests (one pre-existing skip), the
real CLI's synthetic bridge/reviewer probes, portable package checks and the
packaged Chromium repair/update flows. The installed Linux companion reports
0.3.11, CLI 0.169.0 and Auto review available. This does not claim a signed-in
end-to-end browser task on the user's Mac or Windows machine.
The release pipeline reruns all 18 compatibility jobs on Linux, macOS and Windows
before companion publication and normal Chrome Web Store review.
