# Auto reviewer implementation plan

Status: initial implementation added locally on 2026-10-16; automated and Chrome validation are recorded in README.md.

Add **Auto review** beside **Ask every time** and **Full access**. Use `gpt-6-luna` by default to approve eligible actions that match the user's request, and send risky, unclear, or failed reviews to the existing user approval card. The main chat model remains independent. This reviewer covers the extension's allowlisted `tabs.*` and `page.*` actions; shell commands, arbitrary JavaScript, connectors, and additional browser tools remain outside scope.

## Behavior and boundaries

- **Ask every time:** preserve today's confirmation behavior.
- **Auto review:** preserve routine actions already allowed by code; review eligible confirmation requests with the selected model (Luna by default); ask the user when policy requires a person or the reviewer cannot approve.
- **Full access:** preserve today's supported automatic execution and hard refusals.

Keep existing installations on their current setting. Selecting Auto review is an explicit Settings gesture, with the explanation: “Let the reviewer approve routine actions that match your request. Risky or unclear actions still ask you. Reviews use additional Codex usage.” It does not change the main model or enable new browser permissions.

Auto review initially uses Ask every time's remembered exact-origin access. Chrome permission dialogs, new site access, and the extension's confirmations for unknown `tabs.open` destinations remain user decisions. The reviewer cannot grant site access, enable Full access, or turn a URL from a page/file/model explanation into a user-authorized destination. Existing purchase, financial, secret-entry, sensitive-form, protected-page, and unsupported-action refusals remain enforced before any model review.

Ask every time already allows ordinary inspect, navigation, field editing, scrolling, and similar actions. Most remaining cards involve potential side effects. The first release should measure reductions among eligible cards, rather than promise to approve most cards regardless of their consequence.

## Codex compatibility

OpenAI documents a native `approvals_reviewer = "auto_review"` setting. It handles eligible Codex approval requests and requires an interactive approval policy. Our companion sets native `approvalPolicy: "never"`, disables native execution capabilities, and creates browser approval cards in the service worker after `item/tool/call`. Changing the native setting alone would not implement review of these extension cards. Preserve the native restrictions and add review at the service worker's existing confirmation boundary. See [Codex Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review) and [App Server](https://developers.openai.com/codex/app-server/).

The installed CLI is `0.162.1`. Its generated protocol schema includes `thread/start.ephemeral`, per-thread model/instructions/configuration, and `turn/start.outputSchema` plus reasoning effort. These are sufficient protocol building blocks for an isolated review turn; real concurrency, tool isolation, model access, and latency remain compatibility gates in milestone 1. `review/start` is not the browser-authorization integration point.

`gpt-6-luna` supports structured outputs and is documented as an efficient model for focused workloads. Use this exact model by default, with low reasoning effort as an initial benchmark candidate. Evaluate medium effort before choosing the shipped setting. Availability in `model/list` is a catalog signal; a completed inference request must establish access. Existing ChatGPT-managed Codex authentication remains the proposed route, without adding an API key or changing OAuth. API token prices do not establish this account's Codex usage rates or entitlement. See [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) and [App Server model listing](https://developers.openai.com/codex/app-server/#list-models-modellist).

## Decision flow

1. Validate the existing typed call, task state, working tab, origin grant, action budget, and hard policy. Invalid or forbidden requests never reach the reviewer.
2. Execute an already-permitted routine action through the existing path. This avoids a model call for every click or keystroke.
3. For a confirmation request, classify whether review is eligible. Requests requiring a person go straight to the existing card.
4. Persist one pending review for the exact call, build bounded evidence, and request a separate review with the task-captured model and prompt. Keep the original browser call paused.
5. Accept only a valid structured approval that meets the code-enforced eligibility rules. Any ambiguity, missing context, unsupported output, timeout, model error, or exhausted review budget creates the normal user approval card.
6. Immediately before execution, revalidate the task, page/target/form and exact reviewed arguments. Any change invalidates approval. Execute once through the same action-budget and idempotency path used after human confirmation.

### Eligible actions and escalation

Initial candidates are clearly requested, bounded actions with adequate evidence: a benign search-form submission matching the user's query, saving a non-sensitive preference or draft, a reversible private record creation/edit with exact requested values and verified absence of invitations/public visibility, or closing a disposable task-created tab where the available evidence establishes no editable/unsaved work. Code must establish the category and required evidence; a button label such as “Save,” HTTP GET, or a model's claim that an action is reversible is insufficient by itself. Unknown categories, unverified privacy/reversibility and unverified unsaved state ask the user.

