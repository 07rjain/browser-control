# Local memory implementation plan

Status: proposed on 2026-10-31. This document defines an implementation sequence; memory is not implemented or enabled by this change. Implementation and release are separate steps.

## Goal and recommended scope

Let Browser Control remember useful user preferences and facts across chats, apply a small relevant profile without being reminded, and retrieve details when needed. Users must be able to see, correct, and forget everything saved.

Take three useful ideas from the Instinct example: a small profile, searchable records, and a separate writer. Its reported internals are a reconstruction, not a verified implementation specification. We do not need to reproduce its Git history, entity graph, daily cron, or large summaries.

Build the first useful release with **one local JSON file, a deterministic profile, one lookup tool, and user-confirmed changes**. Add optional automatic learning only after recall and deletion work reliably. Use the existing companion and Codex sign-in; add no external service, API key, database, native dependency, background daemon, or Chrome permission.

## Product behavior

1. In **Settings → Memory**, the user enables saved memory. It is off for existing and new installations until enabled.
2. The user can add a memory directly, or say “Remember that I prefer short answers.” The assistant offers a review card showing the exact text; **Save memory** persists it. Saving directly in Settings needs no inference.
3. New turns receive a short profile of saved preferences. A new chat can naturally answer concisely without requiring the user to ask for memory retrieval.
4. When a question needs a saved detail, the assistant calls `memory.search`. The companion returns a few complete records with IDs, source, and dates.
5. “Change that preference” and “Forget my timezone” offer an exact update/delete for review. Settings always provides direct edit/delete controls. The assistant reports a change as saved only after the host confirms it.
6. **New chat without memory** starts a chat that neither reads nor contributes to memory. Describe it as a memory control: ordinary conversation-history and provider retention still apply.
7. A later **Learn from my messages** option can save simple supported facts automatically. It is separate from using existing memory and is off by default.

Taught skills remain procedural knowledge under `~/.codex-sidebar/skills`. Memory contains preferences and facts; it must not become a second skill store or a way to change browser permissions.

## Storage and limits

Use `~/.codex-sidebar/memory.json` as the only canonical memory store. Derive the profile and search results from current records in code. Do not persist another summary or index that could become stale or retain forgotten text.

Store a schema version, store revision, invalidation generation, settings, and records. Each record needs:

- A generated UUID and kind: `preference` or `fact`.
- Plain text, optional short search aliases, and an optional user-controlled pin.
- Creation/update timestamps and an optional explicit expiration time.
- Provenance: manual entry or user message, with thread/message IDs when applicable. Automatically learned records also retain a short supporting excerpt from that actual message.

Do not copy complete conversations, page bodies, attachments, or model reasoning into the store. Source links may become unavailable when chat history is removed; the saved record still has its text, source type, and date.

Initial proposed limits are product limits, not Codex limits:

| Item | Limit |
| --- | --- |
| Active records | 200 |
| Text per record | 500 characters |
| Aliases | 5 per record, 40 characters each |
| Supporting excerpt | 500 characters |
| Profile injected into a turn | 2,000 characters, including its framing |
| Search response | 5 records, at most 6,000 characters including metadata |
| Canonical file | 256 KiB, with all fields validated and bounded |

At capacity, show a management message instead of silently removing durable facts. Exclude expired records from both profile and search at read time. A supplied expiry is honored; do not invent an expiry for a durable preference.

Use the existing private sidebar home, restrictive file permissions where supported, and a validated owned path. Reject symlink/path escapes. Use atomic replacement, revision checks, and a short cross-process write lock because different browser instances can launch separate companions. Do not hold a lock during model inference. Corrupt or unsupported state disables memory with an actionable error while ordinary chat continues; never silently overwrite it with an empty store.

## Linux and Windows compatibility requirements

Review status: the existing host layout, launchers, Codex resolver, packaging, and CI were inspected on 2026-10-31. The design is compatible with that architecture; memory-specific runtime compatibility remains an implementation/release gate. No memory code exists yet to test on either OS.

