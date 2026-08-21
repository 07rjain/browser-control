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

  it("skips tab-close approval by default and restores it in ask mode", async () => {
    const sessionData: Record<string, unknown> = {
      codexSidebarBrowserTasks: [{
        key: "thread-full:turn-full",
        threadId: "thread-full",
        turnId: "turn-full",
        actionCount: 0,
        permissionMode: "corrupted",
        canceled: false,
        updatedAt: Date.now(),
      }],
    };
    const localData: Record<string, unknown> = {};
    const remove = vi.fn(async () => undefined);
    let nativeMessageListener: ((message: unknown) => void) | undefined;
    const port = {
      onMessage: { addListener: (listener: (message: unknown) => void) => { nativeMessageListener = listener; } },
      onDisconnect: { addListener: vi.fn() },
      postMessage: (message: NativeRequest) => queueMicrotask(() => nativeMessageListener?.({
        type: "response",
        id: message.id,
        ok: true,
        data: {},
      })),
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
        get: vi.fn(async (tabId: number) => ({
          id: tabId,
          windowId: 1,
          index: 0,
          active: false,
          pinned: false,
          highlighted: false,
          incognito: false,
          selected: false,
          discarded: false,
          autoDiscardable: true,
          frozen: false,
          lastAccessed: Date.now(),
          groupId: -1,
          title: `Tab ${tabId}`,
          url: `https://example.com/${tabId}`,
        })),
        remove,
        onRemoved: { addListener: vi.fn() },
      },
      sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
    });

    const { serviceWorkerTestHooks } = await import("../src/background/service-worker");
    await serviceWorkerTestHooks.handleDynamicToolCall({
      requestId: 1,
      threadId: "thread-full",
      turnId: "turn-full",
      callId: "close-full",
      namespace: "tabs",
      tool: "close",
      arguments: { tabId: 21 },
    });
    expect(remove).toHaveBeenCalledWith(21);
    expect(sessionData.codexSidebarBrowserTasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "thread-full:turn-full", permissionMode: "full" }),
    ]));

    localData.codexSidebarBrowserPermissionMode = "ask";
    await serviceWorkerTestHooks.handleDynamicToolCall({
      requestId: 2,
      threadId: "thread-ask",
      turnId: "turn-ask",
      callId: "close-ask",
      namespace: "tabs",
      tool: "close",
      arguments: { tabId: 22 },
    });
    expect(remove).not.toHaveBeenCalledWith(22);
    await expect(serviceWorkerTestHooks.routeRequest({
      type: "BROWSER_STATE_READ",
      requestId: crypto.randomUUID(),
    })).resolves.toMatchObject({
      prompts: [expect.objectContaining({
        type: "approval",
        data: expect.objectContaining({ callId: "close-ask", title: "Close this tab?" }),
      })],
    });
  });

  it("executes consequential page actions in full mode, captures the mode per task, and prompts in ask mode", async () => {
    const sessionData: Record<string, unknown> = {
      codexSidebarThreadWorkingTabs: [
        { threadId: "thread-full", tabId: 12, updatedAt: Date.now() },
        { threadId: "thread-ask", tabId: 12, updatedAt: Date.now() },
      ],
    };
    const localData: Record<string, unknown> = {
      codexSidebarTaskControlOrigins: ["https://example.com/*"],
    };
    const executorActions: string[] = [];
    let nativeMessageListener: ((message: unknown) => void) | undefined;
    const tab = {
      id: 12,
      windowId: 1,
      index: 0,
      active: true,
      pinned: false,
      highlighted: true,
      incognito: false,
      selected: true,
      discarded: false,
      autoDiscardable: true,
      frozen: false,
      lastAccessed: Date.now(),
      groupId: -1,
      title: "Permission fixture",
      url: "https://example.com/form",
      status: "complete" as const,
    };
    const targetFor = (refId: unknown) => {
      if (refId === "submit") {
        return {
          refId: "submit", snapshotId: "snapshot-1", role: "button", label: "Submit local test", tag: "button",
          inputType: null, disabled: false, sensitive: false, sameOrigin: true, newTab: false, download: false,
          formAssociated: true, submitter: true,
          form: {
            action: "https://example.com/form",
            method: "POST",
            fields: [{ name: "Name", value: "Codex test", sensitive: false }],
          },
        };
      }
      if (refId === "enter") {
        return {
          refId: "enter", snapshotId: "snapshot-1", role: "textbox", label: "Name", tag: "input",
          inputType: "text", disabled: false, sensitive: false, sameOrigin: true, newTab: false, download: false,
          formAssociated: true, submitter: false, form: null,
        };
      }
      return {
        refId: "save", snapshotId: "snapshot-1", role: "button", label: "Save event", tag: "button",
        inputType: null, disabled: false, sensitive: false, sameOrigin: true, newTab: false, download: false,
        formAssociated: false, submitter: false, form: null,
      };
    };
    const sendMessage = vi.fn(async (_tabId: number, command: Record<string, unknown>) => {
      if (command.action === "PING") return { ok: true, data: { origin: "https://example.com" } };
      if (command.action === "DESCRIBE") return { ok: true, data: targetFor(command.refId) };
      if (["SUBMIT", "CLICK", "KEYPRESS"].includes(String(command.action))) {
        executorActions.push(String(command.action));
        return { ok: true, data: { completed: true } };
      }
      throw new Error(`Unexpected executor action ${String(command.action)}`);
    });
    const port = {
      onMessage: { addListener: (listener: (message: unknown) => void) => { nativeMessageListener = listener; } },
      onDisconnect: { addListener: vi.fn() },
      postMessage: (message: NativeRequest) => queueMicrotask(() => nativeMessageListener?.({
        type: "response",
        id: message.id,
        ok: true,
        data: {},
      })),
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
        get: vi.fn(async () => tab),
        sendMessage,
        create: vi.fn(),
        onRemoved: { addListener: vi.fn() },
      },
      permissions: { contains: vi.fn(async () => true) },
      scripting: {
        executeScript: vi.fn(async (injection: { func?: unknown }) =>
          injection.func
            ? [{ frameId: 0, result: { attempted: 0, urls: [] } }]
            : []),
      },
      sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
    });

    const { serviceWorkerTestHooks } = await import("../src/background/service-worker");
    const ref = (id: string) => ({ id, snapshotId: "snapshot-1", tabId: 12, origin: "https://example.com" });
    const pageCall = (threadId: string, turnId: string, callId: string, tool: "submit" | "click" | "keypress", id: string) => ({
      requestId: callId,
      threadId,
      turnId,
      callId,
      namespace: "page" as const,
      tool,
      arguments: {
        idempotencyKey: `${callId}-idempotency`,
        ref: ref(id),
        ...(tool === "keypress" ? { key: "Enter" } : {}),
      },
    });

    await serviceWorkerTestHooks.handleDynamicToolCall(pageCall("thread-full", "turn-full", "full-submit", "submit", "submit"));
    localData.codexSidebarBrowserPermissionMode = "ask";
    await serviceWorkerTestHooks.handleDynamicToolCall(pageCall("thread-full", "turn-full", "full-save", "click", "save"));
    await serviceWorkerTestHooks.handleDynamicToolCall(pageCall("thread-full", "turn-full", "full-enter", "keypress", "enter"));
    expect(executorActions).toEqual(["SUBMIT", "CLICK", "KEYPRESS"]);

    await serviceWorkerTestHooks.handleDynamicToolCall(pageCall("thread-ask", "turn-ask", "ask-submit", "submit", "submit"));
    await serviceWorkerTestHooks.handleDynamicToolCall(pageCall("thread-ask", "turn-ask", "ask-save", "click", "save"));
    await serviceWorkerTestHooks.handleDynamicToolCall(pageCall("thread-ask", "turn-ask", "ask-enter", "keypress", "enter"));
    expect(executorActions).toEqual(["SUBMIT", "CLICK", "KEYPRESS"]);

    const browserState = await serviceWorkerTestHooks.routeRequest({
      type: "BROWSER_STATE_READ",
      requestId: crypto.randomUUID(),
    }) as {
      activities: Array<Record<string, unknown>>;
      prompts: Array<{ type: string; data: { callId: string } }>;
    };
    expect(browserState.prompts.map((prompt) => prompt.data.callId)).toEqual(expect.arrayContaining([
      "ask-submit", "ask-save", "ask-enter",
    ]));
    expect(browserState.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        callId: "full-submit",
        status: "running",
        permissionMode: "full",
        confirmationBypassed: true,
        target: expect.objectContaining({
          label: "Submit local test",
          form: expect.objectContaining({ fields: [{ name: "Name", value: "Codex test", sensitive: false }] }),
        }),
      }),
    ]));
    expect(sessionData.codexSidebarBrowserTasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "thread-full:turn-full", permissionMode: "full" }),
      expect.objectContaining({ key: "thread-ask:turn-ask", permissionMode: "ask" }),
    ]));
  });

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
    const indicatorStates: Array<{ tabId: number; active: boolean }> = [];
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
      if (command.action === "TASK_INDICATOR") {
        indicatorStates.push({ tabId, active: Boolean(command.active) });
        return { ok: true, data: { active: Boolean(command.active) } };
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
    const update = vi.fn(async (tabId: number, properties: chrome.tabs.UpdateProperties) => ({
      ...tabs.get(tabId),
      active: properties.active ?? tabs.get(tabId)?.active ?? false,
    } as chrome.tabs.Tab));
    const updateWindow = vi.fn(async (windowId: number, properties: chrome.windows.UpdateInfo) => ({
      id: windowId,
      focused: properties.focused ?? false,
      alwaysOnTop: false,
      incognito: false,
      type: "normal" as const,
      state: "normal" as const,
    }));
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
        update,
        create,
        onRemoved: { addListener: (listener: (tabId: number) => void) => { removedListener = listener; } },
      },
      windows: { update: updateWindow },
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
    expect(serviceWorkerTestHooks.isTrustedUiSender({ id: "extension-id" })).toBe(true);
    expect(serviceWorkerTestHooks.isTrustedUiSender({ id: "extension-id", tab: tabs.get(12) })).toBe(false);
    const requestId = () => crypto.randomUUID();
    await expect(serviceWorkerTestHooks.routeRequest({
      type: "CHAT_SEND",
      requestId: requestId(),
      threadId: "thread-1",
      clientMessageId: requestId(),
      text: "Inspect my calendar",
    })).resolves.toEqual({ turnId: "turn-1" });

    visibleTabId = 99;
    await expect(serviceWorkerTestHooks.routeRequest({
      type: "WORKING_TAB_FOCUS",
      requestId: requestId(),
      threadId: "thread-1",
    })).resolves.toMatchObject({ tabId: 12, title: "Calendar" });
    expect(updateWindow).toHaveBeenCalledWith(1, { focused: true });
    expect(update).toHaveBeenCalledWith(12, { active: true });
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
    expect(indicatorStates).toContainEqual({ tabId: 12, active: true });
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
    expect(indicatorStates.at(-1)).toEqual({ tabId: 12, active: false });
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

    visibleTabId = 12;
    localData.codexSidebarTaskControlOrigins = [];
    localData.codexSidebarFullAccessHostGrant = true;
    const indicatorCount = indicatorStates.length;
    await expect(serviceWorkerTestHooks.routeRequest({
      type: "CHAT_SEND",
      requestId: requestId(),
      threadId: "thread-3",
      clientMessageId: requestId(),
      text: "Check my calendar again",
    })).resolves.toEqual({ turnId: "turn-3" });
    expect(indicatorStates).toHaveLength(indicatorCount);
    await serviceWorkerTestHooks.handleDynamicToolCall({
      ...inspectCall,
      requestId: 14,
      threadId: "thread-3",
      turnId: "turn-3",
      callId: "call-inspect-again",
      arguments: { idempotencyKey: "inspect-00000003" },
    });
    expect(indicatorStates.at(-1)).toEqual({ tabId: 12, active: true });
    await expect(serviceWorkerTestHooks.routeRequest({
      type: "BROWSER_STATE_READ",
      requestId: requestId(),
    })).resolves.toMatchObject({
      prompts: expect.not.arrayContaining([
        expect.objectContaining({ data: expect.objectContaining({ callId: "call-inspect-again" }) }),
      ]),
    });
    await serviceWorkerTestHooks.handleDynamicToolCall({
      requestId: 15,
      threadId: "thread-3",
      turnId: "turn-3",
      callId: "call-open-calendar",
      namespace: "tabs",
      tool: "open",
      arguments: { url: "https://calendar.google.com/calendar/day" },
    });
    expect(indicatorStates.slice(-2)).toEqual([
      { tabId: 12, active: false },
      { tabId: 77, active: true },
    ]);
    await serviceWorkerTestHooks.routeRequest({
      type: "BROWSER_TASK_CANCEL",
      requestId: requestId(),
      threadId: "thread-3",
      turnId: "turn-3",
    });
    expect(indicatorStates.at(-1)).toEqual({ tabId: 77, active: false });

    removedListener?.(12);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(serviceWorkerTestHooks.getThreadWorkingTab("thread-1")).resolves.toBeUndefined();

  });

  it("opens a captured popup in the background even when the click reports an error", async () => {
    const sessionData: Record<string, unknown> = {};
    const localData: Record<string, unknown> = {};
    const create = vi.fn(async (properties: chrome.tabs.CreateProperties) => ({
      id: 77,
      windowId: properties.windowId ?? 1,
      url: properties.url,
      title: "Deferred workspace",
      active: properties.active ?? true,
    }));
    vi.stubGlobal("chrome", {
      runtime: {
        id: "extension-id",
        sendMessage: vi.fn(async () => undefined),
        onMessage: { addListener: vi.fn() },
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
      },
      storage: { session: storageArea(sessionData), local: storageArea(localData) },
      tabs: {
        get: vi.fn(async (tabId: number) => {
          if (tabId === 12) throw new Error("No tab with id");
          return { id: 77, windowId: 1, url: "https://example.com/deferred-workspace" };
        }),
        create,
        onRemoved: { addListener: vi.fn() },
      },
      sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
    });

    const { serviceWorkerTestHooks } = await import("../src/background/service-worker");
    const result = await serviceWorkerTestHooks.processCapturedPopup({
      requestId: 13,
      threadId: "thread-popup",
      turnId: "turn-popup",
      callId: "call-popup",
      namespace: "page",
      tool: "click",
      arguments: {
        idempotencyKey: "click-popup-00001",
        ref: { id: "e1", snapshotId: "snapshot-popup", tabId: 12, origin: "https://calendar.google.com" },
      },
    }, {
      key: "thread-popup:turn-popup",
      threadId: "thread-popup",
      turnId: "turn-popup",
      actionCount: 0,
      canceled: false,
      authorizedTabId: 12,
      updatedAt: Date.now(),
    }, {
      clicked: false,
      actionError: "Executor response failed after dispatch.",
      popupAttempts: 1,
      popupUrls: ["https://example.com/deferred-workspace"],
    });

    expect(create).toHaveBeenCalledWith({
      url: "https://example.com/deferred-workspace",
      active: false,
    });
    expect(result).toEqual(expect.objectContaining({
      actionError: "Executor response failed after dispatch.",
      openedPopupTabId: 77,
      openedInBackground: true,
    }));
    expect(serviceWorkerTestHooks.actionResultFailed(result)).toBe(true);
    expect(serviceWorkerTestHooks.actionResultFailed({ clicked: true })).toBe(false);
    await expect(serviceWorkerTestHooks.getThreadWorkingTab("thread-popup")).resolves.toBe(77);
  });
});
