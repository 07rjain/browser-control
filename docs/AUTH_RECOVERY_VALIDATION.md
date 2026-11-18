# ChatGPT session recovery validation

Validated on 2026-11-18 from `main` base `144034c` plus the
`fix/reauthenticate-revoked-session` changes. The development extension still
reports 0.3.12; this document does not claim a new Store release.

## PR review evidence

A fresh verification run on 2026-11-18 passed all commands below. The application
code is unchanged from `5e2b452124784b2b5d38484ec9336310e85e0c41`;
the follow-up adds screenshot capture hooks and these evidence files.

- [Actual local command output](evidence/auth-recovery/test-results.txt).
- [All 18 CI jobs passed](https://github.com/07rjain/browser-control/actions/runs/44218556780)
  on the implementation revision above; [saved job results](evidence/auth-recovery/ci-results.json).
- [Recovery prompt and the reported revoked-token error](evidence/auth-recovery/sign-in-recovery.png).
- [Pending ChatGPT sign-in](evidence/auth-recovery/sign-in-pending.png).
- [Composer restored with its unsent draft](evidence/auth-recovery/draft-restored.png).
- [Existing memory still available after recovery](evidence/auth-recovery/memory-retained.png).

Reproduce with `npm run build`, then
`npm run test:browser -- --screenshots-dir /tmp/browser-control-pr6-evidence`.
The screenshot option captures each recovery stage, and browser-test output
records the explicit logout/login/page-open sequence. Screenshots use a disposable
profile and synthetic account, with no real credentials or OAuth completion.

## Automated checks

- Typecheck, ESLint, and production build passed.
- 348 tests passed, with one existing platform-specific skip. Recovery tests cover
  account-read failures, rejected sends, error notifications, failed completed
  turns, cached/late account responses, duplicate clicks, logout/login failures,
  canceled/failed login completion, and an old send accepted after a fresh login.
- The real signed-out native bridge probes passed with Codex CLI 0.169.1 and
  Node.js 26.13.1 on Linux. These use temporary homes and synthetic local providers.

## Packaged browser check

`npm run test:browser -- --screenshots-dir /tmp/browser-control-auth-recovery`
passed in Chromium 156.0.8078.4 on Linux, using the actual built side panel,
service worker, production message validation, and fixed extension ID
`mpdfhhhjgbpdpfnkjbnboebdjokfjglf`. Only the native account boundary was simulated;
the installed companion and the user's account were not used.

The scenario emitted the reported revoked-refresh-token error from an account
check and verified:

1. The UI offered **Sign in again**, kept the companion marked connected, and
   did not prescribe installing it or retrying the invalid token.
2. Nothing logged out until the button was clicked. The worker then called
   `auth.logout`, `auth.login`, and the external-page opener in that order. The
   fixture intercepted the URL so no real login page or OAuth request was opened.
3. A logout account-update event did not interrupt the pending login flow.
4. A simulated successful login restored the unsent draft. Local saved data was
   unchanged, the existing memory record was still readable, and no chat replay
   occurred.
5. The recovery layout did not overflow the narrow sidebar, the button became
   visible after its entrance animation, and its touch target was at least 44px.
6. Existing missing-host, page attachment, protected-page, Settings, Auto review,
   memory, and incognito checks still passed. The sidebar reported zero console
   errors or uncaught exceptions.

`sign-in-recovery.png` was captured in the directory above and visually inspected.
No live OAuth completion, real token revocation, signed-in model request, or
manual macOS/Windows browser session was exercised. Their existing CI gates
remain unchanged. No Chrome permissions, credential storage, companion protocol,
or data collection were added.
