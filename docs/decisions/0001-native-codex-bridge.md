# ADR 0001: Native Codex App Server bridge

- Status: Accepted for the development MVP
- Date: 2026-08-20
- Owner: `codex-chrome-extension-manager`

## Decision

Use a Chrome native-messaging host that launches `codex app-server --stdio`. Use App Server's managed `chatgpt` browser authentication for identity and ChatGPT-subscription model access.

The extension ID is pinned to `fodoakcimglhplkoohggjdggdffhkdam` with a public manifest key. The native-host manifest allowlists only that exact extension origin.

## Why

- Codex App Server is the documented rich-client interface for authentication, threads, approvals, and streamed events.
- Its managed ChatGPT mode owns credential persistence and refresh. No reusable credential enters extension memory or `chrome.storage`.
- The native App Server owns the documented localhost browser callback, so the extension only opens the returned `authUrl` and never handles OAuth credentials.
- Native messaging is Chrome's supported extension-to-local-process transport and avoids an unauthenticated loopback server.

## Protocol boundary

The extension may request only:

- bridge status;
- account read;
- managed ChatGPT browser login, cancellation, and logout;
- thread start/resume;
- turn start/interrupt; and
- a response to an App Server dynamic browser-tool request.

The host forwards only normalized authentication, assistant-text delta, turn-completion, tool, warning, and error events. It rejects every App Server-initiated request except the seven declared browser-tab dynamic tools.

Browser tools are independently schema-validated and executed by the service worker. `tabs.group` accepts only existing unpinned tab IDs from one window and uses the typed Chrome Tabs/Tab Groups APIs. `tabs.ungroup` removes grouping without closing tabs. `tabs.close` always pauses for an explicit side-panel confirmation. Only `http` and `https` URLs can be opened.

Current-page attachment first uses temporary `activeTab` access. If that grant is unavailable after a reload or tab change, the side panel offers a separate user-activated permission request for only the current origin. Granted attachment origins are tracked locally and revoked by Clear local data.

## Credential and configuration isolation

The companion runs Codex with `CODEX_HOME=~/.codex-sidebar`, separate from the user's normal Codex configuration. Authentication is completed again inside the product. This prevents unrelated personal MCP servers and Codex configuration from being inherited by sidebar chats.

The Codex thread uses an empty companion-owned workspace, read-only sandboxing, no approvals, and instructions that prohibit shell, filesystem, web, MCP, code-editing, computer-use, and remote-control tools. The extension never approves native command or file requests.

## Installation

The private MVP supports current Chrome on macOS. The installer creates:

- `~/.codex-sidebar/bin/native-host`; and
- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.codex.sidebar.json`.

The host requires Node.js and the Codex CLI. Chrome Web Store distribution and packaged native installers are outside MVP scope.

## Verified feasibility

On 2026-08-20, Codex CLI `0.148.0` was verified locally to:

- initialize App Server over JSONL stdio;
- return managed ChatGPT account state through `account/read`;
- create a restricted thread;
- start a turn; and
- stream assistant output through `item/agentMessage/delta` before `turn/completed`.

The extension build also includes an isolated native-host smoke test that starts App Server with a temporary `CODEX_HOME` and verifies signed-out `account/read` behavior.

## Consequences and follow-ups

- Installation is a two-part flow rather than a Chrome-only install.
- The development integration is pinned and tested against Codex CLI `0.148.0`; protocol compatibility must be checked when upgrading Codex.
- A production package needs signed macOS/Windows installers and upgrade handling.
- A resumed App Server thread must retain its dynamic-tool declarations. Browser testing must verify this across Chrome and companion restarts; otherwise the bridge must recreate a thread from locally retained transcript context.
