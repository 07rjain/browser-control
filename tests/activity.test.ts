import { describe, expect, it } from "vitest";
import { groupToolStatuses, summarizeToolStatuses, type ToolStatus } from "../src/sidepanel/activity";

const activity = (overrides: Partial<ToolStatus>): ToolStatus => ({
  callId: "call-1",
  namespace: "page",
  tool: "click",
  status: "requested",
  turnId: "turn-1",
  ...overrides,
});

describe("tool activity summaries", () => {
  it("groups every lifecycle step with the request turn", () => {
    const groups = groupToolStatuses([
      activity({ status: "requested" }),
      activity({ status: "running" }),
      activity({ status: "succeeded" }),
      activity({ callId: "call-2", tool: "scroll", turnId: "turn-2" }),
    ]);
    expect(groups.get("turn-1")?.map((item) => item.status)).toEqual(["requested", "running", "succeeded"]);
    expect(groups.get("turn-2")).toHaveLength(1);
  });

  it("counts unique actions and reports terminal failures", () => {
    expect(summarizeToolStatuses([
      activity({ status: "requested" }),
      activity({ status: "succeeded" }),
      activity({ callId: "call-2", tool: "fill", status: "failed" }),
    ])).toEqual({ actionCount: 2, failed: true });
  });
});
