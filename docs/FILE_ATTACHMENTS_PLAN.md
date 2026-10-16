# File attachments: implementation and validation

Date: 2026-10-15. Branch: `feat/file-attachments`. Baseline: `7595794`, preserving existing text attachment and welcome changes. Scope follows PRD Epic I and the user's revised instruction to remove the conversion dependency.

## Supported representation

| Input | Preparation and Codex input |
| --- | --- |
| Text, Markdown, code | Bounded plain text; uploaded HTML/SVG stays inert text |
| PNG, JPEG, WebP, GIF | Local orientation/resize and JPEG normalization; static first frame; typed `localImage` |
| PDF, including scans and diagrams | Packaged PDF.js renders selected pages; page images and available extracted text |
| Word, presentation, other binary files | Declined with export-to-PDF guidance |

No Office installation, container runtime, conversion service, new API key, new Chrome permission, or model filesystem tool is required. The [App Server turn protocol](https://developers.openai.com/codex/app-server/#turns) supports text and image inputs. This implementation prepares those representations rather than introducing the separate Responses API file protocol.

## Implementation

1. **Prepare locally.** `src/sidepanel/attachments/prepare.ts` normalizes images and renders PDFs with a packaged worker/fonts/CMaps/decoder fallback. Evaluation, WASM, XFA, and document scripting are disabled. Selected bytes stay in sidebar memory until Send; embedded links/resources are not fetched. Source files remain unchanged.
2. **Review selection.** The picker, drop, and paste flows show exact transmitted image previews, page ranges, character counts, resizing and truncation notices. PDFs over 20 pages require explicit selection. File-only messages work; selected models must support images when visual content is present.
3. **Transfer bounded assets.** `bridge/uploads.mjs` uses opaque IDs, 192 KiB raw chunks, SHA-256, exact offsets, private directories, signature/dimension checks, quotas, and thread ownership. The native-message cap stays 1 MiB. UI requests contain no caller-selected paths.
4. **Create one turn.** `bridge/chat-input.mjs` separates user instructions from untrusted page/file reference text, resolves owned local images, and records a logical send ID. Repeated acknowledgements reuse the accepted turn; uncertain restart outcomes require review rather than automatic repetition. Attachment URLs never acquire user-instruction provenance.
5. **Retain and cancel.** Stop cancels local preparation/transfer or interrupts a submitted turn. Sent assets survive for 30 days; incomplete uploads expire after 24 hours; cleanup runs on host startup and upload activity. Conversation metadata contains no binary payload. Preview access requires the owning restricted thread; validated forks share only attachments through their selected turn. Delete All Data closes send processing and removes the owned sidebar home.
6. **Package and verify.** Install/release scripts include the upload and chat-input modules. CSP allows only packaged workers/assets and local blob previews. No general shell, filesystem, `view_image`, remote converter, or additional browser grant is enabled.

## Limits

Five files; 8 MiB per source image; 20 MiB per PDF/text file; 40 MiB total source files; 200 discovered PDF pages; 20 selected pages/images per turn. Source images: at most 40 megapixels and 16,384 pixels per edge. Prepared images: at most 2,048 pixels per edge, four megapixels, and 2 MiB each; 32 MiB prepared payload per turn. Text: 24,000 characters per file and 80,000 per turn including user instruction, page context, and labels. Local asset storage: 512 MiB. Dense detail can be lost through resizing; users can inspect the transmitted preview or attach a crop.

## Acceptance checks

- Automated: typecheck, lint, unit tests, bridge smoke test, production build, installed-host smoke test. Host tests cover byte-exact resumable transfer, malformed input, ownership, symlinks, expiry, page/asset mismatches, context limits, send deduplication, cancellation, and restart uncertainty.
- Actual Chrome sidebar: add/remove image, text and Markdown; preview normal and image-only PDFs; select pages from a 22-page document; reject corrupt/encrypted/oversized input and unsupported documents; exercise Stop and file-only send. Ask a visual question whose answer is absent from extracted text, verify the response and both extension consoles. This must traverse the sidebar, service worker, native host and Codex, not direct browser automation of a site.
- Recovery: panel reopen/history preview, fork through a selected turn, failed upload/retry, stale/expired assets and Delete All Data. Test deletion only in a disposable sidebar home.
- Inspect manifest, generated bundle and companion package for permissions, remote executable code, credentials, and obsolete conversion artifacts. No publication or release is authorized.

## Evidence

The conversion implementation, UI path, and runtime/package hooks have been removed. Repository/runtime search found no conversion executable or container dependency. Final typecheck, lint, production build, bridge smoke test and installed-host smoke test passed. Unit tests: 160 passed, one pre-existing skipped. The fake-provider Codex probe confirmed a local image outside the model workspace is forwarded as an image with shell and image-viewing tools disabled; this proves protocol compatibility, not real model understanding.

Chrome validation used macOS and unpacked extension ID `mpdfhhhjgbpdpfnkjbnboebdjokfjglf`, version 0.3.5, in the disposable `/tmp/browser-control-attachments-chrome` profile. The extension loaded and connected to the installed companion. Selecting the synthetic image-only `scan.pdf` reached preparation, but the currently open panel referenced an old hashed PDF chunk after a concurrent rebuild and showed a dynamic-import error. That is not a successful PDF preparation check. The test window was subsequently in active use, so no further composer actions or synthetic uploads were sent. Chrome/OS versions and both DevTools consoles were not captured.

Remaining before end-to-end sign-off: reload the final build; complete the image/text/Markdown/PDF preparation, range, rejection and Stop cases above; send the synthetic visual question through the sidebar with specific confirmation; inspect both consoles; validate transcript preview/fork/recovery and deletion using disposable data. No successful visual-PDF understanding or cross-platform browser validation is claimed.
