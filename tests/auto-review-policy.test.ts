import { describe, expect, it } from "vitest";
import { reviewCandidate, reviewFingerprint } from "../src/background/auto-review-policy";
import { DEFAULT_AUTO_REVIEW, readAutoReviewSettings, reviewVerdictSchema, verdictApproves } from "../src/shared/auto-review";
import type { PageTargetDescription } from "../src/background/page-policy";
import type { PageToolCall } from "../src/shared/page-tools";

const call: PageToolCall = { namespace: "page", tool: "submit", callId: "search-call", requestId: 1, threadId: "thread", turnId: "turn", arguments: { idempotencyKey: "search-000001", ref: { id: "e1", snapshotId: "snapshot", tabId: 12, origin: "https://example.com" } } };
export function searchTarget(): PageTargetDescription {
  return { refId: "e1", snapshotId: "snapshot", role: "button", label: "Search", tag: "button", inputType: null, disabled: false, sensitive: false, sameOrigin: true, newTab: false, download: false, formAssociated: true, submitter: true,
    form: { action: "https://example.com/search", method: "GET", target: "_self", fields: [{ name: "Search", value: "blue otter", sensitive: false }], review: { complete: true, label: "Search", role: "search", hasUndo: false, values: [{ name: "q", value: "blue otter" }] } } };
}
const candidate = (target = searchTarget(), instruction = "Search for blue otter") => reviewCandidate(call, target, instruction, 12, "https://example.com");

describe("automatic-review code gates", () => {
  it("requires explicit valid opt-in and a strictly low-risk verdict", () => {
    expect(readAutoReviewSettings({ enabled: true })).toEqual(DEFAULT_AUTO_REVIEW);
    expect(readAutoReviewSettings({ version: 1, enabled: true, model: "other" })).toEqual(DEFAULT_AUTO_REVIEW);
    expect(readAutoReviewSettings({ version: 1, enabled: true, model: "gpt-6-luna" })).toMatchObject({ version: 2, enabled: true, systemPrompt: DEFAULT_AUTO_REVIEW.systemPrompt });
    expect(readAutoReviewSettings({ ...DEFAULT_AUTO_REVIEW, enabled: true, model: "gpt-6.1-sol", systemPrompt: "Custom policy." })).toMatchObject({ enabled: true, model: "gpt-6.1-sol", systemPrompt: "Custom policy." });
    const approved = reviewVerdictSchema.parse({ decision: "approve", risk: "low", matchesUserRequest: true, missingContext: false, reasonCode: "requested_benign_search", reason: "Requested search." });
    expect(verdictApproves(approved, "search")).toBe(true);
    for (const change of [{ risk: "medium" }, { matchesUserRequest: false }, { missingContext: true }, { reasonCode: "requested_draft" }]) expect(verdictApproves({ ...approved, ...change } as typeof approved, "search")).toBe(false);
    expect(reviewVerdictSchema.safeParse({ ...approved, execute: true }).success).toBe(false);
  });
  it("accepts complete explicit search evidence", () => {
    expect(candidate()).toMatchObject({ evidence: { category: "search", userInstruction: "Search for blue otter", page: { tabId: 12 }, untrustedTarget: { form: { review: { complete: true } } } } });
  });
  it.each(["Delete", "Send", "Publish", "Invite", "Book", "Change account", "Security", "Share"])('routes %s to the user regardless of the form', (label) => {
    const target = searchTarget(); target.label = label;
    expect(candidate(target)).toHaveProperty("reason");
  });
  it("rejects invented values, partial fields, hidden secrets, external/query destinations and ambiguous intent", () => {
    expect(candidate(searchTarget(), "Summarize this page")).toHaveProperty("reason");
    expect(candidate(searchTarget(), "Search for red otter")).toHaveProperty("reason");
    expect(candidate(searchTarget(), "x".repeat(4001))).toHaveProperty("reason");
    for (const modify of [
      (t: PageTargetDescription) => { t.form!.review!.complete = false; },
      (t: PageTargetDescription) => { t.form!.review!.values.push({ name: "token", value: "private-secret" }); },
      (t: PageTargetDescription) => { t.form!.action = "https://collector.example/search"; },
      (t: PageTargetDescription) => { t.form!.action += "?data=hidden"; },
      (t: PageTargetDescription) => { t.form!.target = "_blank"; },
      (t: PageTargetDescription) => { t.form!.fields[0].sensitive = true; },
    ]) { const target = searchTarget(); modify(target); expect(candidate(target)).toHaveProperty("reason"); }
  });
  it("supports bounded display preferences and explicitly private drafts and reversible notes", () => {
    const target = searchTarget();
    target.label = "Save"; target.form!.method = "POST";
    target.form!.action = "https://example.com/preferences";
    target.form!.review = { complete: true, label: "Display preferences", role: "form", hasUndo: false, values: [{ name: "theme", value: "dark" }] };
    expect(candidate(target, "Set theme to dark")).toMatchObject({ evidence: { category: "preference" } });
    target.form!.action = "https://example.com/drafts";
    target.form!.review.label = "Private draft";
    target.form!.review.values = [{ name: "body", value: "Hello otter" }, { name: "visibility", value: "private" }];
    expect(candidate(target, "Save a private draft with Hello otter")).toMatchObject({ evidence: { category: "draft" } });
    target.form!.action = "https://example.com/notes"; target.form!.review.label = "Private note";
    expect(candidate(target, "Create a private note with Hello otter")).toHaveProperty("reason");
    target.form!.review.values.push({ name: "status", value: "published" });
    expect(candidate(target, "Create a private note with Hello otter")).toHaveProperty("reason");
    target.form!.review.values.pop();
    target.form!.review.hasUndo = true;
    expect(candidate(target, "Create a private note with Hello otter")).toMatchObject({ evidence: { category: "private_record" } });
  });
  it("binds the decision to the exact call, values, origin and element snapshot", async () => {
    const target = searchTarget(); const result = candidate(target);
    if (!("evidence" in result)) throw new Error("Missing evidence");
    const original = await reviewFingerprint(call, target, result.evidence);
    const changed = searchTarget(); changed.form!.review!.values[0].value = "different";
    expect(await reviewFingerprint(call, changed, result.evidence)).not.toBe(original);
    expect(await reviewFingerprint(call, target, result.evidence, { ...DEFAULT_AUTO_REVIEW, systemPrompt: "Changed policy" })).not.toBe(await reviewFingerprint(call, target, result.evidence, DEFAULT_AUTO_REVIEW));
    expect(await reviewFingerprint({ ...call, turnId: "other" }, target, result.evidence)).not.toBe(original);
    expect(await reviewFingerprint(call, target, { ...result.evidence, page: { tabId: 99, origin: "https://other.example" } })).not.toBe(original);
  });
});
