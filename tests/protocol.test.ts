import { describe, expect, it } from "vitest";
import { isSafeHttpUrl, uiRequestSchema } from "../src/shared/protocol";
import { dynamicToolCallSchema, parseToolArguments } from "../src/background/tab-tools";
import {
  browserPermissionModeSchema,
  browserTaskActionLimitSchema,
  DEFAULT_BROWSER_PERMISSION_MODE,
  DEFAULT_BROWSER_TASK_ACTION_LIMIT,
  normalizeBrowserPermissionMode,
  normalizeBrowserTaskActionLimit,
  pageToolCallSchema,
  parsePageToolArguments,
} from "../src/shared/page-tools";

describe("extension boundary validation", () => {
  it("defaults browser permission mode to full access and rejects unknown modes", () => {
    expect(browserPermissionModeSchema.safeParse("full").success).toBe(true);
    expect(browserPermissionModeSchema.safeParse("ask").success).toBe(true);
    expect(browserPermissionModeSchema.safeParse("always").success).toBe(false);
    expect(normalizeBrowserPermissionMode("ask")).toBe("ask");
    expect(normalizeBrowserPermissionMode("invalid")).toBe(DEFAULT_BROWSER_PERMISSION_MODE);
    expect(DEFAULT_BROWSER_PERMISSION_MODE).toBe("full");
  });

  it("bounds the configurable browser task action limit", () => {
    expect(browserTaskActionLimitSchema.safeParse(20).success).toBe(true);
    expect(browserTaskActionLimitSchema.safeParse(4).success).toBe(false);
    expect(browserTaskActionLimitSchema.safeParse(101).success).toBe(false);
    expect(normalizeBrowserTaskActionLimit("50")).toBe(50);
    expect(normalizeBrowserTaskActionLimit("20.5")).toBe(21);
    expect(normalizeBrowserTaskActionLimit(500)).toBe(100);
    expect(normalizeBrowserTaskActionLimit("not-a-number")).toBe(DEFAULT_BROWSER_TASK_ACTION_LIMIT);
  });
  it("accepts only http and https destinations", () => {
    expect(isSafeHttpUrl("https://example.com/path")).toBe(true);
    expect(isSafeHttpUrl("http://localhost:3000")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("chrome://settings")).toBe(false);
  });

  it("rejects empty chat messages", () => {
    const result = uiRequestSchema.safeParse({
      type: "CHAT_SEND",
      requestId: crypto.randomUUID(),
      threadId: "thread-1",
      clientMessageId: crypto.randomUUID(),
      text: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("accepts only a specific conversation for working-tab focus", () => {
    expect(uiRequestSchema.safeParse({
      type: "WORKING_TAB_FOCUS",
      requestId: crypto.randomUUID(),
      threadId: "thread-1",
    }).success).toBe(true);
    expect(uiRequestSchema.safeParse({
      type: "WORKING_TAB_FOCUS",
      requestId: crypto.randomUUID(),
      threadId: "",
    }).success).toBe(false);
  });

  it("rejects unlisted browser tools", () => {
    const result = dynamicToolCallSchema.safeParse({
      requestId: 4,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      namespace: "tabs",
      tool: "executeScript",
      arguments: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsafe tab-open URLs", () => {
    const call = dynamicToolCallSchema.parse({
      requestId: 4,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      namespace: "tabs",
      tool: "open",
      arguments: { url: "file:///etc/passwd" },
    });
    expect(() => parseToolArguments(call)).toThrow(/http\/https/);
  });

  it("accepts background-by-default tab selection with explicit foreground opt-in", () => {
    const open = dynamicToolCallSchema.parse({
      requestId: 4, threadId: "thread-1", turnId: "turn-1", callId: "call-open",
      namespace: "tabs", tool: "open", arguments: { url: "https://example.com", foreground: true },
    });
    expect(parseToolArguments(open)).toEqual({ url: "https://example.com", foreground: true });

    const activate = dynamicToolCallSchema.parse({ ...open, tool: "activate", arguments: { tabId: 12 } });
    expect(parseToolArguments(activate)).toEqual({ tabId: 12 });

    const reload = dynamicToolCallSchema.parse({ ...open, tool: "reload", arguments: { tabId: 12, foreground: true } });
    expect(() => parseToolArguments(reload)).toThrow();
  });

  it("accepts strict tab groups and rejects duplicate tab IDs", () => {
    const call = dynamicToolCallSchema.parse({
      requestId: 5,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-group",
      namespace: "tabs",
      tool: "group",
      arguments: { tabIds: [12, 13], title: "Research", color: "blue", collapsed: false },
    });
    expect(parseToolArguments(call)).toEqual({
      tabIds: [12, 13],
      title: "Research",
      color: "blue",
      collapsed: false,
    });

    expect(() => parseToolArguments({ ...call, arguments: { tabIds: [12, 12], title: "Duplicate" } })).toThrow(/unique/i);
    expect(() => parseToolArguments({ ...call, arguments: { tabIds: [12], title: "Research", color: "black" } })).toThrow();
  });

  it("accepts strict tab ungrouping and rejects duplicate tab IDs", () => {
    const call = dynamicToolCallSchema.parse({
      requestId: 6,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-ungroup",
      namespace: "tabs",
      tool: "ungroup",
      arguments: { tabIds: [12, 13] },
    });
    expect(parseToolArguments(call)).toEqual({ tabIds: [12, 13] });
    expect(() => parseToolArguments({ ...call, arguments: { tabIds: [12, 12] } })).toThrow(/unique/i);
  });

  it("accepts strict page inspection and rejects arbitrary selector arguments", () => {
    const inspect = pageToolCallSchema.parse({
      requestId: 5,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-2",
      namespace: "page",
      tool: "inspect",
      arguments: { idempotencyKey: "inspect-0001" },
    });
    expect(parsePageToolArguments(inspect)).toEqual({ idempotencyKey: "inspect-0001" });

    const click = pageToolCallSchema.parse({
      requestId: 6,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-3",
      namespace: "page",
      tool: "click",
      arguments: {
        idempotencyKey: "click-000001",
        ref: { id: "e1", snapshotId: "snapshot-1", tabId: 1, origin: "https://example.com" },
        selector: "#buy",
      },
    });
    expect(() => parsePageToolArguments(click)).toThrow();
  });

  it("rejects unsafe keys and mismatched scroll references", () => {
    const keypress = pageToolCallSchema.parse({
      requestId: 7,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-4",
      namespace: "page",
      tool: "keypress",
      arguments: {
        idempotencyKey: "keypress-001",
        ref: { id: "e1", snapshotId: "snapshot-1", tabId: 1, origin: "https://example.com" },
        key: "Meta+L",
      },
    });
    expect(() => parsePageToolArguments(keypress)).toThrow();

    const scroll = pageToolCallSchema.parse({
      requestId: 8,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-5",
      namespace: "page",
      tool: "scroll",
      arguments: { idempotencyKey: "scroll-00001", direction: "element" },
    });
    expect(() => parsePageToolArguments(scroll)).toThrow(/requires a reference/i);
  });

  it("accepts drag references only from the same inspected page", () => {
    const ref = { id: "e1", snapshotId: "snapshot-1", tabId: 1, origin: "https://example.com" };
    const drag = pageToolCallSchema.parse({
      requestId: 9,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-6",
      namespace: "page",
      tool: "drag",
      arguments: { idempotencyKey: "drag-0000001", sourceRef: ref, targetRef: { ...ref, id: "e2" } },
    });
    expect(parsePageToolArguments(drag)).toMatchObject({ sourceRef: { id: "e1" }, targetRef: { id: "e2" } });

    const invalid = pageToolCallSchema.parse({
      requestId: 10,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-7",
      namespace: "page",
      tool: "drag",
      arguments: { idempotencyKey: "drag-0000002", sourceRef: ref, targetRef: { ...ref, id: "e2", tabId: 2 } },
    });
    expect(() => parsePageToolArguments(invalid)).toThrow(/same page inspection/i);
  });

  it("accepts model selection for thread and turn requests", () => {
    expect(uiRequestSchema.safeParse({ type: "MODELS_READ", requestId: crypto.randomUUID() }).success).toBe(true);
    expect(uiRequestSchema.safeParse({
      type: "CHAT_START",
      requestId: crypto.randomUUID(),
      model: "gpt-5.6-terra",
    }).success).toBe(true);
    expect(uiRequestSchema.safeParse({
      type: "CHAT_SEND",
      requestId: crypto.randomUUID(),
      threadId: "thread-1",
      clientMessageId: crypto.randomUUID(),
      text: "Hello",
      model: "gpt-5.6-terra",
    }).success).toBe(true);
  });
});
