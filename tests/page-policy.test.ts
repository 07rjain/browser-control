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
    expect(decidePageAction(call("click", {}), target(), "ask")).toEqual({ decision: "allow" });
    expect(decidePageAction(call("click", {}), target({ sameOrigin: false }), "ask")).toEqual({ decision: "allow" });
    expect(decidePageAction(call("click", {}), target({ newTab: true }), "ask")).toEqual({ decision: "allow" });
    expect(decidePageAction(call("click", {}), target({ tag: "a", role: "link", href: undefined, newTab: true }), "ask")).toMatchObject({ decision: "refuse" });
    expect(decidePageAction(call("click", {}), target({ tag: "button", role: "button", href: undefined }), "ask")).toEqual({ decision: "allow" });
    expect(decidePageAction(call("click", {}), target({ tag: "button", role: "button", label: "Save event", href: undefined }), "ask")).toMatchObject({ decision: "confirm" });
    expect(decidePageAction(call("click", {}), target({ tag: "button", role: "button", label: "Remove filter", href: undefined }), "ask")).toEqual({ decision: "allow" });
    expect(decidePageAction(call("click", {}), target({ tag: "button", role: "button", label: "Confirm time slot", href: undefined }), "ask")).toEqual({ decision: "allow" });
    expect(decidePageAction(call("click", {}), target({ tag: "button", role: "button", label: "Today", href: undefined }), "ask")).toEqual({ decision: "allow" });
    expect(decidePageAction(call("click", {}), target({ tag: "button", role: "button", href: undefined, formAssociated: true, submitter: false }), "ask")).toEqual({ decision: "allow" });
    expect(decidePageAction(call("click", {}), target({ tag: "button", role: "button", href: undefined, formAssociated: true, submitter: true }), "ask")).toMatchObject({ decision: "confirm" });
  });

  it("confirms form submission and form-associated Enter", () => {
    expect(decidePageAction(call("submit", {}), target({ formAssociated: true }), "ask")).toMatchObject({ decision: "confirm" });
    expect(decidePageAction(call("keypress", { key: "Enter" }), target({ tag: "input", role: "textbox", formAssociated: true }), "ask")).toMatchObject({ decision: "confirm" });
    expect(decidePageAction(call("keypress", { key: "Enter" }), target({ tag: "button", role: "button", formAssociated: false }), "ask")).toEqual({ decision: "allow" });
    expect(decidePageAction(call("keypress", { key: "Tab" }), target({ tag: "input", role: "textbox" }), "ask")).toEqual({ decision: "allow" });
  });

  it("allows supported consequential actions in full-access mode", () => {
    expect(decidePageAction(call("submit", {}), target({ formAssociated: true }), "full")).toEqual({ decision: "allow" });
    expect(decidePageAction(
      call("click", {}),
      target({ tag: "button", role: "button", label: "Save event", href: undefined }),
      "full",
    )).toEqual({ decision: "allow" });
    expect(decidePageAction(
      call("keypress", { key: "Enter" }),
      target({ tag: "input", role: "textbox", formAssociated: true }),
      "full",
    )).toEqual({ decision: "allow" });
  });

  it("refuses forms with non-http destinations", () => {
    expect(
      decidePageAction(
        call("submit", {}),
        target({ formAssociated: true, form: { action: "", method: "POST", fields: [] } }),
        "ask",
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
        "ask",
      ),
    ).toMatchObject({ decision: "refuse" });
  });

  it("refuses purchases and sensitive keyboard targets", () => {
    expect(decidePageAction(call("click", {}), target({ label: "Buy now" }), "ask")).toMatchObject({ decision: "refuse" });
    expect(decidePageAction(call("click", {}), target({ download: true }), "ask")).toMatchObject({ decision: "refuse" });
    expect(decidePageAction(call("click", {}), target({ href: undefined }), "ask")).toMatchObject({ decision: "refuse" });
    expect(decidePageAction(call("keypress", { key: "Tab" }), target({ sensitive: true }), "ask")).toMatchObject({ decision: "refuse" });
    expect(decidePageAction(call("click", {}), target({ label: "Buy now" }), "full")).toMatchObject({ decision: "refuse" });
    expect(decidePageAction(call("keypress", { key: "Tab" }), target({ sensitive: true }), "full")).toMatchObject({ decision: "refuse" });
  });
});