Always ask a person for deletion or other potentially irreversible loss, public publication, messages/invitations to other people, bookings or contractual commitments, account/security/access changes, sensitive data disclosure, unexpected destinations, and ambiguous changes to external records. Hard-forbidden actions stay refused rather than becoming overridable cards. Add each supported category only after its evidence extraction and evaluation pass; do not approximate a private-record decision using a generic Save-button label.

This initial boundary deliberately favors escalation for external communications. It can be broadened through explicit product decisions and measured cases, without treating the reviewer's self-reported confidence as permission.

## Review input and output

Build the evidence in trusted code. Include the actual user instruction and relevant user-authored clarifications, the proposed namespace/tool and validated arguments, working-tab binding, target role/label/destination, necessary non-sensitive form fields, and the applicable policy version. Extend the packaged executor's bounded target description with necessary associated form/dialog evidence for supported categories; if it cannot establish recipient, visibility, exact changes or reversibility where required, that category remains human-only. Do not add arbitrary selectors or model-supplied extraction code. The current task state does not retain the actual user instruction, so add a bounded trusted request record when processing `CHAT_SEND` and bind it to the accepted turn. Do not substitute a summary supplied by the acting model.

Keep user instructions separate from page DOM, file text, tool results, and the acting model's explanation. Those sources are untrusted evidence and cannot authorize the action. Do not send the full conversation, attached documents, hidden reasoning, cookies, tokens, password values, or unrelated DOM. If redaction, truncation, an inspect cap, or omitted context removes facts necessary to decide, ask the user.

Start with an 8,000-character review evidence budget and a 2 KiB final-result limit. These are proposed application limits, not Codex protocol limits. Keep raw binding hashes in code even when a value is redacted from the model input; redact destinations only when doing so still permits a valid decision, otherwise escalate.

Constrain the final response with `outputSchema`, then independently validate it in the companion and service worker:

```json
{
  "decision": "approve",
  "risk": "low",
  "matchesUserRequest": true,
  "missingContext": false,
  "reasonCode": "requested_benign_search",
  "reason": "The search matches the user's requested query on the approved site."
}
```

Allow only `approve` or `ask_user`; risk and reason codes use fixed enums, strings have length limits, and unknown properties are rejected. Only an eligible low-risk result with matching intent and complete context can automatically approve in the initial release. All other results ask the user. Host-generated identifiers bind the response to its pending review; echoed model IDs are not authority. A model recommendation cannot override a code refusal. Do not silently reject an otherwise supported user request because the reviewer is unavailable.

## Reviewer execution and lifecycle

Implement `bridge/approval-reviewer.mjs` as a companion-owned inference service. Create a fresh ephemeral review thread for each distinct request in the existing App Server, with independent instructions and the selected reviewer model. Do not fork the acting thread, inherit its taught skills, register browser/skill tools, or change the acting thread's model. Apply the verified native tool restrictions and reject every server-initiated reviewer tool/permission request. If the binary cannot provide a reviewer with no executable capabilities, leave Auto review unavailable and retain human confirmation.

Route reviewer thread/turn/item notifications to the review service before the current general notification handler. Reviewer deltas, completion, errors, and requests must never appear as the main assistant response, reset its active turn, complete its browser task, select a skill, or become a browser tool call. Register the review thread before starting its turn. Unexpected reviewer tool use terminates review and escalates.

Prove that the current App Server can review in a second thread while the acting thread waits for a dynamic tool result. If that fails, stop the compatibility milestone and revise transport isolation; do not enable native tools or migrate authentication as a workaround. Do not introduce a second process or a new authentication route without updating the architecture decision.

Use a 10-second review deadline including queue time, one active review initially, and no inference retries for a single candidate. Limit automatic reviews to the smaller of 20 per user request or the captured browser-action budget. Exhaustion or slow/unavailable service falls back to the user. Bound the companion RPC below the existing 30-second native request timeout. Interrupt/unsubscribe on completion, failure, timeout, or Stop; verify ephemeral cleanup in the pinned binary. Do not claim a hard token-output cap that App Server does not expose; enforce received-output size, review count, and time instead.

