import { afterEach, describe, expect, it, vi } from "vitest";
import { createApprovalReviewer, parseReviewVerdict, REVIEW_OUTPUT_SCHEMA } from "../bridge/approval-reviewer.mjs";

const verdict = { decision: "approve", risk: "low", matchesUserRequest: true, missingContext: false, reasonCode: "requested_benign_search", reason: "Requested benign search." };
const params = () => ({ reviewId: crypto.randomUUID(), parentThreadId: "parent", parentTurnId: "parent-turn", model: "gpt-6-luna", evidence: { policyVersion: 1, category: "search" } });
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(overrides = {}) {
  const request = vi.fn(async (method) => method === "thread/start" ? { thread: { id: "review-thread" } } : method === "turn/start" ? { turn: { id: "review-turn" } } : {});
  const reviewer = createApprovalReviewer({ request, workspace: "/tmp/reviewer", ...overrides });
  const event = (method, extra = {}) => reviewer.handle({ method, params: { threadId: "review-thread", turnId: "review-turn", ...extra } });
  const complete = () => { event("item/completed", { item: { type: "agentMessage", text: JSON.stringify(verdict) } }); event("turn/completed", { turn: { id: "review-turn", status: "completed" } }); };
  return { reviewer, request, event, complete };
}
afterEach(() => vi.useRealTimers());

describe("isolated approval-review service", () => {
  it("validates exact bounded structured output", () => {
    expect(REVIEW_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(parseReviewVerdict(JSON.stringify(verdict))).toEqual(verdict);
    for (const value of ["```json {} ```", "null", JSON.stringify({ ...verdict, risk: "safe" }), JSON.stringify({ ...verdict, extra: true }), JSON.stringify({ ...verdict, reason: "a".repeat(300) })]) expect(() => parseReviewVerdict(value)).toThrow();
  });
  it("offers no tools, isolates notifications, and returns a result only on completion", async () => {
    const { reviewer, request, event, complete } = fixture();
    const result = reviewer.review(params()); await tick();
    expect(request.mock.calls[0]).toEqual(["thread/start", expect.objectContaining({ model: "gpt-6-luna", ephemeral: true, dynamicTools: [], approvalPolicy: "never", sandbox: "read-only" })]);
    expect(request.mock.calls[1]).toEqual(["turn/start", expect.objectContaining({ outputSchema: REVIEW_OUTPUT_SCHEMA, model: "gpt-6-luna" })]);
    expect(reviewer.handle({ method: "item/agentMessage/delta", params: { threadId: "parent", delta: "Main output" } })).toBe(false);
    expect(event("item/agentMessage/delta", { delta: "{}" })).toBe(true);
    complete(); expect(await result).toEqual(verdict);
    expect(event("item/agentMessage/delta", { delta: "Late output" })).toBe(true);
    reviewer.close();
  });
  it("uses the selected model and exact custom prompt without adding tools", async () => {
    const { reviewer, request, complete } = fixture();
    const systemPrompt = "Ask me before changing any preference. Review searches conservatively.";
    const result = reviewer.review({ ...params(), model: "gpt-6.1-sol", systemPrompt }); await tick();
    expect(request.mock.calls[0]).toEqual(["thread/start", expect.objectContaining({ model: "gpt-6.1-sol", baseInstructions: systemPrompt, dynamicTools: [] })]);
    expect(request.mock.calls[1]).toEqual(["turn/start", expect.objectContaining({ model: "gpt-6.1-sol", outputSchema: REVIEW_OUTPUT_SCHEMA })]);
    expect(request.mock.calls[1][1]).not.toHaveProperty("effort");
    complete(); expect(await result).toEqual(verdict); reviewer.close();
  });
  it("rejects empty, excessive or null-containing prompts before creating a thread", async () => {
    for (const systemPrompt of ["", "  ", "x".repeat(6001), "bad\0prompt"]) {
      const { reviewer, request } = fixture();
      await expect(reviewer.review({ ...params(), systemPrompt })).rejects.toThrow(/system prompt/);
      expect(request).not.toHaveBeenCalled(); reviewer.close();
    }
  });
  it("fails to human on a tool request, invalid JSON, interrupted turn or oversized result", async () => {
    for (const failure of ["tool", "json", "interrupt", "size"]) {
      const { reviewer, event } = fixture(); const result = reviewer.review(params()); await tick();
      if (failure === "tool") expect(reviewer.handle({ id: 8, method: "item/tool/call", params: { threadId: "review-thread" } })).toEqual({ reject: true });
      if (failure === "json") { event("item/agentMessage/delta", { delta: "invalid" }); event("turn/completed", { turn: { status: "completed" } }); }
      if (failure === "interrupt") event("turn/completed", { turn: { status: "interrupted" } });
      if (failure === "size") event("item/agentMessage/delta", { delta: "x".repeat(2049) });
      expect(await result).toMatchObject({ decision: "ask_user" }); reviewer.close();
    }
  });
  it("uses a bounded deadline and cancels a late-starting thread without sending a turn", async () => {
    vi.useFakeTimers(); let release;
    const request = vi.fn((method) => method === "thread/start" ? new Promise((resolve) => { release = resolve; }) : Promise.resolve({}));
    const { reviewer } = fixture({ request }); const result = reviewer.review(params());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ decision: "ask_user", reasonCode: "timeout" });
    release({ thread: { id: "late-thread" } }); await tick();
    expect(request.mock.calls.map(([method]) => method)).toEqual(["thread/start", "thread/unsubscribe"]);
    expect(reviewer.handle({ method: "turn/started", params: { threadId: "late-thread" } })).toBe(true); reviewer.close();
  });
  it("limits concurrent reviews and cancels only the matching parent; late approval is inert", async () => {
    const { reviewer, complete } = fixture(); const result = reviewer.review(params()); await tick();
    expect(await reviewer.review(params())).toMatchObject({ decision: "ask_user", reasonCode: "busy" });
    reviewer.cancel("other"); reviewer.cancel("parent", "parent-turn");
    expect(await result).toMatchObject({ decision: "ask_user", reasonCode: "canceled" });
    complete(); reviewer.close();
    expect(await reviewer.review(params())).toMatchObject({ decision: "ask_user", reasonCode: "unavailable" });
  });
});
