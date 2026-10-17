# Browser Control 0.3.6

This release includes the browser-control changes from `ae2e3f7` through
`fe452bb`, merged into `main` at `bbf2691`.

## Features

- Attach local images, text, Markdown, and visual or scanned PDF pages using
  the file picker, drag and drop, or pasted images. Preview and remove files
  before sending; choose page ranges for larger PDFs.
- Select Auto review to use a separate, configurable reviewer model for
  eligible browser actions. Luna is the default; risky or unclear actions
  still require the user's decision.
- Edit and save separate main-chat and reviewer system prompts in the
  reorganized General, Models, Agent, Skills, and Account settings.
- Ask to record a skill, or accept a contextual Record skill offer beneath
  an answer. Review and start capture explicitly. Record up to 120 steps and
  save skill documents up to 240,000 characters.
- Read locally typeset inline and display equations while retaining original
  Markdown for Copy, Fork, and history.
- Use the guided opening experience, improved attachment controls, task
  animation, completion notices, and chronological tool activity.

## Fixes

- Harden popup handling, iframe controls, effective form destinations, and
  confirmations for unknown tab destinations.
- Restrict sidebar Codex threads to the supported extension tools; preserve
  older unrestricted chats as read-only history.
- Repair recorder Stop/Cancel/restart behavior, duplicate listeners, and
  collection of pending typing and scrolling before review.
- Recover once from workspace-discovery timeouts and prevent late account
  checks from restoring a disconnected or signed-out session.
- Improve native-host shutdown, Windows Codex npm-shim discovery, upload
  safety, and Linux/Windows/macOS compatibility checks.

## Companion update

Install the matching 0.3.6 companion to use the new attachment, reviewer,
prompt, and skill features. Download it from the official companion releases:
https://github.com/07rjain/browser-control-support/releases

The companion archive contains portable JavaScript plus installers for macOS,
Linux, and Windows. The platform in the generated archive name identifies the
build machine. Run `node scripts/install-native-host.mjs` after extraction on
the target operating system, then restart the browser.

## Validation

Release validation on October 17, 2026 passed typecheck, lint, 243 automated
tests (one Windows-only skip), native bridge checks with Codex 0.163.0, the
production release build, ZIP integrity checks, and the extracted-companion
smoke check. The locally installed 0.3.6 companion also passed the Chrome-style
launch check and confirmed an existing ChatGPT sign-in. GitHub's compatibility
matrix passed on Linux, Windows, and macOS for base commit `bbf2691`.

Earlier feature-specific browser evidence and outstanding manual
scenarios are recorded in README.md. Windows/Linux desktop browser acceptance
and a complete live recording/save cycle remain pending; automated checks are
not a substitute for those scenarios.
