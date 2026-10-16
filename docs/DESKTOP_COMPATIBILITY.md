# Desktop compatibility review

Reviewed on 2026-10-16: `a1f35b2`, `f69e2cf`, `9d95e02`, `3313e08`,
`6f1a4d5`, and `75ebb1d` on `feat/file-attachments`.

## Findings and fixes

- **Codex could outlive its native host.** A real-process regression reproduced
  the host exiting while Codex was still alive. The host now waits for bounded
  child shutdown, including Windows' asynchronous process-tree termination.
  Probe clients close stdin and await shutdown before restarting or removing
  temporary data. Force termination remains a bounded fallback.
- **Some probes bypassed the Windows launch resolver.** Reviewer and tool
  probes now use the same resolver as the companion, preserving the Node/script
  prefix for npm `codex.cmd` installations. The bridge smoke check also accepts
  that installation instead of requiring an independently discoverable `.exe`.
- **npm PATH discovery selected a non-executable Windows shim.** The first
  Windows CI run exposed `where.exe` returning npm's extensionless POSIX script
  before `codex.cmd`. The resolver now skips extensionless and PowerShell
  scripts on Windows, continuing to a native `.exe` or a `.cmd` shim that can
  be unwrapped through Node. Three regression cases failed before the repair.
- **A settings test bypassed a disabled option.** The macOS runner exposed a
  test selecting Auto review before companion capabilities were loaded. Tests
  now wait for the option to become enabled, matching native browser behavior.
- **Directory-symlink fixtures required Windows privileges.** Attachment and
  skill tests now use directory junctions on Windows. The real C# launcher test
  skips only on other operating systems; a missing compiler on Windows fails
  visibly. Launcher and native-host fixtures exercise spaces and Unicode paths.
- **Windows has no `O_NOFOLLOW` open flag.** Attachment bytes now receive an
  explicit link check before opening on every platform. POSIX retains the
  additional atomic open guard. The transfer test covers links at both the
  attachment-directory and byte-file boundaries.

The Windows native executable/registry launcher and Linux XDG/POSIX launcher
remain in place. All required attachment, reviewer, and prompt runtime files
are included in both installation and companion packaging. The extracted
archive smoke check starts the packaged host and verifies prompt persistence
with exact CRLF/Unicode bytes, image transfer, and canceled-upload removal.
It uses an isolated temporary home and starts no Codex inference.

Images and visual PDFs are prepared by Chromium using packaged JavaScript,
workers, fonts, and PDF assets. The companion requires only Node built-ins;
Docker, Office, LibreOffice, and a native PDF renderer are not runtime
dependencies. Windows uses inherited profile-directory ACLs; POSIX mode bits
such as `0600` are not Windows ACL enforcement. No Chrome permission was added.

Node file and process behavior was checked against the official
[filesystem documentation](https://nodejs.org/api/fs.html) and
[Windows process documentation](https://nodejs.org/api/process.html#signal-events).

## Automated checks

`.github/workflows/compatibility.yml` runs separately on Ubuntu, Windows, and
macOS with Node 24. It performs a clean dependency install, typecheck, lint,
the full unit/component suite, signed-out native bridge probes using Codex
0.162.1 and a synthetic localhost provider, release packaging, and the extracted
companion check. It needs no account credentials or live model inference and
does not install the companion into the runner's browser profile.

Local verification on macOS ARM64: **216 tests passed, one Windows-only test
skipped**; typecheck, lint, build, native bridge probes, and extracted-package
checks passed. The shutdown regression failed before the fix and passed after
it. Package checks ran in a temporary staging copy, preserving existing release
artifacts. No new browser UI flow was exercised for this review.

The branch has been pushed and the matrix is running. The
[follow-up run at `f7c6cc7`](https://github.com/07rjain/browser-control/actions/runs/38927051769)
passed the complete Linux and macOS jobs; Windows passed all 214 tests,
including the real C# launcher, before its native bridge exposed the PATH
discovery issue above. The resolver repair adds three more cases. Check the
[latest branch CI results](https://github.com/07rjain/browser-control/actions/workflows/compatibility.yml?query=branch%3Afeat%2Ffile-attachments)
for the repaired Windows native bridge and packaged-companion checks.

**Desktop browser integration remains unverified for this review.** Earlier
Windows validation of the baseline does not validate the newer attachment,
reviewer, or Settings features. A passing CI run is not a substitute for the
desktop checks below. ARM64 Windows/Linux and alternate Linux packaging need
their own environment checks.

## Desktop acceptance checklist

Use this branch's matching extension and freshly installed companion. Follow
the existing [Windows/Linux setup guide](INSTALL_WINDOWS_LINUX.md); use a normal
desktop Chrome or Brave installation, not Snap/Flatpak Chromium.

1. Run `npm run install:host` and `npm run test:installed-host` as the browser's
   own user. Record OS, architecture, browser, Node, Codex, and commit versions.
2. Load `dist/` unpacked, confirm ID `mpdfhhhjgbpdpfnkjbnboebdjokfjglf`, and verify
   connection, sign-in, restart, and reconnection. Check both extension consoles.
3. Prepare PNG/JPEG/WebP/GIF, `.txt`/Markdown with non-ASCII names and CRLF, a
   scanned PDF, and a text PDF. Verify page ranges, previews, text, limits,
   cancellation, and unsupported Office/slide format guidance.
4. Test Attach → Detach → Attach; model visibility; all Settings sections;
   keyboard focus/Close/Escape; exact main and reviewer prompt Save/Reset and
   draft retention; new-chat versus existing-chat prompt behavior.
5. With a fresh, specific confirmation for each synthetic test send, verify
   image/PDF understanding, streaming/running border, one changing activity row,
   the ten-second completion notice, Auto review, human fallback, and Stop.
6. Close/reopen the panel and restart the browser. Check prompt/attachment
   persistence and that a stopped native host leaves no Codex child holding
   its profile files. Test data deletion only in a disposable profile after
   specific approval.

Record actual observations and errors. Do not describe any unrun item as passed.
