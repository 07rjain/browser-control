# Browser Control 0.3.9

Browser Control can now read ordinary page text alongside links, buttons and editable drafts. Previously, inspecting an X conversation could return reply controls and the user's draft while omitting the opening post and replies.

## Changes

- Add a bounded readable-text snapshot to `page.inspect`, including normal article text, open shadow roots and accessible same-origin frames.
- Keep text truncation separate from the 80-control cap. Inspection returns at most 12,000 text characters and visits at most 20,000 nodes.
- Exclude hidden/inert subtrees, editable field contents, scripts and non-text surfaces from the new text snapshot. Eligible non-sensitive draft values remain available separately in control results.
- Recognize spaced `API key` labels when identifying sensitive fields.
- Tell the agent to scroll and inspect again for newly loaded or virtualized thread content. Preserve existing extension identity, permissions, CSP, action policies and working-tab isolation.

## Update both components

The text-reading fix is in extension **0.3.9**. Companion **0.3.9** also updates the agent's tool description to explain the new text fields and thread-reading limits. Chrome updates the extension separately from the companion.

Get the matching companion from https://github.com/07rjain/browser-control-support/releases/tag/companion-v0.3.9 once published. Extract it, run `node scripts/install-native-host.mjs`, and restart/reconnect Browser Control. The installer preserves existing sign-in, settings and memory.

## Validation and limits

Local checks passed typecheck, lint, 282 tests (one platform-specific skip), signed-out native bridge probes and production build. Packaged-executor checks in disposable Chrome for Testing 156.0.8078.4 verified static thread text, separate draft values, hidden-content/secret filtering, refresh after scrolling/DOM replacement, and independent text/control limits without modifying the draft. The new harness also runs in the three desktop compatibility jobs.

Direct evaluation of the new extractor read the reported live X opening post and mounted replies. This is separate from full sidebar/model/native-bridge validation on the user's signed-in X session, which has not been performed. See [the investigation](investigations/2026-11-13-x-thread-reading.md).

Only currently mounted DOM text is readable. Long X threads can still require scrolling, expansion and reinspection. This release does not automatically retrieve every reply, read text embedded in images/canvas, bypass sign-in or access cross-origin frames.

Publishing the GitHub Release starts the configured compatibility, companion and Chrome Web Store submission workflow. Store submission is not Google approval or immediate availability; approved versions publish automatically.