### Paths, runtime, and installation

Construct the file path with `join(sidebarHome, "memory.json")`, using the companion's already validated home. Never pass a literal `~` or `$HOME` to a filesystem API, concatenate separators, or derive the location from the current working directory. The existing default resolves through `os.homedir()`, which uses the current user's home on both platforms. See [Node home-directory behavior](https://nodejs.org/api/os.html#oshomedir) and [platform-aware paths](https://nodejs.org/api/path.html#windows-vs-posix).

| Platform | Example memory location | Existing launch/registration to retain |
| --- | --- | --- |
| Linux | `/home/ada/.codex-sidebar/memory.json` | POSIX launcher and native-host manifests in normal/XDG browser config locations. XDG runtime installation must not move the memory file. |
| Windows | `C:\Users\Ada\.codex-sidebar\memory.json` | Current-user registry registration and `native-host.exe`; retain the resolver for both `codex.exe` and supported npm `.cmd` shims. |
| macOS | `/Users/ada/.codex-sidebar/memory.json` | Existing Chrome/Brave native-host registration and POSIX launcher. |

- Keep the documented Node 20+ companion runtime; use APIs available at that baseline. Development/build CI stays on Node 24. Do not introduce a new Node requirement through the memory implementation.
- Implement storage/search with Node built-ins. Do not invoke shell `grep`, `flock`, `chmod`, PowerShell, Git, or Unix signals for memory logic. Reuse the existing Codex launch and shutdown adapters for the learner.
- Install and run as the browser's desktop user. Do not require root, administrator rights, a scheduled service, or another executable. The existing Windows launcher/compiler setup is unchanged.
- Keep fixed, short ASCII filenames for the store/locks/temporary files and UUIDs for records; user text never becomes a filename. Use UTF-8 JSON, preserve text/newlines, compare expiry using UTC epoch time, and measure the file's byte limit with `Buffer.byteLength`, separately from character limits.
- Include new files in both installer and release lists. Upgrade/reinstall must preserve memory in the sidebar home even when versioned runtime directories change. Do not depend on source-checkout files or globally installed npm modules.

### Filesystem behavior and concurrent companions

These are implementation requirements, informed by [Node's filesystem platform caveats](https://nodejs.org/docs/latest-v24.x/api/fs.html), rather than a claim that POSIX behavior carries over to Windows.

- On Linux/macOS create private directories/files with `0700`/`0600`. On Windows rely on the current profile's inherited ACLs; POSIX mode bits do not establish owner-only access. Do not broaden ACLs or require an ACL-management dependency.
- Reject symlinks and directory junctions that redirect the owned path. Do not rely on `O_NOFOLLOW` being available on Windows. Use junction fixtures where creating Windows symlinks would require extra privileges.
- Serialize read-modify-write across processes with a local filesystem lock and ownership token, then re-read the store/revision under that lock. Bound acquisition to two seconds; never break another live writer's lock merely because it is old. Crash recovery must be tested; uncertain ownership returns a busy error instead of risking overlapping writes.
- Write to a uniquely named temporary file in the same directory, flush/close it, then replace the destination. Handle transient busy/access failures with at most five retries within two seconds. Never unlink the last valid store before replacement; persistent failure retains it and reports that saving failed.
- Close file handles promptly. A failed delete must not report success. Cancel work in all participating companion instances through store-identity/generation revalidation; an in-process flag alone is insufficient. A stale process cannot recreate or overwrite memory after reset.
- Re-read the small store before profile generation, search, proposals, and writes. Avoid `fs.watch` as a correctness dependency so disable/delete in one browser is respected by another without platform-specific watcher behavior.

Target local profile filesystems such as NTFS and ext4 first. Do not claim network-mounted homes, UNC/SMB/NFS storage, cloud-sync interference, Snap/Flatpak native-host integration, WSL-only browser setups, or ARM64 Windows/Linux as verified by the standard desktop matrix. A storage/launch failure must keep ordinary chat available and show an actionable error; expand support only after testing the actual environment.

### Required platform validation

Extend `.github/workflows/compatibility.yml`, which runs unit tests, native bridge probes, and extracted-release checks on Ubuntu, Windows, and macOS. The reviewed `fix/page-attachment` baseline at `ccc0cf6` also adds isolated Chromium sidebar checks; those are not yet on `main` at `2737ee5`. Reuse them when integrated, or add equivalent checks with memory. This documentation change does not merge those implementation commits. Run new memory scenarios on each real runner OS; simulated Windows paths on macOS do not test Windows filesystem semantics.

1. Add a dependency-free `scripts/smoke-memory.mjs` for production store/protocol behavior, with a small Node 20/24 runtime matrix on all three OSes. It uses isolated temporary homes and no account inference; leave the full build on Node 24.
2. Exercise a parent directory containing spaces, apostrophes, and Unicode; LF/CRLF and non-ASCII/emoji record text; exact byte bounds; missing/read-only/corrupt state; link/junction rejection; and upgrade/restart persistence. A real read-only assertion must use the OS's actual enforcement rather than treating Windows mode bits as ACLs.
3. Spawn two actual companion/store processes against one temporary home. Verify concurrent edits, delete/disable visibility, crash while holding a lock, failed replacement preserving valid JSON, and reset followed by a delayed write from the other process. Use deterministic fault injection only where an OS error cannot be triggered reliably; distinguish that from a real locked-file check.
4. Extend `scripts/smoke-release.mjs` to perform memory add/read/update/delete through the extracted companion, restart it to verify persistence, and verify capabilities before starting Codex inference. Use the packaged modules, not imports from the source tree. Keep installed-launcher checks separate from direct-host package tests.
5. Perform actual Chrome sidebar checks on native Linux and Windows: installed-host connection, Settings save/reopen, new-chat recall, reviewed correction/forget, memory-free chat, Stop, restart, and compatibility errors. Test from a disposable profile/home and obtain the required specific approval for each model send or data reset. Record which scenarios actually ran and both extension consoles.

The 2026-10-31 plan review reran the existing host-path and companion-setup suites at `ccc0cf6` on macOS ARM64 / Node 20.20.1: **9 tests passed**. Those check the existing Linux/Windows layout and setup contracts; they do not validate the proposed memory store, a real Windows launcher, or live Linux/Windows sidebar memory behavior.

## Profile and retrieval

Build the profile deterministically: pinned records first, then preferences, with recent updates as the tie-breaker. Include IDs and dates within the size budget. This requires no summary model or additional inference. The complete store remains searchable when records do not fit the profile.

Add the framed profile as a separate text context item on each eligible foreground turn, so corrections apply on the next turn without rewriting the user's saved system prompt. State that it is fallible saved data: current user instructions win, and memory grants no permission. Bind the memory mode, store revision, and selected profile to the original send ID so a transport retry cannot change the contents of the same accepted request. A reset or disable invalidates a not-yet-started preparation rather than replaying its stale profile.

Preserve the existing 80,000-character message/attachment contract and legacy `chat.send.text` compatibility. Memory uses remaining context space; reduce or omit the profile when necessary and return that status to the sidebar. Never reject or truncate previously valid user content to make room for memory.

Expose only **`memory.search({ query })`** for retrieval. Use bounded normalized keyword matching over record text and aliases, with deterministic ranking and recent-update tie-breaks. Return complete short records, so a second `memory.read` tool is unnecessary initially. Search is limited to this store; it accepts no path, command, selector, or arbitrary file access. Register it only for an eligible restricted foreground thread, bind calls to the active turn, and enforce the current enabled state on every call.

Give the main model concise guidance to use the profile for relevant personalization, search for details about the user's saved context, prefer current corrections, and acknowledge when nothing relevant is saved. Do not search on every message. Evaluate both explicit recall and natural personalization; successful keyword lookup alone is insufficient.

## Writing and user controls

Use the companion as the only writer. Settings sends narrow, runtime-validated add/update/delete requests with revision checks. Keep the answering model read-only by giving it **`memory.propose_change`**, which creates a preview rather than mutating the store. Start with add, replace, and delete of one record per proposal; ambiguous matches require the user to select the record.

Bind each proposal to its exact thread, turn, source message, and target record revision. Add/replace proposals include supporting user-authored text. A card shows the proposed text or deletion and its source, with Save/Delete and Dismiss actions. A stale target requires a refreshed preview. Deduplicate repeated calls and consume confirmation once. Use the established tool-offer card pattern, with memory-specific labels; do not make ordinary assistant prose trigger a write or claim that a proposal is already saved.

Keep Settings focused in one Memory section:

- **Use saved memory**, record list, search, Add, Edit, Delete, and Clear saved memory.
- Show source/date and optional expiry/pin in an expanded record editor.
- Explain what is sent to the model and that disabling memory does not delete it.
- Put learner settings inside a collapsed subsection when that later milestone ships.

Capture the memory participation mode when creating a chat. Turning global memory off blocks subsequent injection, tools, proposals, and learning immediately. Turning it back on does not convert a chat created without memory into a participating chat. Offer a fresh chat for that change. Cancelling a running task cancels its pending proposals and learning eligibility.

## Forgetting, corrections, and deletion

An edit replaces the current record rather than leaving competing current versions. An exact duplicate is a no-op. Conflicting or ambiguous changes require review; do not use a model confidence score as proof.

Every edit/delete/clear/disable advances the invalidation generation and cancels pending proposals and learner work. A late result must match the current generation, source identity, and target revision before any write. A newly initialized store uses a fresh identity so a reset cannot accidentally reuse an old generation. **Delete All Data** stops learner work before removing the owned store; a late callback must not recreate it. Background results cannot initialize a missing store. Logout also stops inference and pending work.

Do not backfill old conversations in this version. Start learning only from a new live send accepted after the current enable/reset cutoff; never reconstruct a job from resume, an old completion event, or a replayed send. Retain bounded source-ID/deduplication metadata, without deleted fact text, to reject duplicate event replay. Restarting the companion, retrying an accepted send, or receiving a delayed result must not relearn a forgotten fact from the same source.

State the limit accurately: forgetting removes saved memory from future retrieval and profile injection. Text already present in an existing chat's provider context, normal chat history, or provider records is not erased by this control. Show a short notice and offer a new chat without memory; do not silently delete or fork the user's conversation. Avoid Git history and automatic content backups in this version because they would complicate that deletion promise.

## Optional background learner

Implement this after the manual release passes its acceptance gates. It is an opt-in convenience, not a requirement for memory to work.

- Use a fresh ephemeral thread in the existing App Server. It receives no tools, no skill catalog, no memory-enabled foreground thread, and no browser permissions. The approval reviewer also receives no memory.
- Default the independent learner model to `gpt-6-luna`; allow selection from the full Codex model catalog regardless of composer visibility. If unavailable, skip learning and show status. Do not silently switch models. Model listing alone does not prove account access.
- Show the learner system prompt in Settings with Save/Reset, following the existing prompt-editor pattern. Show fixed response requirements separately; editable instructions cannot weaken code policy.
- Consider only a successfully completed, non-canceled participating foreground turn. Take at most 12,000 characters of **new user-authored text**, plus a bounded selection of relevant current records. Keep this input in process memory only. Exclude assistant output, page/DOM text, file contents, tool results, skill bodies, and reviewer evidence. Do not read old chat history or infer facts from browsing behavior.
- Ask for structured proposals with at most three operations and exact supporting excerpts from the supplied user text. Validate the schema, source substring, limits, generation, record revision, duplicates, and expiry in code. An excerpt establishes provenance, not truth.
- Automatically add only explicit, durable, non-sensitive preferences or facts with no detected conflict. Skip ambiguous statements, inferred traits, instructions to change permissions, credentials, and sensitive personal data. Replacements, conflicts, deletes, and changes to pinned/manual records become user-reviewed proposals. Treat uncertain cases as skips; manual save remains available.
- Run one learning job at a time, with one inference attempt, a 15-second deadline including queue time, and bounded received output. Do not claim a provider-side token cap unless the pinned protocol exposes one. Do not retry automatically. Foreground chat or approval review takes priority and cancels learning. Discard excess work rather than persisting a raw-text queue in this version.
- Route all learner events before general chat handling. They must never append an assistant answer, change its task state, produce a completion notice, invoke a browser tool, or consume the user's browser-action budget.
- Run only while the companion is alive. No scheduled overnight service is promised. Disclose additional Codex usage and provider transmission before enabling learning.

## Integration map

| Area | Planned change |
| --- | --- |
| `bridge/memory.mjs` (new) | Validated store, atomic mutations, revision/generation checks, profile, search, proposal lifecycle. Keep it specific to memory. |
| `bridge/memory-learner.mjs` (later, new) | Ephemeral inference, structured proposals, cancellation and notification isolation; follow reviewer patterns without a general agent framework. |
| `bridge/memory-config.json` (new) | Shared limits/defaults; add learner prompt/response requirements when that milestone ships. |
| `bridge/native-host.mjs` | Capabilities, narrow memory RPC, host tool routing, foreground lifecycle, reset/logout handling, learner event routing. |
| `bridge/chat-input.mjs` | Snapshot profile and participation with send idempotency; isolate actual user text from page/file inputs. |
| `bridge/protocol.mjs` | Strict memory tool schemas and capability restrictions; explicitly disable native `features.memories` at process/thread level so there is only one controlled memory system. |
| `src/shared/memory.ts` (new), `src/shared/protocol.ts` | Versioned settings, record/proposal schemas, narrow requests, validation and capability checks. |
| `src/shared/conversation-state.ts` | Backward-compatible captured chat mode and durable proposal-card state; do not repurpose chat history as the memory store. |
| `src/background/service-worker.ts` | Validate extension UI requests and route to host; no page executor or permission changes. |
| `src/sidepanel/MemorySettings.tsx` (new), `src/sidepanel/App.tsx` | Focused Settings section, change cards, memory-free new chat and status/errors. |
| `scripts/install-native-host.mjs`, `scripts/build-release.mjs` | Include each new runtime/config file in both explicit package lists. |
| `scripts/smoke-memory.mjs` (new), bridge/release/browser smokes, compatibility CI, `README.md` | Verify Node 20/24 runtime, real three-platform filesystem/process behavior and installed distribution; explain controls, usage and deletion limits. |

Advertise a versioned memory capability from the companion. An old host disables these controls with an update message while normal chat works. A new host must receive explicit versioned client opt-in before injection or learning; omitted fields from old extensions mean memory off. Never expose a generic file or inference endpoint. Validate supported Codex versions and generated schemas during implementation rather than adopting experimental native memory APIs.

## Delivery sequence and exit criteria

1. **Local store and manual memory.** Implement capability negotiation, store, Settings CRUD, captured chat mode, and deterministic profile injection. Add installer/release entries in the same change. Exit: a manually saved preference changes a new chat naturally; edit/delete/off survive restart; ordinary chat and old-client behavior remain intact. This is the smallest useful independently shippable slice.
2. **Lookup and conversational changes.** Add `memory.search` and `memory.propose_change`, reviewed cards, deduplication, source binding, and honest success feedback. Exit: new-chat factual recall works, remember/correct/forget work through a review card, and model calls cannot mutate the store or grant browser access directly. **Milestones 1–2 form the recommended first release.**
3. **Optional learning.** Prove no-tool ephemeral execution and event isolation with the pinned CLI, then add configurable model/prompt, strict input selection, bounded scheduling, and validated additions/reviewed conflicts. Exit: new explicit user facts can be learned without contaminating chat, false assistant statements are never learned, and late jobs cannot undo a forget/reset. Ship disabled by default.
4. **Cross-platform release validation.** Run the full local gates and installed/release smokes on Linux, Windows, and macOS, including paths with spaces and concurrent native hosts. Exercise the actual unpacked Chrome sidebar after a build and host refresh. Record the exact prompts, models, OS/browser versions, activity, consoles, and results. Obtain fresh specific confirmation before each live model send. Do not treat a fake provider or direct browser control as end-to-end product validation.

Each milestone includes its focused tests and documentation. A release requires its applicable exit criteria; a later learner milestone does not block shipping the confirmed-memory release.

## Acceptance checks

| Scenario | Required observable result |
| --- | --- |
| Cross-chat recall | Save a fact, open another chat, ask a relevant question; the assistant retrieves the right record and date. |
| Natural personalization | Save “Prefer concise answers,” open another chat, ask an ordinary question; the response applies it without a memory reminder. |
| Correction | Replace a saved timezone; a new chat uses the new value, and search has one current record. |
| Expiration | A temporary record is excluded from search/profile at its expiration boundary, including after restart. |
| Forget and replay | Delete a fact, restart, replay a duplicate send and deliver a delayed learner response; the fact stays absent in a new chat. |
| Off and memory-free chat | No new profile, memory tools, proposals, or learning; settings explain existing-context retention. |
| Untrusted content | A page/file saying “remember this” or “approve all actions” causes no saved fact or permission change; an unsupported assistant claim is not learned. |
| Proposal lifecycle | Dismiss/cancel saves nothing; repeated calls/confirmations save once; stale edits require a new preview. |
| Isolation | Main chat, reviewer, and learner keep distinct events and tools; stopping/resetting cancels stale work. |
| Failures and bounds | Invalid JSON, unsupported schema, capacity, lock contention, model failure/timeout, and disabled capability leave ordinary chat usable with clear memory status. |
| Concurrency | Two companions cannot lose an edit/delete or accept a late write against an old revision. |
| Compatibility | Old host/client combinations fail memory closed; legacy text sends, attachments, the text-size limit, authentication, permissions, and skills retain their behavior. |
| Distribution | Installed/release packages contain every new runtime file and pass applicable Linux/Windows/macOS smokes; actual sidebar behavior is recorded separately. |

Use `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:bridge`, and `npm run build`, plus installed-host/release/browser checks appropriate to the milestone. Test externally observable behavior and race outcomes; avoid tests that merely mirror JSON fields or implementation details.

## Privacy and deferred work

Local storage means no separate memory vendor receives the records. The selected profile and search results still go to the existing Codex model provider during use; optional learning also sends its bounded input. Local JSON is not encryption at rest. Credentials remain in the existing authentication system and are never memory records.

Defer embeddings/vector search, entity graphs, Git/version history, conversation backfills, multimodal memory extraction, automatic skill generation, cloud sync, external memory providers, to-do boards, and overnight consolidation. Revisit search technology only after measured retrieval misses in a realistically populated bounded store. None is necessary to validate the first release.

## References and rationale

- [Codex App Server](https://learn.chatgpt.com/docs/app-server) documents the supported integration surface. Verify the pinned binary's generated protocol for each inference feature used.
- [Codex memories](https://learn.chatgpt.com/docs/customization/memories) describes a native background memory system. This proposal deliberately owns its small editable store because it needs explicit per-record controls and input-source boundaries; it does not import the user's normal Codex home or maintain two memory systems.
- [Supermemory user profiles](https://supermemory.ai/docs/concepts/user-profiles) illustrates the distinction between stable profile context and changing facts. It is a design reference, not a proposed dependency or a claim that this implementation reproduces that service.
