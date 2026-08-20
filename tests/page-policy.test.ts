import { describe, expect, it } from "vitest";
import { pageToolCallSchema } from "../src/shared/page-tools";
import { decidePageAction, type PageTargetDescription } from "../src/background/page-policy";

const ref = { id: "e1", snapshotId: "snapshot-1", tabId: 1, origin: "https://example.com" };

function call(tool: "click" | "submit" | "keypress", args: Record<string, unknown>) {
  return pageToolCallSchema.parse({
    requestId: 1,
    threadId: "thread-1",
    turnId: "turn-1",
    callId: `call-${tool}`,
    namespace: "page",
    tool,
    arguments: { idempotencyKey: `${tool}-00000001`, ref, ...args },
  });
}

function target(overrides: Partial<PageTargetDescription> = {}): PageTargetDescription {
  return {
    refId: "e1",
    snapshotId: "snapshot-1",
    role: "link",
    label: "Pricing",
    tag: "a",
    inputType: null,
    disabled: false,
    sensitive: false,
    href: "https://example.com/pricing",
    sameOrigin: true,
    newTab: false,
    download: false,
    formAssociated: false,
    submitter: false,
    form: null,
    ...overrides,
  };
}

describe("page action policy", () => {
  it("allows ordinary navigation and non-form controls without confirmation", () => {
    expect(decidePageAction(call("click", {}), target())).toEqual({ decision: "allow" });
    expect(decidePageAction(call("click", {}), target({ sameOrigin: false }))).toMatchObject({ decision: "confirm" });
    expect(decidePageAction(call("click", {}), target({ tag: "button", role: "button", href: undefined }))).toEqual({ decision: "allow" });
    expect(decidePageAction(call("click", {}), target({ tag: "button", role: "button", label: "Save event", href: undefined }))).toMatchObject({ decision: "confirm" });
    expect(decidePageAction(call("click", {}), target({ tag: "button", role: "button", href: undefined, formAssociated: true, submitter: true }))).toMatchObject({ decision: "confirm" });
  });

  it("always confirms form submission and Enter", () => {
    expect(decidePageAction(call("submit", {}), target({ formAssociated: true }))).toMatchObject({ decision: "confirm" });
    expect(decidePageAction(call("keypress", { key: "Enter" }), target({ tag: "input", role: "textbox" }))).toMatchObject({ decision: "confirm" });
    expect(decidePageAction(call("keypress", { key: "Tab" }), target({ tag: "input", role: "textbox" }))).toEqual({ decision: "allow" });
  });

  it("refuses forms with non-http destinations", () => {
    expect(
      decidePageAction(
        call("submit", {}),
        target({ formAssociated: true, form: { action: "", method: "POST", fields: [] } }),
      ),
    ).toMatchObject({ decision: "refuse" });
  });

  it("refuses submission of forms containing sensitive controls", () => {
    expect(
      decidePageAction(
        call("submit", {}),
        target({
          formAssociated: true,
          form: {
            action: "https://example.com/login",
            method: "POST",
            fields: [{ name: "Password", value: "[sensitive value hidden]", sensitive: true }],
          },
        }),
      ),
    ).toMatchObject({ decision: "refuse" });
  });

  it("refuses purchases and sensitive keyboard targets", () => {
    expect(decidePageAction(call("click", {}), target({ label: "Buy now" }))).toMatchObject({ decision: "refuse" });
    expect(decidePageAction(call("click", {}), target({ download: true }))).toMatchObject({ decision: "refuse" });
    expect(decidePageAction(call("click", {}), target({ href: undefined }))).toMatchObject({ decision: "refuse" });
    expect(decidePageAction(call("keypress", { key: "Tab" }), target({ sensitive: true }))).toMatchObject({ decision: "refuse" });
  });
});
