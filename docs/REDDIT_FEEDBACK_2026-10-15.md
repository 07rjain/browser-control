# Reddit feedback and feature-request review

Date reviewed: 2026-10-15  
Account reviewed: `u/pleasetellme-1`  
Scope: public replies to Browser Control posts on r/AgentsOfAI, r/SideProject, and r/browsers.

## Executive summary

Reddit feedback validates the core trust model: reviewers specifically valued human review before saving a taught skill, short-lived element references, working-tab pinning, visible execution, and the distinction between a procedure and authority.

The strongest feature request is not a blanket confirmation before every action. Reviewers consistently preferred risk-sensitive behavior:

- routine reads and navigation may run visibly with Stop available;
- the first execution of a taught skill should show a compact preview;
- writes, form submissions, unfamiliar domains, changed steps, irreversible actions, and substitutions of example values with real destinations need stronger review;
- a changed or ambiguous page should fail closed and either recover through a fresh inspection or ask the user;
- saved skills need an easier, more discoverable re-teach flow;
- Windows installation should diagnose launcher-path problems instead of relying on a restart.

These are community requests, not approved requirements. Any change that alters Full access confirmation behavior requires an explicit product decision and a PRD update.

## Sources reviewed

| Community | Post | Public response signal |
| --- | --- | --- |
| r/AgentsOfAI | [Teach-by-demonstration update](https://www.reddit.com/r/AgentsOfAI/comments/1x284n0/i_added_reviewed_local_teachbydemonstration_to_a/) | Four substantive external replies about previews, risk, destination substitution, and trust boundaries; one later reply also favored a first-run preview. |
| r/SideProject | [Skills and desktop-platform update](https://www.reddit.com/r/SideProject/comments/1x284at/i_added_teachbydemonstration_and_windowslinux/) | The external comments are now deleted or removed. The surviving author replies show that the discussion covered changed-page recovery and making re-teaching easier to discover. Treat this as lower-confidence evidence. |
| r/browsers | [Skills and Windows/Linux update](https://www.reddit.com/r/browsers/comments/1x28413/update_browser_control_can_now_learn_local_skills/) | One tester reported a successful Windows + Brave setup and a launcher-path hiccup that cleared after restart. The reviewer strongly valued review-before-save. |
| r/SideProject | [Initial Browser Control launch](https://www.reddit.com/r/SideProject/comments/1w01ovv/browser_control_supervised_browser_actions_for/) | One reply said supervision reduced the fear of giving Codex browser control. |
| r/browsers | [Initial browser launch](https://www.reddit.com/r/browsers/comments/1w0eara/i_built_browser_controla_supervised_codex_side/) | No surviving external reply was returned by Reddit at review time. |

Automoderator messages, the author's own replies, removed promotional posts, and unrelated projects were excluded from feature-request counts.

### Comment evidence index

| Theme | Comment |
| --- | --- |
| Preview before the first run | [Many_Penalty_730](https://www.reddit.com/r/AgentsOfAI/comments/1x284n0/i_added_reviewed_local_teachbydemonstration_to_a/pfgqi9x/) |
| Configurable preview frequency | [Defiant-Stage-4151](https://www.reddit.com/r/AgentsOfAI/comments/1x284n0/i_added_reviewed_local_teachbydemonstration_to_a/pf0035p/) |
| Preview irreversible work; visible execution for reads/navigation | [AIGODSEND](https://www.reddit.com/r/AgentsOfAI/comments/1x284n0/i_added_reviewed_local_teachbydemonstration_to_a/pf02y63/) |
| Risk-based approval for changed steps, unfamiliar domains, and side effects | [Swimming_dasa](https://www.reddit.com/r/AgentsOfAI/comments/1x284n0/i_added_reviewed_local_teachbydemonstration_to_a/pf0kzlg/) |
| Preview example-value substitution when it becomes a real destination | [arthaudm](https://www.reddit.com/r/AgentsOfAI/comments/1x284n0/i_added_reviewed_local_teachbydemonstration_to_a/pf0pmrx/) |
| Review-before-save and Windows + Brave launcher experience | [Smart-Fly-1378](https://www.reddit.com/r/browsers/comments/1x28413/update_browser_control_can_now_learn_local_skills/pf003jy/) |
| Supervision reduces adoption anxiety | [Affectionate_Sky5607](https://www.reddit.com/r/SideProject/comments/1w01ovv/browser_control_supervised_browser_actions_for/p69h251/) |
| Changed-page recovery and re-teach discoverability | [Deleted SideProject thread](https://www.reddit.com/r/SideProject/comments/1x284at/comment/pezzueg/) — only the author's replies survive, so this evidence is low confidence. |

## Validated product choices

### Human review before saving a skill

Multiple reviewers treated the review step as essential rather than optional. The value is error detection before an imperfect demonstration becomes reusable behavior.

Current implementation alignment:

- the recorder enters a review state before saving;
- the generated `SKILL.md` is previewed in the sidebar;
- secret, authentication, payment, purchase, and CAPTCHA interactions remain excluded or refused.

### Procedure is not authority

The phrase “procedure, not authority” received explicit positive feedback. Reviewers connected that separation to preventing a recorded demonstration from becoming a privilege escalation.

Current implementation alignment:

- loading a taught skill does not grant host permission;
- permission mode, action budget, Stop, and hard refusals still apply;
- skills are loaded only through `skills.read` from the isolated sidebar skills directory.

### Fresh references and working-tab pinning

A browser-automation practitioner specifically endorsed short-lived element references and working-tab pinning as defenses against wrong-target actions.

Current implementation alignment:

- taught skills instruct the model to inspect before every page action and use fresh opaque references;
- a uniquely identifiable control replaced by a reactive render may be rebound;
- missing, changed, or ambiguous targets fail closed and require another inspection;
- a task remains bound to its working tab instead of following whichever tab becomes visible.

### Supervision improves adoption

The initial SideProject response said the supervised model made trying Codex browser work feel less risky. The feedback supports retaining activity visibility, cancellation, scoped permissions, and hard refusals as product features rather than treating them as implementation details.

### Windows and Brave support is useful

One reviewer said Windows support caused them to try Browser Control and described Chrome/Brave registration as generally painless. The launcher path did not work cleanly on the first attempt, although a restart resolved it.

## Prioritized feature requests

### P0 — Risk-sensitive taught-skill preview

Problem: users may trust a saved skill automatically even when the current run has a different destination, domain, value, or side effect.

Requested behavior:

- show a compact summary before the first execution of a taught skill;
- continue showing normal activity during execution;
- distinguish routine reads/navigation from writes and external side effects;
- elevate unfamiliar origins, changed steps, real recipients/destinations, submissions, sends, deletes, scheduling, and irreversible actions;
- never rely on Stop as the only opportunity to notice a harmful substitution.

Proposed acceptance criteria:

1. The first run of a taught skill presents its ordered action summary, intended origin, and any non-sensitive example-to-current-value substitutions before execution begins.
2. Routine read/navigation steps can proceed visibly after the applicable permission grant.
3. Ask every time continues to require its existing fresh confirmation for consequential actions.
4. Full access continues to follow the approved no-extra-card contract unless the product owner explicitly changes the PRD; skipped confirmations must remain visible in activity.
5. Passwords, authentication codes, payment data, private keys, and other refused values never appear in a preview or log.
6. The user can stop the run from both the preview and active-execution states.

Privacy/security impact: positive if previews remain local and redact sensitive values. A mandatory confirmation for every Full access write would change the published permission-mode contract and must not be introduced without product approval.

Open product decision: reviewers proposed `always`, `first run`, and `never` preview preferences. `Never` is not acceptable for mandatory safety checks or refused actions. A safer initial policy is first-run preview plus risk-based elevation, with no preference that can suppress code-side refusals.

### P0 — Recorded-step postconditions and mismatch recovery

Problem: inspecting before an action protects target selection, but it does not prove that the action produced the state expected by the recorded demonstration.

Requested behavior:

- associate a small observable postcondition with appropriate recorded steps;
- verify it after execution;
- re-inspect and adapt only when the intended result remains unambiguous;
- stop and ask when the result is missing, ambiguous, materially different, or on the wrong origin.

Proposed acceptance criteria:

1. A recorded step may store bounded, non-sensitive expectations such as origin/path, visible accessible name, checked state, selected option, or successful navigation.
2. After the action, the executor verifies the supported expectation using a fresh inspection.
3. A unique semantic match may recover from a reactive DOM replacement.
4. Missing or multiple matches fail closed; the system does not choose the closest-looking control.
5. Recovery attempts are bounded by the request action budget and appear chronologically in activity.
6. If recovery cannot prove the expected state, the assistant reports the mismatch and asks for direction instead of claiming completion.

Privacy/security impact: recorded expectations must exclude secrets and minimize retained page text. Postconditions improve wrong-target resistance but expand the local skill schema and require migration/versioning.

### P1 — Make re-teaching a first-class skill action

Problem: disabling and deleting a skill exist in Settings, but correcting or re-teaching a workflow is not discoverable.

Requested behavior:

- add `Re-teach` beside each saved skill;
- explain whether re-teaching replaces the skill or creates a new reviewed draft;
- preserve the old skill until the replacement is reviewed and successfully saved.

Proposed acceptance criteria:

1. Each saved skill exposes a clearly labeled Re-teach action.
2. Re-teaching records a separate draft and cannot overwrite the saved skill before review.
3. Canceling or failing the new recording leaves the original skill unchanged.
4. Saving the replacement is atomic and refreshes the skill catalog.
5. Permission modes and hard refusals apply throughout recording and later execution.

Privacy/security impact: no network collection is required. Retained example values must receive the same explicit review and redaction treatment as a new skill.

### P1 — Windows launcher-path diagnostics

Problem: one Windows + Brave tester encountered a launcher-path problem on first install that disappeared after restarting. The available report lacks enough detail to identify the exact cause.

Requested behavior:

- verify the recorded Codex and companion paths during installation;
- distinguish PATH discovery, native-host registration, stale browser state, and launcher-startup failures;
- show the smallest useful recovery instruction instead of relying on a generic restart.

Proposed acceptance criteria:

1. The installer verifies that each recorded executable or launcher path exists before completing.
2. `npm run test:installed-host` reports whether failure occurred during manifest lookup, launcher start, Codex resolution, or native-message exchange.
3. Documentation includes browser-reload and OS-session-restart guidance only for cases where each is actually relevant.
4. Chrome and Brave paths are tested independently on supported Windows environments.

Privacy/security impact: diagnostics must not print authentication tokens, full user data, page contents, or reusable credentials. User-specific filesystem paths should be shown only when needed locally and should be redacted from shared reports.

## Current behavior versus requested behavior

| Area | Current behavior | Gap identified by feedback |
| --- | --- | --- |
| Skill creation | Review generated skill document before saving. | None; reviewers validated this choice. |
| Skill selection | Matching skill metadata is offered; body loads via `skills.read`. | First-run execution preview is not a dedicated product state. |
| Before each page action | Skill instructions require a fresh `page.inspect` and opaque reference. | No compact preview of the entire upcoming taught workflow. |
| Changed DOM node | Rebind only on one exact semantic fingerprint; otherwise fail closed. | No recorded postcondition proves the action achieved the demonstrated result. |
| Consequential action | Ask every time confirms; Full access executes supported actions while recording the skipped preview in activity. | Reviewers want risk-based elevation, especially for substitutions and unfamiliar destinations; changing Full access needs a product decision. |
| Skill maintenance | Settings can disable or delete saved skills. | Re-teaching is not a clear first-class workflow. |
| Windows installation | Installer and installed-host test exist; Windows + Brave success has user evidence. | Launcher-path failure needs structured diagnosis and reproduction data. |

## Recommended delivery sequence

1. Update the PRD with an explicit decision for first-run and risk-sensitive skill previews, including how Full access behaves.
2. Add a versioned postcondition model to recorded steps, beginning with navigation and simple control-state checks.
3. Add mismatch activity states and bounded re-inspection tests before adding automatic recovery breadth.
4. Add an atomic Re-teach flow to the saved-skill UI.
5. Extend Windows installed-host diagnostics and request exact reproduction details if the Reddit tester responds.
6. Run the standard automated gate and the manual Browser Control end-to-end protocol on Chrome and Brave before release.

## Suggested validation scenarios

- First run of a read-only skill on the recorded origin.
- First run where an example recipient is replaced with a real recipient.
- Repeated routine navigation with no changed values.
- Recorded control renamed but still uniquely identifiable.
- Recorded control replaced by two ambiguous matches.
- Navigation lands on an unfamiliar origin.
- Form submission in Ask every time and Full access.
- User stops during postcondition verification.
- Re-teach succeeds, is canceled, and fails during save.
- Windows install with valid paths, missing Codex, stale browser registration, Chrome, and Brave.

## Evidence limitations

- Reddit comments are qualitative feedback from a small self-selected sample, not usability-study results.
- Two SideProject comments were deleted or removed before this review. Their themes are inferred only from the surviving author replies and should not independently drive scope.
- The Windows launcher report says a restart fixed the issue but does not include the installer version, path, browser version, logs, or exact reproduction steps.
- Positive comments validate perceived trust and installation experience; they do not replace end-to-end security or reliability testing.
