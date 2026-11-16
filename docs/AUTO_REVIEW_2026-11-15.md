# Auto review compatibility diagnosis — 15 November 2026

The request concerned Browser Control's **Auto review approval mode**. No specific failing website/task was supplied, so this diagnosis establishes a reproducible local availability failure; it does not attribute every human confirmation to a defect.

## Confirmed local causes

- The installed CLI is `codex-cli 0.169.0`. App Server identifies itself as `T3 Code/0.169.0 (Ubuntu 24.4.0; x86_64) dumb` in the isolated probe.
- Source `bridge/reviewer-config.json` accepted only 0.162.1, 0.164.0 and 0.165.0. Its capability response for 0.169.0 was `available: false`.
- The actual installed native launcher pointed to `~/.local/share/browser-control/host/0.3.7/native-host.mjs`, although source is 0.3.9. That older installed reviewer accepted only 0.162.1. The installed-host smoke test reproduced its rejection.
- Chrome extension updates do not update the native companion. A running native process also keeps the old implementation until the extension disconnects/reconnects.

## Changes and local repair

- Added only CLI 0.169.0 to the shared verified-version list **after** its real isolated tool/concurrency/structured-output probes passed. Unverified versions remain unavailable.
- Added host-boundary regression cases for accepted 0.169.0 and rejected 0.170.0. The new 0.169.0 case failed before the compatibility change and passed afterward. The tests also retain pending-action binding and ensure capability checking starts no inference.
- Added 0.169.0 to the three-OS reviewer compatibility CI matrix. Remote CI has not been run by this local investigation.
- Updated current Auto review setup guidance in README; historical audit/release records remain historical.
- Refreshed this Linux machine's companion with `npm run install:host`, using the current 0.3.9 bridge sources. Preserved the previous 0.3.7 runtime and backed up the launcher/registrations at `/tmp/browser-control-companion-backup-20261115T235125Z`.
- The post-install Chrome-like native-host smoke check reports **Auto review: available** and the existing signed-in ChatGPT account. Installed native-host/reviewer/config hashes match source.

No eligibility, human-escalation, model/prompt selection, deadline, action-binding or permission rules were relaxed. No user approval mode was changed in the user's real Chrome profile. Existing unrelated store, extension-update and UI edits were retained. No push, release or Store publication was performed.

## Validation performed

- `npm run test:reviewer` passed on the actual 0.169.0 binary with a synthetic localhost Responses provider. Luna, Sol, Astra and an unknown model were checked for tool exposure; concurrent Luna/Sol reviews verified structured output, exact custom prompt transport, ephemeral sessions and parent-turn separation. This is protocol evidence, not a live account/model availability or latency test.
- `npm test`: **305 passed, one existing skipped test**. The first run encountered a missing system `zip` executable in an unrelated release-preflight test. The Ubuntu zip package was downloaded and extracted under `/tmp/browser-control-zip-tool`; the failing suite and then the full suite passed with that executable on the test-only PATH. No test expectation was weakened and no system package was installed.
- `npm run lint` passed. `npm run build` passed TypeScript checking and production bundling.
- `npm run test:bridge` passed against the real CLI with the isolated synthetic provider, including reviewer isolation/concurrency and normal chat/memory/input transport.
- `npm run test:installed-host` reproduced the old rejection before installation, then passed with `Auto review: available` afterward. This reads availability/account/model status; it sends no chat or browser action.
- An instrumented temporary copy of the existing sidebar browser harness ran the built extension in a disposable Chromium 156.0.8078.4 profile on Linux. Actual side-panel UI, worker messages and storage were used with a synthetic account/native transport and source-generated capability responses. Verified: 0.169.0 makes the Auto review option selectable; selecting it persists legacy Ask plus the enabled reviewer; the selection survives panel reload; unverified 0.170.0 disables the option and shows its detected-version reason. Existing attach/detach, protected-page refusal and zero-console-error checks also passed. The temporary runner was removed from the repository and retained at `/tmp/browser-control-auto-review-sidebar-check-2026-11-15.mjs` for inspection.

No live model inference or real website action was performed. A signed-in end-to-end reviewer approval on the user's original website remains unverified; no specific scenario was provided and no external submission was authorized or attempted.

## Apply to the running browser

On this repaired machine, finish any active task and reload Browser Control in `chrome://extensions` to disconnect the older native process. Reopen the sidebar, then choose **Settings → Agent → Agent permission → Auto review**. Permission/reviewer choices apply to the next browser task.

Other machines and Store users do not receive this local patch automatically. They need a companion containing the verified 0.169.0 configuration; no new public release was created here.

Auto review intentionally handles only eligible low-risk confirmations. Site grants, sending/publication, deletion, bookings, account/security changes and incomplete or unclear evidence still require human review. That behavior is separate from the compatibility failure repaired here.
