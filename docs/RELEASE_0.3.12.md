# Browser Control 0.3.12

Stop now cancels a running browser task without the misleading “no active turn
to interrupt” error. The extension and portable companion support Linux, macOS
and Windows.

## Root cause and fix

The side panel canceled the accepted chat message and then separately interrupted
its turn. Canceling an accepted message already calls `turn/interrupt`; the second
interrupt could reach Codex after the first had succeeded. This produced the error
seen in Ramya's clip, even though previously completed form submissions could not
be undone. A regression test reproduces the two requests on the old code.

- Send one interrupt for a known turn. Use pending-message cancellation when the
  turn ID has not arrived yet; a late acceptance cannot restart the response.
- Share an exact-thread/turn interrupt coordinator in the companion. Coalesce
  simultaneous requests and remember stopped/completed turns. This also protects
  older extension clients that still call both cancellation methods. Never target
  a different or newer turn. Preserve genuine connection/interrupt failures.
- Block late browser, skill and memory tool requests for stopped turns. Install
  the background cancellation barrier before interrupting, without waiting for
  pending approval replies and storage cleanup first. Canceled tool failures are
  shown as canceled.
- Ignore late text/completion events from stopped turns, clear approval cards and
  running state, and show: “Stopped. Actions already completed are kept; remaining
  steps were canceled.”

No new Chrome permission, model capability, remote service, tracking, or change
to approval policy. Stop does not roll back an action already executed, and an
individual browser action already dispatched may finish before cancellation
settles. Subsequent task steps must remain blocked.

## Updating existing installations

Install extension 0.3.12 through the Chrome Web Store and update the matching
companion:

https://github.com/07rjain/browser-control-support/releases/tag/companion-v0.3.12

Verify the ZIP against SHA256SUMS.txt, extract it, then run
`node scripts/install-native-host.mjs` from the extracted folder on Linux, macOS
or Windows. Finish other tasks, fully quit Chrome or Brave (⌘Q on macOS), and
reopen it. Saved sign-in, memory and skills are preserved. Store updates do not
replace an already installed native companion.

## Validation

Regression coverage includes Stop during a pending tool, accepted-message/Stop
double cancellation through the real native host protocol, late tool rejection,
Stop before turn acceptance, completion racing Stop, isolation from a newer turn,
late UI events, and genuine interrupt failures. See the signed-in Linux validation
in [STOP_VALIDATION_0.3.12.md](STOP_VALIDATION_0.3.12.md).

The release workflow must pass all 18 exact-commit Linux/macOS/Windows jobs before
publishing the matching public companion and requesting normal Chrome Web Store
review. A submitted version is not live until Google approves and publishes it.
