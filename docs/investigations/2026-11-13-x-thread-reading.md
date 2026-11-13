# X thread text missing from page.inspect

Investigated on 2026-11-13. Local fix prepared; not pushed, released, or installed into the user's browser.

## Finding

In public extension source version 0.3.8 at commit `bd4628efce65826211cbc69dffe86c363dd02f48`, `page.inspect` returns interactive controls and eligible field values, but no general page text. Tweet bodies in ordinary spans/divs therefore disappear from the tool result, while an editable reply draft can remain readable. The native tool description also explicitly advertised controls only.

This is a confirmed source defect matching the user's trace. The user's installed extension and companion versions were not established, so it is not a reproduction of that exact installed session.

The initial regression fixture demonstrated the same asymmetry: the draft value was present, but the expected opening-post text was absent. It failed on the original executor and passes with the fix.

## Local change

- Add `readableText` to inspection, independently bounded to 12,000 characters and 20,000 visited DOM nodes. `textTruncated` reports either text limit; the existing `truncated` retains its meaning of more than 80 controls.
- Traverse live DOM, open shadow roots and accessible same-origin frame bodies without changing the page. Use composed slot content rather than duplicating slotted or unslotted light DOM.
- Omit hidden/inert subtrees, executable and non-text surfaces, closed-details contents, and editable-field subtrees from general text. Existing eligible control values remain separate.
- Correct the existing sensitive-field matcher to recognize the common spaced label `API key`; the new privacy fixture exposed that omission.
- Preserve the working-tab binding, opaque refs, permission policy and manifest. Update the native tool description to explain reading and reinspection on virtualized pages.

No new permissions, external service, private X endpoint, telemetry, screenshot tool, or model-executable JavaScript capability was added.

## Validation environment

- Ubuntu 24.04.3 LTS, Linux 6.8.0-147-generic.
- Node 26.13.1; Codex CLI 0.167.2 for isolated bridge probes.
- Disposable Chrome for Testing 156.0.8078.4; unpacked build retains Store ID `mpdfhhhjgbpdpfnkjbnboebdjokfjglf`.
- Source baseline is the commit above plus the local diff. The existing marketing workspace is a different repository (`browser-control-launch`); extension changes are in `/home/ubuntu/Desktop/browser-control-extension`.

## Evidence and results

| Check | Result | Scope |
| --- | --- | --- |
| Static X-like opening post, reply and editable draft regression | Pass | Actual executor in jsdom; original implementation failed this regression |
| Hidden ancestors, secret fields, shadow slots, same-origin frames, live DOM changes and independent budgets | Pass | Executor unit tests |
| Background result forwarding | Pass | Host unit test preserves text/limit flags while wrapping refs for the pinned tab |
| `npm run typecheck` and `npm run lint` | Pass | Local source, including browser validation script |
| `npm test -- --maxWorkers=2` | Pass | 282 tests passed, 1 existing platform-specific test skipped |
| `npm run test:bridge` | Pass | Isolated signed-out native-bridge probes; not the user's X chat |
| `npm run build` | Pass | Packaged extension; existing large-chunk warning remains |
| `node scripts/smoke-page-inspection.mjs` | Pass | Actual packaged isolated-world executor via Chrome extension messages, disposable loopback fixture |
| New extraction function on the reported live X URL | Pass | Direct browser evaluation of the source function, not the extension's full agent path |
| Full sidebar chat through native bridge and policy against signed-in X | Not run | Requires follow-up validation of the updated installed extension/companion |

The first unrestricted-parallel suite run exhausted resources and produced timeouts; limiting workers resolved these. The machine also lacked `zip`, used by an unrelated release-preflight test. An Ubuntu `zip` package was downloaded and extracted under `/tmp/browser-control-reader-tools`, and its executable was added to PATH only for the successful test command. No system package installation was made. An initial bridge probe timed out under contention; the later complete bridge run passed.

### Packaged browser steps

1. Build `dist/`; copy it into a disposable profile fixture. Grant only loopback access in the temporary manifest copy; do not alter the product manifest or the user's profile.
2. Start Chrome for Testing with the copied unpacked extension. Use its real worker to inject packaged `page-executor.js` and send `CODEX_PAGE_EXECUTOR` messages.
3. Inspect a fixture containing ordinary article text, an editable reply, hidden text and a fake API-key field. Expected and observed: article text returned, eligible draft value available separately, hidden text and fake secret absent from the new text snapshot; fake secret also absent from the complete inspection.
4. Scroll, replace the mounted article and reinspect. Expected and observed: updated article returned, new snapshot ID, draft unchanged.
5. Add more than 80 controls. Expected and observed: control truncation true while static post text remains available and text truncation false. Replace content with more than 12,000 characters; text truncation becomes true at the character cap.
6. Page exceptions and service-worker console errors captured by the harness: none.

Run again after building with `node scripts/smoke-page-inspection.mjs`; add `--headed` for a visible disposable browser. This harness does not send a chat, test activity/Stop, or install a companion.

### Live X check

URL: https://x.com/harshil1712/status/2121184085263417411

The shared browser could render the opening post and several replies while signed out. The new extraction function returned 2,517 characters without truncation, including the opening complaint about an unexplained account closure and the account owner's response. This demonstrates that the text exists in the live DOM and the generic extractor can read it. It does not demonstrate access to every reply or the user's draft. No X interactions, submissions or draft edits were performed. The owned research tab was closed afterward.

## Remaining limits and next validation

X virtualizes long conversations. Only mounted DOM text is available; scrolling, expanding a post and reinspecting may still be required. Sign-in restrictions, inaccessible frames, closed shadow roots, images/canvas text, and content not loaded by the site remain limits. This change does not promise complete-thread retrieval.

Before release, rebuild/reload the extension and refresh the companion (the native tool description changed), then send the user's original read-and-refine request through the real sidebar on the pinned X tab. Record the selected model, actual inspect outputs and scroll calls, approvals, activity/Stop behavior, both consoles and the assistant's use of opening-post context. Keep the draft unchanged and do not submit it. This exact agent path and the user's installed version remain unverified.
