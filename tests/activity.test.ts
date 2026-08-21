import { describe, expect, it } from "vitest";
import {
  groupToolStatuses,
  hasBrowserActivityForTurn,
  summarizeToolStatuses,
  visibleActivityFormFields,
  type ToolStatus,
} from "../src/sidepanel/activity";

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

  it("shows working-tab affordances only after the active turn has browser activity", () => {
    const statuses = [activity({ turnId: "turn-1" })];
    expect(hasBrowserActivityForTurn(statuses, null)).toBe(false);
    expect(hasBrowserActivityForTurn(statuses, "turn-2")).toBe(false);
    expect(hasBrowserActivityForTurn(statuses, "turn-1")).toBe(true);
  });

  it("retains Full access bypass previews for the activity UI", () => {
    const groups = groupToolStatuses([
      activity({
        status: "running",
        confirmationBypassed: true,
        permissionMode: "full",
        target: {
          label: "Submit local test",
          form: {
            action: "https://example.com/form",
            method: "POST",
            fields: [{ name: "Name", value: "Codex test", sensitive: false }],
          },
        },
      }),
    ]);
    expect(groups.get("turn-1")?.[0]).toMatchObject({
      confirmationBypassed: true,
      permissionMode: "full",
      target: expect.objectContaining({ label: "Submit local test" }),
    });
  });

  it("omits sensitive fields from Full access activity previews", () => {
    expect(visibleActivityFormFields(activity({
      confirmationBypassed: true,
      target: {
        form: {
          action: "https://example.com/form",
          method: "POST",
          fields: [
            { name: "Name", value: "Codex test", sensitive: false },
            { name: "Password", value: "[sensitive value hidden]", sensitive: true },
          ],
        },
      },
    }))).toEqual([{ name: "Name", value: "Codex test" }]);
  });
});
