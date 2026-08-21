# ADR 0002: Supervised page control with opaque references

- Status: Accepted
- Date: 2026-08-20
- Owner: `codex-chrome-extension-manager`

## Context

The original MVP can attach readable page context and manage tabs but cannot perform ordinary page interactions. The approved next milestone requires inspection, clicking, scrolling, navigation, field changes, and confirmed form submission without granting the model arbitrary script or browser-debugger access.

Manifest V3 service workers may suspend, `activeTab` is not reliably granted by a side-panel chat submission, page DOM is untrusted, and DOM nodes cannot be retained in the service worker. The existing Codex App Server dynamic-tool channel and native host already provide a narrow transport that must remain the only model-to-browser control plane.

## Decision

Use one allowlisted control path:

```text
Codex App Server dynamic tool
  -> native-host namespace allowlist
  -> service-worker schema, origin, risk, idempotency, and approval policy
  -> packaged isolated-world page executor
  -> verified normalized result and sidebar activity event
```

- Expose only the documented `tabs.*` and `page.*` namespaces. Reject unknown methods, tools, fields, selectors, coordinates, scripts, and unsafe URLs.
- Require optional host permission plus a separate logical browser-control grant for the exact active `http` or `https` origin before any `page.*` execution. Permission is requested only from a sidebar user gesture and remembered until the user clears local data or revokes it in Chrome; attachment-only access never silently authorizes actions.
- Package `page-executor.js` with the extension and inject it through `chrome.scripting.executeScript`. The native host and side panel never touch page DOM.
- Generate opaque element references inside the executor. Bind references to snapshot, tab, origin, and a semantic fingerprint; expire them after 30 seconds, navigation, or origin change. Ignore unrelated mutations and conservatively rebind only a unique semantic replacement.
- Allow routine navigation (including external/new-tab links), menu controls, fields, scrolling, and semantic drag-and-drop automatically after origin authorization. Confirm recognized consequential controls, form-associated Enter, tab close, and form submission. Refuse purchases, financial actions, secrets, CAPTCHAs, and security bypasses.
- Persist bounded task, activity, and completed-action records in `chrome.storage.session`. Use call ID plus model-supplied idempotency key for page actions. Stop cancels pending browser work as well as the Codex turn.
- Snapshot and persist one working tab per thread before the turn starts. All page execution, opaque references, and permission resumes remain bound to that tab ID across follow-up turns; changing the visible tab never retargets the task. Background new-tab navigation updates the working-tab pin without taking focus.
- Keep pending prompts, completion notice state, and ten-minute finished/canceled tombstones in session storage so MV3 suspension and late tool events fail safely.
- Keep the existing ADR 0001 ChatGPT/Codex authentication and native-message framing unchanged. Redeclare dynamic tools on thread resume.

## Limits

- Maximum 80 inspected elements, 30-second reference lifetime outside approval revalidation, eight-second waits, and a user-selected 5–100 browser-action budget per request (default 40) shared by `tabs.*` and `page.*`.
- First release controls only the main frame. Cross-origin frames, browser pages, extension pages, native dialogs, canvas-only controls, and closed shadow roots fail honestly.
- No `debugger` permission, CDP, arbitrary JavaScript, remotely hosted code, background remote control, file/native drag-and-drop, downloads, or connectors.

## Consequences

The approach is less capable than coordinate or debugger automation, but it is auditable, permission-scoped, compatible with Chrome Web Store security expectations, and resilient against model attempts to invent executable selectors. Ambiguous or materially changed controls require re-inspection. Some custom widgets, canvas surfaces, native drag targets, and untrusted keyboard defaults cannot be controlled reliably and must return an error instead of claiming success.

Connectors remain a separate future decision after supervised browser-control acceptance gates pass.
