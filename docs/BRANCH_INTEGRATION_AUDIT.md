# Branch integration audit

Scope: all 12 local branch heads, all 7 branches returned by GitHub, and remaining local remote-tracking refs. Initial remote main: `22ed870`. Remote refs were fetched before comparison. The other registered worktree (`feat/error-handling`) was clean; no uncommitted work from another checkout was included.

## Findings and integration

Three GitHub branches had commits missing from main. They form one chain: `fix/legacy-companion-chat-text` → `release/0.3.7` → `fix/page-attachment`. Merging the last branch includes all four outstanding commits without replaying or duplicating them:

| Commit | Change |
| --- | --- |
| `0d515a7` | Preserve the legacy native companion's required `chat.send.text`, including explicitly attached page text. |
| `52a3c74` | Prepare 0.3.7 compatibility packaging and setup documentation. |
| `8be8223` | Record the existing 0.3.7 Store submission and desktop CI evidence. |
| `ccc0cf6` | Retain native disconnect errors and add actual Chromium sidebar attachment checks. |

Memory was committed as `6a2b2ec`. Integration merge `d41d58c` combines it with the outstanding chain. The two conflicts were resolved by retaining both browser and memory CI jobs, and preserving both legacy text and new memory metadata in chat sends.

| Branch | Audited tip(s) | State before integration | Integrated result |
| --- | --- | --- | --- |
| `feat/desktop-companion` | `6b22679` (local/GitHub) | Already on main | Contained |
| `feat/error-handling` | `ee8bdf3` (local worktree) | Already on main | Contained |
| `feat/file-attachments` | `7663d51` (local/stale tracking ref) | Already on main; GitHub branch no longer exists | Contained |
| `feat/local-memory` | `6a2b2ec` plus integration/follow-up commits | New memory implementation | Integration source for main |
| `feat/sidebar-skill-discovery` | `ecb0871` (local) | Already on main | Contained |
| `fix/legacy-companion-chat-text` | `0d515a7` (local/GitHub) | Missing | Included through `fix/page-attachment` |
| `fix/page-attachment` | `ccc0cf6` (local/GitHub) | Missing | Merged in `d41d58c` |
| `fix/page-control-security` | `7595794` (local), `d7775fb` (GitHub) | Both already on main | Both contained |
| `fix/skill-recorder` | `fe452bb` (local/GitHub) | Already on main | Contained |
| `release/0.3.6` | `2737ee5` (local) | Already on main | Contained |
| `release/0.3.7` | `8be8223` (local/GitHub) | Missing | Included through `fix/page-attachment` |
| `main` | `22ed870` initially | Target | Fast-forward to the validated integration |

Branch containment is verified with `git merge-base --is-ancestor <branch> <integrated-tip>` for every local and tracking ref. After pushing, compare all current GitHub branch heads against `origin/main` again. A branch can remain visible after merging; visibility is not evidence of missing code. Branches are retained, and no force push or branch deletion is part of this work.

## Why Auto review appeared missing

Auto review was already on main: feature commit `f69e2cf` is an ancestor of the initial main. Model/prompt settings and the organized Settings UI were also merged. The option is under **Settings → Agent → Agent permission**.

The companion allowed only the exact Codex CLI version `0.162.1`. On the installed `0.164.0`, or the previously observed Linux `0.165.0`, it returned `available: false`; the option remained visible but disabled. This was a compatibility gate, not a missing feature branch.

The gate now uses a single verified-version list in `bridge/reviewer-config.json`: `0.162.1`, `0.164.0`, and `0.165.0`. Capability reporting and review execution share it. Unsupported versions still refuse automatic review and explain the detected version in Settings. Capabilities are checked without starting model inference. User confirmation remains the fallback for failed, unavailable, malformed, late, or unsafe reviews. User model/prompt choices, action binding, host permissions and hard refusals are unchanged.

Tests verify real Codex tool isolation and concurrent structured output against a synthetic localhost provider. The HTTP-only tool probe explicitly disables WebSockets, making its transport contract consistent across versions; production transport is unchanged. The [official App Server documentation](https://learn.chatgpt.com/docs/app-server) recommends generating version-specific schemas, so a schema match alone is not treated as proof of model/tool isolation. New versions must pass the reviewer probes before being added.

## Validation and deployment boundaries

Local macOS 27.0.1 ARM64 / Node 20.20.1 checks: typecheck, lint, 255 unit/component/native tests with one Windows-only launcher skip, memory runtime smoke, production build, and the pinned 0.162.1 real-protocol bridge suite passed. New reviewer-capability regressions failed before the fix and passed afterward. Reviewer probes passed on 0.164.0 and 0.165.0 with Luna, Sol, Astra, and an unknown model for tool isolation; concurrent structured-output checks used Luna and Sol. These are synthetic providers, not account entitlement or latency tests.

The actual isolated Chromium sidebar check passed missing-host guidance, Attach → Detach → Attach → Remove, protected-page refusal, and zero sidebar console errors on Chromium 156.0.8078.4. It uses synthetic account transport, a disposable local page/profile, and no chat send. It does not validate signed-in memory personalization or live automatic approvals.

CI retains the full Ubuntu/Windows/macOS checks and Chromium sidebar test, adds Node 20/24 memory runtime checks on all three OSes, and adds 0.164.0/0.165.0 reviewer probes on all three OSes. The final main workflow must pass before claiming those remote results. Native signed-in Linux/Windows sidebar memory and reviewer UI scenarios remain separate manual gates.

A GitHub push does not update the Chrome Web Store build or a running native-host process. Refresh the companion and reload the matching unpacked extension to test source changes; Store publication is a separate release action. No live account chat was sent and no Store publication was performed for this audit.
