# Stop validation — 0.3.12

Date: 2026-11-16. Linux Ubuntu 24.04.3, headed Chromium 156.0.8078.4,
packaged unpacked extension ID `mpdfhhhjgbpdpfnkjbnboebdjokfjglf`, installed
companion 0.3.12, Codex CLI 0.169.0, existing ChatGPT sign-in, default model shown
in the sidebar as GPT-6.1-Sol. Source baseline: 4f57ffd plus this PR's Stop fix.

## Root-cause reproduction

The new sidebar regression test failed on the original implementation because
one Stop click sent both `CHAT_CANCEL_SEND` and `CHAT_INTERRUPT` for the accepted
message. `createChatInputService.cancel()` already interrupts an accepted turn.
The native-protocol regression fixture simulates the second RPC returning “no
active turn to interrupt”; the fixed companion dispatches exactly one RPC,
returns success to both callers, and rejects a late third-customer tool request.

## Signed-in product path

Command: `node scripts/manual-stop-e2e.mjs --live-account` (opt-in; uses account
quota). This Linux validation helper launches an isolated browser profile and a
disposable localhost form. It registers the installed real companion in that
profile, opens the actual side-panel target, and sends the request through the
chat composer. Native messaging and model responses are real; no account/model
transport is mocked. The fixture's exact origin is granted only in this test
profile. No external website, customer account or form was used.

Prompt, used once per scenario:

> On the current disposable local test page, fill and save all five customers in
> order. Use each row's heading for its Test name, and Pune for Test city. Save
> each row before starting the next. Do not touch any other tab.

| Scenario | Observed result |
| --- | --- |
| Ask every time: Stop while Asha's form submission awaited confirmation | Asha's two fields remained filled; nothing saved. Confirmation disappeared; turn completed as `interrupted`; composer returned to idle; no error banner. No further save during a 4-second observation. |
| Full access: Stop during Ravi's `page.fill` after Asha was saved | The disposable fixture deliberately held its second customer's input handler for 3 seconds. Stop was pressed 43 ms after that handler began. Asha remained saved; Ravi's name remained filled, city blank, form unsubmitted; Leena, Noor and Maya remained untouched. Turn completed as `interrupted`. No further mutation or save during an 8-second observation. |

Real emitted tools: `page.inspect` with a fresh idempotency key; `page.fill`
with fresh opaque `{id, snapshotId, tabId, origin}` references and values `Asha`,
`Pune` or `Ravi`; `page.click` on the corresponding Save button with its own
idempotency key. The Save click in Ask every time produced an exact-form approval
card. Full access allowed the localhost Asha Save click; no new site or action
was authorized outside this fixture. One `chat.interrupt` was sent per turn, and
both `chat.turnCompleted` events reported `interrupted`.

The panel displayed “Stopped. Actions already completed are kept; remaining steps
were canceled.” The Stop button/running state cleared. The service-worker and
panel consoles each had zero errors. Independent Playwright DOM reads verified
the saved list and input mutation log after Stop; those reads did not execute
the product task. Evidence is `/tmp/browser-control-stop-e2e.json` on the test
machine. All owned test browsers/tabs were closed. No video was recorded.

An earlier real run also passed between customers: Asha and Ravi were already
saved when Stop arrived, the remaining three were untouched, and no changes
occurred afterward. The held-input run above verifies the narrower in-flight case.

## Automated gates

- TypeScript, ESLint, 324 tests passed; one pre-existing test skipped.
- Real CLI synthetic native-bridge and isolated reviewer probes passed.
- Release build and portable-companion package smoke passed, including importing
  the new interrupt coordinator from the packaged companion.
- Packaged Chromium attachment/companion-repair, page-inspection and extension-
  update checks passed, with their existing synthetic transport limitations.
- The installed companion reported 0.3.12, CLI 0.169.0, signed-in account and Auto
  review available.

No signed-in manual Mac or Windows task is claimed. The release pipeline reruns
all 18 compatibility jobs across Linux, macOS and Windows at the exact release
commit. Stop preserves completed effects; it does not roll them back, and an
already dispatched individual browser action can finish before Stop settles.