Persist pending review identity, phase, timestamps, and fingerprints in session storage for MV3 recovery. Bind approval to the thread, turn, call ID, original idempotency key, exact canonical arguments, user-intent hash, working tab, origin, target/snapshot/form hash, and policy version. Approval is single use and expires with its reviewed state. Exact duplicate calls share the pending/result record; similar future calls do not inherit approval.

Stop, revoked access, navigation, tab closure, changed form values, task completion, or Delete All Data invalidate pending review and prevent late results from executing. After an uncertain host/worker restart, a previous “reviewing” record becomes a user card after revalidation, rather than silently starting another review or executing. Refactor `decideTool` into a shared internal execution function with separate human and reviewer entry points. Serialize decision consumption and persist an executing marker before invoking the browser operation. If a restart leaves execution uncertain, inspect the result or ask the user instead of replaying it. The UI must not be able to claim `approvedBy: reviewer`, and late human/automatic replies must not execute a call twice.

## Settings and compatibility

Add a third visible option, **Auto review**, and a separate reviewer-model setting defaulting to `gpt-6-luna`. Hiding Luna from the composer's model checklist must not disable it as the configured reviewer. Show model availability and an actionable fallback; never silently substitute the main or a more expensive model.

Represent Auto review as the existing Ask policy plus a versioned reviewer configuration. Keep the legacy permission storage key and task `permissionMode` at `ask` while adding reviewer settings to new fields. This ensures an older client that ignores the new fields remains in Ask mode instead of interpreting an unknown `auto` value as Full access. Use explicit capability/version checks between extension and companion before exposing Auto review.

Capture mode, reviewer model, eligibility-policy version, review budget and action budget when the task first starts browser work. Changes in Settings affect the next task. If the captured model or configuration stops being usable, ask the user; do not reinterpret the task as Full access.

## Activity and privacy

Keep one row per browser call: requested, reviewing, running, then succeeded/failed; or reviewing followed by awaiting user confirmation. Retain the actual selected reviewer model with a short plain-text reason and whether the user or reviewer approved. A failed review is not a failed browser action. The normal confirmation card should explain why it was escalated and show the exact pending action.

Review evidence is an additional inference input to the same account/provider and can consume additional Codex usage. Disclose this when choosing the mode. Keep review threads ephemeral, raw evidence out of Chrome history/storage/logs, and stored explanations redacted and bounded. Retain only lifecycle metadata needed for recovery and the existing bounded activity history. Delete All Data and logout cancel reviews; late callbacks cannot recreate deleted state. No telemetry, new Chrome permission, external review service, or secret storage is introduced.

## Implementation sequence

1. **Compatibility spike.** Extend the existing fake-provider probe to verify CLI 0.162.1 ephemeral review threads, structured output, absence of executable reviewer tools, notification isolation, concurrent parent/reviewer turns, timeout and interruption. Make a separately authorized synthetic Luna inference to verify account access and measure latency. Exit: all invariants pass without altering the main thread's tools/model or privileges.
2. **Schemas and policy.** Add `src/shared/auto-review.ts` for configuration, bounded evidence, results and capability schemas. Add `src/background/auto-review-policy.ts` for eligibility, mandatory-human reasons, canonical fingerprints and revalidation. Write labeled action fixtures before enabling model approvals.
3. **Companion review service.** Add `bridge/approval-reviewer.mjs`, narrow `approval.review`/cancel messages and notification routing in `bridge/native-host.mjs`; update installer/release module lists. Never expose a general inference, shell, or arbitrary-thread endpoint to the sidebar.
4. **Service worker integration.** Add a coordinator for pending reviews, trusted request intent, task-captured settings and budgets, deduplication, expiry and recovery. Integrate at `handlePageCall` confirmation and eligible `tabs.close` confirmation, then use shared approved-action execution. Leave permission cards and unknown-URL confirmations on their current human paths.
5. **Sidebar.** Add the mode/model controls, disclosure, reviewing state, reviewer metadata and escalation reason using the existing single-row activity rendering and cards. Preserve Stop and task completion behavior.
6. **Evaluation and rollout.** Run shadow reviews against labeled/synthetic requests without automatic execution, then enable a small eligible set after its acceptance gates pass. Measure eligible approval coverage, erroneous approvals, unnecessary escalations and latency locally. Expand only after explicit policy review; aggregate metrics require no remote telemetry.

## Acceptance gates

