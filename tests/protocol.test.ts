import { describe, expect, it } from "vitest";
import { isSafeHttpUrl, uiRequestSchema } from "../src/shared/protocol";
import { dynamicToolCallSchema, parseToolArguments } from "../src/background/tab-tools";

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
});
