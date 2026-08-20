import { describe, expect, it } from "vitest";
import { isSafeHttpUrl, uiRequestSchema } from "../src/shared/protocol";
import { dynamicToolCallSchema, parseToolArguments } from "../src/background/tab-tools";
import { pageToolCallSchema, parsePageToolArguments } from "../src/shared/page-tools";

describe("extension boundary validation", () => {
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