- Ask and Full access regression scenarios behave as before. Older companions and older clients cannot silently convert Auto review to Full access.
- Benign eligible fixtures approve; incomplete, destructive, deceptive, sensitive, unauthorized, external-communication and unknown-destination fixtures escalate/refuse as specified. Include misleading labels, GET actions with side effects, hidden/omitted fields, prompt injection in labels/files/tool outputs, and attempts by the main model to invent user authorization.
- A forged or malformed approval, wrong binding, expired verdict, changed form/tab/origin/argument, duplicate response, Stop, restart, revoked grant or deletion never executes the stale action. Simultaneous reviewer/human replies execute at most once.
- Reviewer tool attempts fail closed. Reviewer notifications never enter chat, browser activity as separate calls, permission resumes or taught-skill selection. The main model and working tab remain unchanged.
- Every blocked test case must have zero automatic executions; a model's confidence is not an acceptance metric. Report eligible approval coverage instead of optimizing approval rate at the expense of unsafe approvals.
- Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:bridge`, and `npm run build`; refresh/install the changed companion and run `npm run test:installed-host`.
- In actual Chrome sidebar tests, record model, exact prompt, emitted tools/arguments, review/escalation states, browser result and both consoles. Cover benign auto-approval, a user-escalated destructive fixture without executing destruction, malformed/slow/unavailable reviewer, Stop, changed DOM, service-worker suspension and separate activity groups across two requests. Use disposable pages and the repository's per-action confirmation protocol for test sends/state changes.

Initial implementation uses the existing signed-in App Server with a separate ephemeral thread with the selected model and no executable tools. CLI 0.162.1 is the verified compatibility version; other versions disable new Auto review selection. Users can select from the Codex model catalog and edit the exact reviewer system prompt in Settings. Luna remains the default. Fake-provider probes cover Luna, Sol, Astra and an unknown-model fallback, with no executable tools; concurrent structured-output probes verify both Luna and Sol receive the custom prompt. Live access/latency still depends on the chosen model and account.

The eligible code gates are deliberately narrow: complete same-origin search forms; display-preference forms on recognized preference endpoints; explicitly private drafts; and private notes with a visible undo/restore control. All proposed values must occur in the actual user request. Hidden/unnamed/truncated/sensitive controls and named submitters prevent model review. Generic Save buttons, unknown forms and tab closing stay human-reviewed. A confirmed form's behavior is still based on untrusted site evidence; the reviewer does not prove server-side semantics.

Pending reviews persist identity, deadline and evidence fingerprint; existing approval target previews and bounded user intent live only in Chrome session storage. Raw model prompts, responses and reasoning are not stored in chat history, and user intent is cleared at task completion/cancellation. Execution consumption is persisted before browser effects so uncertain restarts cannot replay them. A recovered review becomes a human card and revalidates before execution.

Live model access and end-to-end latency must be established with a specifically authorized disposable sidebar test. Automated fake-provider checks establish protocol isolation and concurrency without consuming account inference usage. The Full access default and Ask every time behavior remain intact.


### User-configurable reviewer, 2026-10-16

The user explicitly expanded the initial implementation to allow model selection and editable system prompts. Version-2 settings preserve old Luna opt-ins by adding the default prompt; invalid settings fail to Ask. The model dropdown uses the full existing Codex model catalog independently of composer visibility. Save and Reset to default are explicit local operations; model changes retain unsaved prompt edits. Changing permission modes does not reset the reviewer configuration. Empty/whitespace/NUL/over-limit prompts are rejected, with a 6,000-character prompt limit separate from the 8,000-character evidence limit.

The same packaged `bridge/reviewer-config.json` supplies the sidebar and companion defaults and required structured-response instructions; installers/releases include it. Every task captures the selected model and exact saved prompt, and the evidence fingerprint includes that configuration. Activity reports the actual selected model. The companion uses the saved prompt as `baseInstructions` and shows its fixed `developerInstructions` as Required response rules in Settings. Eligibility, permissions, hard refusals and execution checks remain code policy.

The version-2 capability handshake and distinct `approval.reviewConfigured` RPC prevent an old companion from silently ignoring edited prompts. Unknown/unsupported model failures fall back to the user without model substitution. Luna uses low effort, while alternate models use their native default to avoid forcing an unsupported effort setting. See [official App Server model listing](https://learn.chatgpt.com/docs/app-server#list-models-modellist) for catalog and capability discovery.
