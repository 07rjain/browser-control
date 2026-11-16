# Browser Control 0.3.10

Auto review now supports verified Codex CLI 0.169.0. This release also adds update status and a manual update check in Settings, with staged extension updates deferred until Browser Control is idle.

## Changes

- Restore Auto review availability on Codex CLI **0.169.0** after verifying reviewer tool isolation, structured output, custom prompt transport, concurrent review and ephemeral sessions. Untested CLI versions still require human confirmation.
- Retain Auto review's existing low-risk eligibility, user-confirmation fallbacks, permissions, hard refusals, action binding, deadlines and review budget. This change does not make every action automatically approvable.
- Add **Settings → General → Updates** to show the installed extension version, manually check Chrome for a newer version, and explain pending updates, throttling, network failures and unpacked development builds.
- Listen for Chrome's staged-update event and install only after all extension views close, tasks and approvals finish, skill recording is saved or canceled, and pending requests/saves settle. Retain staged-update state across worker suspension; uncertain state defers installation.
- Keep Chrome Web Store downloads and signature verification as the extension update channel. No new permission, recurring Store polling, remote executable updater or telemetry was added.

## Update the companion for Auto review

Install companion **0.3.10** from:
https://github.com/07rjain/browser-control-support/releases/tag/companion-v0.3.10

Extract the package, verify its checksum and run `node scripts/install-native-host.mjs`. Finish active work, reload Browser Control in `chrome://extensions`, then choose **Settings → Agent → Agent permission → Auto review**. The installer preserves sign-in, settings, saved memory and skills.

The extension and companion update separately. The new extension update controls do **not** install the companion. In particular, an older companion may still reject a newer CLI even after Chrome updates the extension. The diagnosis that led to this release found a local 0.3.7 companion accepting only CLI 0.162.1; see [the investigation](AUTO_REVIEW_2026-11-15.md).

## Validation and limits

Local validation includes TypeScript/build, lint, 305 active tests (one existing skip), the real CLI's isolated synthetic reviewer/native-bridge probes and packaged Chromium checks. Disposable Chromium profiles cover update status, no-update/throttling explanations, staged-update deferral during open panels/active tasks/skill recording, and reload after blockers clear. Auto review UI checks verify that 0.169.0 enables the option, the selection survives reload, and an unverified CLI still shows an unavailable reason. These use synthetic account/provider/Store events, not a live external submission or real Store delivery.

Release automation reruns the exact tagged commit on Linux, Windows and macOS before publishing the companion and submitting the extension for normal Google review. Submission does not mean Google approval or immediate update delivery. Chrome's schedule, rollout and browser policies still apply; an older extension must first receive this implementation through Chrome's normal updater.
