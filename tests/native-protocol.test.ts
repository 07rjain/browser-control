import { describe, expect, it } from "vitest";
import {
  encodeNativeMessage,
  JsonLineDecoder,
  LengthPrefixedJsonDecoder,
  normalizeAppServerNotification,
  isAllowedDynamicTool,
} from "../bridge/protocol.mjs";

describe("native bridge framing", () => {
  it("decodes fragmented and consecutive Chrome messages", () => {
    const decoder = new LengthPrefixedJsonDecoder();
    const first = encodeNativeMessage({ id: "one" });
    const second = encodeNativeMessage({ id: "two" });
    expect(decoder.push(first.subarray(0, 3))).toEqual([]);
    expect(decoder.push(Buffer.concat([first.subarray(3), second]))).toEqual([{ id: "one" }, { id: "two" }]);
  });

  it("decodes fragmented JSONL", () => {
    const decoder = new JsonLineDecoder();
    expect(decoder.push(Buffer.from('{"id":1'))).toEqual([]);
    expect(decoder.push(Buffer.from('}\n{"id":2}\n'))).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("normalizes only approved streamed events", () => {
    expect(
      normalizeAppServerNotification({
        method: "item/agentMessage/delta",
        params: { turnId: "turn-1", delta: "Hello" },
      }),
    ).toEqual({ event: "chat.delta", data: { turnId: "turn-1", delta: "Hello" } });
    expect(normalizeAppServerNotification({ method: "command/exec/outputDelta", params: {} })).toBeNull();
  });

  it("allows only declared tabs and page tools", () => {
    expect(isAllowedDynamicTool("tabs", "list")).toBe(true);
    expect(isAllowedDynamicTool("tabs", "group")).toBe(true);
    expect(isAllowedDynamicTool("tabs", "ungroup")).toBe(true);
    expect(isAllowedDynamicTool("page", "inspect")).toBe(true);
    expect(isAllowedDynamicTool("page", "drag")).toBe(true);
    expect(isAllowedDynamicTool("page", "submit")).toBe(true);
    expect(isAllowedDynamicTool("page", "executeScript")).toBe(false);
    expect(isAllowedDynamicTool("computer", "click")).toBe(false);
  });
});
