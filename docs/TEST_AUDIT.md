# Focused test audit — 2026-10-16

Workflow: [OpenClaw test-audit](https://github.com/openclaw/openclaw/blob/main/.agents/skills/test-audit/SKILL.md), installed in the local Codex skills directory. This is a focused audit of the current attachment and automatic-review changes, not a whole-repository campaign. Use this repository's npm gates; OpenClaw-specific CI commands do not apply here.

## Baseline and preservation

- Branch: `feat/file-attachments`, HEAD `7595794`, with substantial pre-existing uncommitted feature work. No commit, release, or publication is part of this audit.
- Before editing, the full suite passed: 211 tests, one existing platform skip. Baseline JSON: `/tmp/browser-control-test-audit-baseline.json`.
- A serial owner baseline covers attachment, reviewer, policy, and worker suites: `/tmp/browser-control-audit-owner-before.json`.
- The complete pre-audit working files were preserved in `/tmp/browser-control-before-test-audit.tar` (excluding `.git`, dependencies, and generated `dist`). Compare audit changes against that snapshot, not HEAD.

## Candidate evidence recorded before edits

### Attachment preparation and Codex input

- `src/sidepanel/attached-files.ts:formatFileContext` has no production caller. Its sole caller is the final case in `tests/attached-files.test.ts`, which verifies the obsolete inline-message format. Actual sends use `bridge/chat-input.mjs` and `bridge/uploads.mjs:inputs`, with separate text and local-image items.
- Replace that obsolete proof by extending the existing typed-send case in `tests/attachments-host.test.mjs` with a real uploaded text asset. Protect the distinction between the user's instruction and untrusted file reference/body, alongside image input and send idempotency.
- `isTextFile` has one internal production caller, `readAttachedFile`; its exported predicate test can move into the existing file-reading case. Preserve Markdown by extension, text by MIME, unsupported binary rejection, UTF-8 validation, and truncation. Make the predicate and unused-export character limit private.
- History: these attachment files are current untracked feature work. The old formatter predates the typed upload path; its lack of callers was checked across `src`, `bridge`, `tests`, and `scripts`.
- Risk: accidentally dropping the untrusted-reference contract while deleting dead code. Validate `attached-files`, `attachments-host`, and sidebar interaction suites plus the build and bridge gates.

### Reviewer configuration and policy

- `tests/approval-reviewer.test.mjs` compares two exports sourced from the same `bridge/reviewer-config.json`. This cannot detect an independent default mismatch. Remove that assertion; retain the invalid-prompt cases, using the documented 6,001-character rejection boundary independently of the implementation constant.
- The bridge's exported default-prompt and prompt-limit constants have no production importers. Keep their internal use; remove the unnecessary exports. Shared UI settings exports remain production API.
- Retain default/reset and settings persistence proof in `tests/sidebar-interactions.test.tsx`, legacy-settings migration in `tests/auto-review-policy.test.ts`, and exact custom prompt/model transport in the reviewer suite and `scripts/probe-auto-review.mjs`.
- The private-note case in `tests/auto-review-policy.test.ts` sets `status=published` while `hasUndo=false`. It therefore passes even with the status guard removed. Establish an accepted reversible private-note control first, then add the published status and require rejection. Mutation-check removal of the status guard; restore source exactly afterward.
- `searchTarget` is only used in its own test file; remove its unnecessary export.
- History: the reviewer/policy files are current untracked feature work. Preserve configuration, exact-prompt, isolation, deadline, cancellation, and low-risk security contracts.
- Risk: weakening policy proof or accidentally changing configuration. Run reviewer, policy, and orchestration suites, reviewer protocol probe, typecheck/lint, bridge, and build.

### Worker seam — retained, follow-up only

- `serviceWorkerTestHooks` is imported only by `tests/service-worker.test.ts` and `tests/auto-review-worker.test.ts`. It is a test-only export, but removing it now would erase unique popup adoption, working-tab recovery, permission-resume, cancellation, and restart proof.
- Relevant history includes `43601fa`, `450d87e`, and `ae2e3f7`: unknown-address confirmation, addressless-popup cleanup, and popup-guard hardening. These security regressions are not disposable.
- Do not delete the seam or its tests in this batch. A separate owner refactor should first move all ten worker scenarios to captured runtime/native/Chrome event boundaries, without replacing private hooks with new production injection APIs. That requires its own evidence and validation; cosmetic cleanup does not justify a broad rewrite.

## Results

- Removed the dead attachment formatter, consolidated predicate assertions into actual file-reading behavior, and made four implementation details private. Extended the existing typed-send test to protect actual untrusted text framing alongside the image item and send-once contract.
- Removed the reviewer-default self-comparison and repaired the masked private-note negative control. With the privacy/status guard temporarily removed, the original policy test still passed; the repaired test failed on the published-note assertion. Restored the production owner byte-for-byte, then reran all proof successfully. Mutation reports: `/tmp/browser-control-audit-old-mutation.json` and `/tmp/browser-control-audit-repaired-mutation.json`.
- Audit-only code delta against the preserved working tree: production **+4 / -11 lines** (net -7); tests **+21 / -28 lines** (net -7). Documentation is separate. No test-support helper or new production seam was introduced. Only six existing source/test files changed; this audit report is new.
- Full suite: **209 passed, zero failed, one existing Windows platform skip**. The two-case reduction is the consolidated predicate case and the removed obsolete formatter case; the underlying supported-format and actual-send contracts remain covered.
- Passed `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:bridge`, `npm run test:reviewer`, `npm run build`, and `git diff --check`. The bridge/reviewer probes needed sandbox escalation to bind their synthetic localhost server. They do not send a live user prompt. Refreshed the installed companion with `npm run install:host` and passed `npm run test:installed-host` in the Chrome-like launch environment.

Serial owner execution times (milliseconds, single measurements; not a benchmark):

| Suite | Before | After |
| --- | ---: | ---: |
| Attachment reader | 4.1 | 3.3 |
| Attachment host/input | 37.1 | 37.0 |
| Approval reviewer | 24.2 | 6.2 |
| Automatic-review policy | 8.7 | 6.7 |
| Automatic-review orchestration, retained | 1109.1 | 1105.0 |
| Service worker, retained | 4504.0 | 4416.7 |

The sidebar interaction sibling suite also passed (659.6 ms). No sleeps, timers, polling loops, or additional test cases were added. Small timing differences are noise; this cleanup improves proof quality rather than promising a speedup.

Final self-review inspected the audit-only diff, non-test importers, retained contracts, and the complete working-tree snapshot. The policy owner and extension manifest match their pre-audit bytes. Runtime permissions, CSP, model choices, prompt contents, and file transport are unchanged. No credentials, browsing data, or remote collection were introduced. No commit, PR, release, or publication was created.

There is no dedicated `autoreview` workflow in this repository or exposed toolset; the final review was a self-review, not independent agent approval. Manual Chrome flows were not rerun for this behavior-preserving cleanup. The earlier reviewer/settings/browser validation remains documented in `README.md`; it is not new evidence for this audit. Windows execution remains skipped on this macOS host. The worker-boundary refactor above is a documented follow-up, not claimed as completed work.
