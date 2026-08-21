import { afterEach, describe, expect, it, vi } from "vitest";
import { dynamicToolCallSchema, executeTabTool } from "../src/background/tab-tools";

function groupCall(argumentsValue: unknown) {
  return dynamicToolCallSchema.parse({
    requestId: 1,
    threadId: "thread-1",
    turnId: "turn-1",
    callId: "call-group",
    namespace: "tabs",
    tool: "group",
    arguments: argumentsValue,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tab grouping", () => {
  it("opens and selects task tabs without stealing focus by default", async () => {
    const create = vi.fn(async ({ active }: { active: boolean }) => ({ id: 12, windowId: 4, active, title: "Calendar", url: "https://calendar.google.com", groupId: -1 }));
    const get = vi.fn(async () => ({ id: 12, windowId: 4, active: false, title: "Calendar", url: "https://calendar.google.com", groupId: -1 }));
    const update = vi.fn();
    const focusWindow = vi.fn();
    vi.stubGlobal("chrome", { tabs: { create, get, update }, windows: { update: focusWindow } });

    const openCall = dynamicToolCallSchema.parse({
      requestId: 3, threadId: "thread-1", turnId: "turn-1", callId: "call-open",
      namespace: "tabs", tool: "open", arguments: { url: "https://calendar.google.com" },
    });
    await expect(executeTabTool(openCall)).resolves.toMatchObject({ id: 12, selectedForTask: true, foregrounded: false });
    expect(create).toHaveBeenCalledWith({ url: "https://calendar.google.com", active: false });

    const activateCall = dynamicToolCallSchema.parse({
      requestId: 4, threadId: "thread-1", turnId: "turn-1", callId: "call-activate",
      namespace: "tabs", tool: "activate", arguments: { tabId: 12 },
    });
    await expect(executeTabTool(activateCall)).resolves.toMatchObject({ id: 12, selectedForTask: true, foregrounded: false });
    expect(update).not.toHaveBeenCalled();
    expect(focusWindow).not.toHaveBeenCalled();
  });

  it("foregrounds a selected tab only when explicitly requested", async () => {
    const tab = { id: 12, windowId: 4, active: false, title: "Calendar", url: "https://calendar.google.com", groupId: -1 };
    const get = vi.fn(async () => tab);
    const update = vi.fn(async () => ({ ...tab, active: true }));
    const focusWindow = vi.fn(async () => ({ id: 4, focused: true }));
    vi.stubGlobal("chrome", { tabs: { get, update }, windows: { update: focusWindow } });

    const call = dynamicToolCallSchema.parse({
      requestId: 5, threadId: "thread-1", turnId: "turn-1", callId: "call-focus",
      namespace: "tabs", tool: "activate", arguments: { tabId: 12, foreground: true },
    });
    await expect(executeTabTool(call)).resolves.toMatchObject({ id: 12, foregrounded: true });
    expect(focusWindow).toHaveBeenCalledWith(4, { focused: true });
    expect(update).toHaveBeenCalledWith(12, { active: true });
  });

  it("groups same-window tabs and applies the requested metadata", async () => {
    const get = vi.fn(async (tabId: number) => ({ id: tabId, windowId: 4, pinned: false }));
    const group = vi.fn(async () => 17);
    const update = vi.fn(async () => ({ id: 17, windowId: 4, title: "Research", color: "blue", collapsed: true }));
    vi.stubGlobal("chrome", { tabs: { get, group }, tabGroups: { update } });

    await expect(executeTabTool(groupCall({
      tabIds: [10, 11],
      title: "Research",
      color: "blue",
      collapsed: true,
    }))).resolves.toEqual({
      id: 17,
      windowId: 4,
      title: "Research",
      color: "blue",
      collapsed: true,
      tabIds: [10, 11],
    });
    expect(group).toHaveBeenCalledWith({ tabIds: [10, 11], createProperties: { windowId: 4 } });
    expect(update).toHaveBeenCalledWith(17, { title: "Research", color: "blue", collapsed: true });
  });

  it("ungroups selected tabs without closing them", async () => {
    const get = vi.fn(async (tabId: number) => ({ id: tabId, windowId: 4, pinned: false }));
    const ungroup = vi.fn(async () => undefined);
    const remove = vi.fn();
    vi.stubGlobal("chrome", { tabs: { get, ungroup, remove } });

    const call = dynamicToolCallSchema.parse({
      requestId: 2,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-ungroup",
      namespace: "tabs",
      tool: "ungroup",
      arguments: { tabIds: [10, 11] },
    });
    await expect(executeTabTool(call)).resolves.toEqual({ tabIds: [10, 11], ungrouped: true });
    expect(ungroup).toHaveBeenCalledWith([10, 11]);
    expect(remove).not.toHaveBeenCalled();
  });

  it("refuses cross-window and pinned tab selections before grouping", async () => {
    const group = vi.fn();
    const update = vi.fn();
    const crossWindowGet = vi.fn(async (tabId: number) => ({ id: tabId, windowId: tabId, pinned: false }));
    vi.stubGlobal("chrome", { tabs: { get: crossWindowGet, group }, tabGroups: { update } });
    await expect(executeTabTool(groupCall({ tabIds: [10, 11], title: "Mixed" }))).rejects.toThrow(/same browser window/i);
    expect(group).not.toHaveBeenCalled();

    const pinnedGet = vi.fn(async (tabId: number) => ({ id: tabId, windowId: 4, pinned: tabId === 10 }));
    vi.stubGlobal("chrome", { tabs: { get: pinnedGet, group }, tabGroups: { update } });
    await expect(executeTabTool(groupCall({ tabIds: [10, 11], title: "Pinned" }))).rejects.toThrow(/unpinned/i);
    expect(group).not.toHaveBeenCalled();
  });
});
