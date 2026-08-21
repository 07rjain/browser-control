import { beforeEach, describe, expect, it, vi } from "vitest";

interface NativeRequest {
  type: "request";
  id: string;
  method: string;
  params?: unknown;
}

function storageArea(data: Record<string, unknown>) {
  return {
    get: vi.fn(async (keys: unknown) => {
      if (typeof keys === "string") return { [keys]: data[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, data[String(key)]]));
      return { ...data };
    }),
    set: vi.fn(async (values: Record<string, unknown>) => Object.assign(data, values)),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }),
    clear: vi.fn(async () => {
      for (const key of Object.keys(data)) delete data[key];
    }),
  };
}

describe("service-worker browser orchestration", () => {
  beforeEach(() => vi.resetModules());

  it("pins before send, resumes permission on that tab, and rejects late calls", async () => {
    const sessionData: Record<string, unknown> = {};
    const localData: Record<string, unknown> = {};
    let visibleTabId = 12;
    let permissionGranted = false;
    const tabs = new Map<number, chrome.tabs.Tab>([
      [12, { id: 12, windowId: 1, index: 0, active: true, pinned: false, highlighted: true, incognito: false, selected: true, discarded: false, autoDiscardable: true, frozen: false, lastAccessed: Date.now(), groupId: -1, url: "https://calendar.google.com/calendar", title: "Calendar", status: "complete" }],
      [99, { id: 99, windowId: 1, index: 1, active: false, pinned: false, highlighted: false, incognito: false, selected: false, discarded: false, autoDiscardable: true, frozen: false, lastAccessed: Date.now(), groupId: -1, url: "https://mail.google.com/mail", title: "Mail", status: "complete" }],
    ]);
    const nativeRequests: NativeRequest[] = [];
    let turnSequence = 0;
    let nativeMessageListener: ((message: unknown) => void) | undefined;
    let removedListener: ((tabId: number) => void) | undefined;

    const query = vi.fn(async () => [tabs.get(visibleTabId)]);
    const get = vi.fn(async (tabId: number) => {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error("No tab with id");
      return tab;
    });
    const sendMessage = vi.fn(async (tabId: number, command: Record<string, unknown>) => {
      const tab = tabs.get(tabId);
      if (!tab?.url) throw new Error("Missing tab");
      const origin = new URL(tab.url).origin;
      if (command.action === "PING") return { ok: true, data: { origin } };
      if (command.action === "INSPECT") {
        return { ok: true, data: { title: tab.title, url: tab.url, origin, snapshotId: "snapshot-1", expiresAt: Date.now() + 30_000, truncated: false, unsupportedFrames: 0, elements: [] } };
      }
      if (command.action === "DESCRIBE") {
        return {
          ok: true,
          data: {
            refId: "e1",
            snapshotId: "snapshot-popup",
            role: "button",
            label: "Open workspace",
            tag: "button",
            inputType: null,
            disabled: false,
            sensitive: false,
            sameOrigin: true,
            newTab: false,
            download: false,
            formAssociated: false,
            submitter: false,
            form: null,
          },
        };
      }
      if (command.action === "CLICK") return { ok: true, data: { clicked: true, beforeUrl: tab.url, label: "Open workspace" } };
      throw new Error(`Unexpected executor action ${String(command.action)}`);
    });
    const create = vi.fn(async (properties: chrome.tabs.CreateProperties) => {
      const created = {
        id: 77,
        windowId: properties.windowId ?? 1,
        index: 2,
        active: properties.active ?? true,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: properties.active ?? true,
        discarded: false,
        autoDiscardable: true,
        frozen: false,
        lastAccessed: Date.now(),
        groupId: -1,
        url: properties.url,
        title: "Deferred workspace",
        status: "loading" as const,
      };
      tabs.set(77, created);
      return created;
    });
    const port = {
      onMessage: { addListener: (listener: (message: unknown) => void) => { nativeMessageListener = listener; } },
      onDisconnect: { addListener: vi.fn() },
      postMessage: (message: NativeRequest) => {
        nativeRequests.push(message);
        queueMicrotask(() => nativeMessageListener?.({
          type: "response",
          id: message.id,
          ok: true,
          data: message.method === "chat.send" ? { turnId: `turn-${++turnSequence}` } : {},
        }));
      },
    };

    vi.stubGlobal("chrome", {
      runtime: {
        id: "extension-id",
        connectNative: () => port,
        sendMessage: vi.fn(async () => undefined),
        onMessage: { addListener: vi.fn() },
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
      },
      storage: { session: storageArea(sessionData), local: storageArea(localData) },
      tabs: {
        query,
        get,
        sendMessage,
        reload: vi.fn(async () => undefined),
        create,
        onRemoved: { addListener: (listener: (tabId: number) => void) => { removedListener = listener; } },
      },
      permissions: { contains: vi.fn(async () => permissionGranted) },
      scripting: {
        executeScript: vi.fn(async (injection: { func?: { name?: string } }) =>
          injection.func?.name === "releasePopupGuardInPage"
            ? [{ frameId: 0, result: { attempted: 1, urls: ["https://example.com/deferred-workspace"] } }]
            : []),
      },
      sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
    });

    const { serviceWorkerTestHooks } = await import("../src/background/service-worker");
    const requestId = () => crypto.randomUUID();
    await expect(serviceWorkerTestHooks.routeRequest({
      type: "CHAT_SEND",
      requestId: requestId(),
      threadId: "thread-1",
      clientMessageId: requestId(),
      text: "Inspect my calendar",
    })).resolves.toEqual({ turnId: "turn-1" });

    visibleTabId = 99;
    const inspectCall = {
      requestId: 10,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-inspect",
      namespace: "page" as const,
      tool: "inspect" as const,
      arguments: { idempotencyKey: "inspect-00000001" },
    };
    await serviceWorkerTestHooks.handleDynamicToolCall(inspectCall);
    const browserState = await serviceWorkerTestHooks.routeRequest({ type: "BROWSER_STATE_READ", requestId: requestId() }) as { prompts: Array<{ type: string; data: { callId: string; originPattern: string } }> };
    expect(browserState.prompts).toContainEqual(expect.objectContaining({
      type: "permission",
      data: expect.objectContaining({ callId: "call-inspect", originPattern: "https://calendar.google.com/*" }),
    }));

    permissionGranted = true;
    await expect(serviceWorkerTestHooks.routeRequest({
      type: "PAGE_CONTROL_PERMISSION_RESULT",
      requestId: requestId(),
      callId: "call-inspect",
      originPattern: "https://calendar.google.com/*",
      granted: true,
    })).resolves.toEqual({ continued: true });
    expect(sendMessage).toHaveBeenCalledWith(12, expect.objectContaining({ action: "INSPECT" }));
    expect(query).toHaveBeenCalledTimes(1);

    permissionGranted = false;
    await expect(serviceWorkerTestHooks.routeRequest({
      type: "CHAT_SEND",
      requestId: requestId(),
      threadId: "thread-2",
      clientMessageId: requestId(),
      text: "Inspect mail",
    })).resolves.toEqual({ turnId: "turn-2" });
    await serviceWorkerTestHooks.handleDynamicToolCall({
      ...inspectCall,
      requestId: 12,
      threadId: "thread-2",
      turnId: "turn-2",
      callId: "call-closed-permission",
      arguments: { idempotencyKey: "inspect-00000002" },
    });
    tabs.delete(99);
    permissionGranted = true;
    await expect(serviceWorkerTestHooks.routeRequest({
      type: "PAGE_CONTROL_PERMISSION_RESULT",
      requestId: requestId(),
      callId: "call-closed-permission",
      originPattern: "https://mail.google.com/*",
      granted: true,
    })).rejects.toThrow(/No tab/i);
    expect(nativeRequests).toContainEqual(expect.objectContaining({
      method: "tool.respond",
      params: expect.objectContaining({ success: false }),
    }));

    await serviceWorkerTestHooks.finishBrowserTurn("turn-1");
    const queryCount = query.mock.calls.length;
    await serviceWorkerTestHooks.handleDynamicToolCall({
      requestId: 11,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-late",
      namespace: "tabs",
      tool: "list",
      arguments: {},
    });
    expect(query).toHaveBeenCalledTimes(queryCount);
    expect(nativeRequests).toContainEqual(expect.objectContaining({
      method: "tool.respond",
      params: expect.objectContaining({ success: false }),
    }));

    removedListener?.(12);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(serviceWorkerTestHooks.getThreadWorkingTab("thread-1")).resolves.toBeUndefined();

    visibleTabId = 12;
    await expect(serviceWorkerTestHooks.routeRequest({
      type: "CHAT_SEND",
      requestId: requestId(),
      threadId: "thread-popup",
      clientMessageId: requestId(),
      text: "Open the workspace popup",
    })).resolves.toEqual({ turnId: "turn-3" });
    await serviceWorkerTestHooks.handleDynamicToolCall({
      requestId: 13,
      threadId: "thread-popup",
      turnId: "turn-3",
      callId: "call-popup",
      namespace: "page",
      tool: "click",
      arguments: {
        idempotencyKey: "click-popup-00001",
        ref: { id: "e1", snapshotId: "snapshot-popup", tabId: 12, origin: "https://calendar.google.com" },
      },
    });
    expect(create).toHaveBeenCalledWith({
      url: "https://example.com/deferred-workspace",
      active: false,
      windowId: 1,
    });
    await expect(serviceWorkerTestHooks.getThreadWorkingTab("thread-popup")).resolves.toBe(77);
  });
});
