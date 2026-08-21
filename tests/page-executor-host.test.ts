import { afterEach, describe, expect, it, vi } from "vitest";
import { currentControlOrigin, executePageTool } from "../src/background/page-executor-host";
import { pageToolCallSchema } from "../src/shared/page-tools";

describe("task working-tab isolation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves a pinned working tab without querying the visible tab", async () => {
    const get = vi.fn(async () => ({ id: 12, url: "https://calendar.google.com/calendar", title: "Calendar", discarded: false }));
    const query = vi.fn();
    vi.stubGlobal("chrome", { tabs: { get, query } });

    await expect(currentControlOrigin(12)).resolves.toEqual({
      tabId: 12,
      origin: "https://calendar.google.com",
      originPattern: "https://calendar.google.com/*",
    });
    expect(get).toHaveBeenCalledWith(12);
    expect(query).not.toHaveBeenCalled();
  });

  it("reloads a discarded pinned tab before using it", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ id: 12, url: "https://example.com", discarded: true })
      .mockResolvedValueOnce({ id: 12, url: "https://example.com", discarded: false });
    const reload = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", { tabs: { get, reload } });

    await expect(currentControlOrigin(12)).resolves.toMatchObject({ tabId: 12, origin: "https://example.com" });
    expect(reload).toHaveBeenCalledWith(12);
  });

  it("rejects an element reference from a different tab", async () => {
    const call = pageToolCallSchema.parse({
      requestId: 1,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-fill",
      namespace: "page",
      tool: "fill",
      arguments: {
        idempotencyKey: "fill-00000001",
        ref: { id: "e1", snapshotId: "snapshot-1", tabId: 12, origin: "https://example.com" },
        value: "hello",
        mode: "replace",
      },
    });

    await expect(executePageTool(call, 99)).rejects.toThrow(/working tab/i);
  });
});
