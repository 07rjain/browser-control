// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { executePageTool, runPopupGuardInPage } from "../src/background/page-executor-host";
import { pageToolCallSchema } from "../src/shared/page-tools";

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean;
type InjectionMode = "normal" | "hang-before-install" | "reject-after-click" | "hang-after-install" | "forge-report";

let listener: Listener;
let failClickAfterDispatch = false;
let injectionMode: InjectionMode = "normal";
let injectionDelayMs = 0;
let clickHappened = false;
let tabsAfterClick: chrome.tabs.Tab[] = [];
let rejectInjection: ((error: Error) => void) | undefined;
let events: string[] = [];
const nativeOpen = window.open;

const baseTab = (): chrome.tabs.Tab => ({
  id: 1,
  windowId: 1,
  url: location.href,
  title: "Popup test",
  status: "complete",
  discarded: false,
} as chrome.tabs.Tab);

beforeAll(async () => {
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension-id",
      onMessage: {
        addListener: (registered: Listener) => {
          listener = registered;
        },
      },
    },
    tabs: {
      get: vi.fn(async () => baseTab()),
      query: vi.fn(async () => [baseTab(), ...(clickHappened ? tabsAfterClick : [])]),
      sendMessage: vi.fn(async (_tabId: number, message: unknown) => {
        let response: unknown;
        const action = (message as { action?: unknown }).action;
        if (action === "CLICK") events.push("click");
        listener(message, { id: "extension-id" }, (value) => {
          response = value;
        });
        if (action === "CLICK") {
          clickHappened = true;
          if (injectionMode === "reject-after-click") rejectInjection?.(new Error("Frame with ID 0 was removed."));
          if (failClickAfterDispatch) return { ok: false, error: "Executor response failed after dispatch." };
        }
        return response;
      }),
      reload: vi.fn(async () => undefined),
    },
    permissions: { contains: vi.fn(async () => true) },
    scripting: {
      executeScript: vi.fn(async (injection: { func?: (...args: Array<string | number>) => unknown; args?: Array<string | number> }) => {
        if (!injection.func) return [];
        if (injection.func !== runPopupGuardInPage) return [{ frameId: 0, result: await injection.func(...(injection.args ?? [])) }];
        if (injectionMode === "hang-before-install") return new Promise(() => undefined);
        if (injectionDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, injectionDelayMs));
        events.push("install");
        const report = injection.func(...(injection.args ?? []));
        if (injectionMode === "reject-after-click") {
          return new Promise((_resolve, reject) => {
            rejectInjection = reject;
          });
        }
        if (injectionMode === "hang-after-install") return new Promise(() => undefined);
        if (injectionMode === "forge-report") {
          return [{ frameId: 0, result: { attempted: 1, urls: ["https://a.example/1", "https://b.example/2"] } }];
        }
        return [{ frameId: 0, result: await report }];
      }),
    },
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 30, width: 120, height: 30, toJSON: () => ({}) }),
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => document.querySelector("button"),
  });
  await import("../src/content/page-executor");
});

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-codex-popup-guard");
  window.open = nativeOpen;
  failClickAfterDispatch = false;
  injectionMode = "normal";
  injectionDelayMs = 0;
  clickHappened = false;
  tabsAfterClick = [];
  rejectInjection = undefined;
  events = [];
});

afterEach(() => vi.useRealTimers());

let requestCounter = 0;

async function inspectButton(label: string): Promise<Record<string, unknown> | undefined> {
  requestCounter += 1;
  const inspection = await executePageTool(pageToolCallSchema.parse({
    requestId: requestCounter,
    threadId: "thread-1",
    turnId: "turn-1",
    callId: `inspect-${requestCounter}`,
    namespace: "page",
    tool: "inspect",
    arguments: { idempotencyKey: `inspect-popup-${String(requestCounter).padStart(6, "0")}` },
  }), 1) as { elements: Array<{ label: string; ref: Record<string, unknown> }> };
  return inspection.elements.find((element) => element.label === label)?.ref;
}

function click(ref: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
  requestCounter += 1;
  return executePageTool(pageToolCallSchema.parse({
    requestId: requestCounter,
    threadId: "thread-1",
    turnId: "turn-1",
    callId: `click-${requestCounter}`,
    namespace: "page",
    tool: "click",
    arguments: { idempotencyKey: `click-popup-${String(requestCounter).padStart(6, "0")}`, ref },
  }), 1) as Promise<Record<string, unknown>>;
}

describe("page executor host popup guard", () => {
  it("captures a deferred popup without exposing a guard control on window.open", async () => {
    document.body.innerHTML = `<button id="launch">Open deferred workspace</button>`;
    const button = document.getElementById("launch") as HTMLButtonElement;
    button.addEventListener("click", () => {
      setTimeout(() => window.open("/late-workspace", "_blank"), 300);
      setTimeout(() => window.open("/blocked-after-quiet", "_blank"), 400);
    });
    const originalOpen = vi.fn(() => null);
    window.open = originalOpen;
    const launch = await inspectButton("Open deferred workspace");

    vi.useFakeTimers();
    const clickPromise = click(launch);
    let settled = false;
    void clickPromise.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1);
    const guarded = window.open as unknown as Record<string, unknown>;
    const exposedFunctions = Object.getOwnPropertyNames(guarded)
      .filter((key) => typeof guarded[key] === "function" && guarded[key] !== originalOpen);
    expect(exposedFunctions).toEqual([]);
    await vi.advanceTimersByTimeAsync(348);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await clickPromise;

    expect(result).toEqual(expect.objectContaining({
      clicked: true,
      popupAttempts: 1,
      popupUrls: ["http://localhost:3000/late-workspace"],
      popupCollectionFailed: false,
      createdTabs: [],
    }));
    expect(originalOpen).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(75);
    expect(originalOpen).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_600);
    expect(window.open).toBe(originalOpen);
    expect(document.documentElement.hasAttribute("data-codex-popup-guard")).toBe(false);
  });

  it("rethrows a click failure instead of reporting popups captured during it", async () => {
    document.body.innerHTML = `<button id="launch-error">Open before error</button>`;
    const button = document.getElementById("launch-error") as HTMLButtonElement;
    button.addEventListener("click", () => {
      window.open("/captured-before-error", "_blank");
    });
    const launch = await inspectButton("Open before error");
    failClickAfterDispatch = true;

    vi.useFakeTimers();
    const assertion = expect(click(launch)).rejects.toThrow("Executor response failed after dispatch.");
    await vi.advanceTimersByTimeAsync(75);
    await assertion;
    await vi.advanceTimersByTimeAsync(2_000);
  });

  it("returns an ordinary no-popup click after the quiet window", async () => {
    document.body.innerHTML = `<button id="ordinary">Open menu</button>`;
    const ordinary = await inspectButton("Open menu");
    vi.useFakeTimers();

    const clickPromise = click(ordinary);
    let settled = false;
    void clickPromise.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(349);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(clickPromise).resolves.toEqual(expect.objectContaining({
      clicked: true,
      popupAttempts: 0,
      popupUrls: [],
      popupBlocked: false,
    }));
    await vi.advanceTimersByTimeAsync(1_650);
  });

  it("waits for a delayed guard injection before clicking", async () => {
    document.body.innerHTML = `<button id="delayed">Open workspace</button>`;
    const originalOpen = vi.fn(() => null);
    window.open = originalOpen;
    document.getElementById("delayed")?.addEventListener("click", () => window.open("/workspace", "_blank"));
    const ref = await inspectButton("Open workspace");
    injectionDelayMs = 120;

    vi.useFakeTimers();
    const clickPromise = click(ref);
    await vi.advanceTimersByTimeAsync(119);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    const result = await clickPromise;

    expect(events).toEqual(["install", "click"]);
    expect(originalOpen).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ popupUrls: ["http://localhost:3000/workspace"] }));
    await vi.advanceTimersByTimeAsync(2_000);
  });

  it("does not click when the page forges the ready flag but the guard never installs", async () => {
    document.body.innerHTML = `<button id="forged">Open workspace</button>`;
    const handler = vi.fn();
    document.getElementById("forged")?.addEventListener("click", handler);
    const ref = await inspectButton("Open workspace");
    injectionMode = "hang-before-install";
    document.documentElement.setAttribute("data-codex-popup-guard", "forged-guard-id");

    vi.useFakeTimers();
    const assertion = expect(click(ref)).rejects.toThrow(/could not prepare this click safely/);
    await vi.advanceTimersByTimeAsync(1_100);
    await assertion;
    expect(handler).not.toHaveBeenCalled();
    expect(events).not.toContain("click");
  });

  it("does not click when the page prevents window.open from being replaced", async () => {
    document.body.innerHTML = `<button id="locked">Open workspace</button>`;
    const handler = vi.fn();
    document.getElementById("locked")?.addEventListener("click", handler);
    const ref = await inspectButton("Open workspace");
    const lockedOpen = vi.fn(() => null);
    Object.defineProperty(window, "open", { configurable: true, writable: false, value: lockedOpen });

    try {
      await expect(click(ref)).rejects.toThrow(/could not prepare this click safely/);
      expect(handler).not.toHaveBeenCalled();
      expect(document.documentElement.hasAttribute("data-codex-popup-guard")).toBe(false);
    } finally {
      Object.defineProperty(window, "open", { configurable: true, writable: true, value: nativeOpen });
    }
  });

  it("treats an injection rejected by navigation as an ordinary click", async () => {
    document.body.innerHTML = `<button id="navigate">Go to next page</button>`;
    const ref = await inspectButton("Go to next page");
    injectionMode = "reject-after-click";

    vi.useFakeTimers();
    const clickPromise = click(ref);
    await vi.advanceTimersByTimeAsync(1);
    await expect(clickPromise).resolves.toEqual(expect.objectContaining({
      clicked: true,
      popupAttempts: 0,
      popupBlocked: false,
      popupCollectionFailed: false,
    }));
    await vi.advanceTimersByTimeAsync(2_000);
  });

  it("fails popup collection closed when the injection never settles", async () => {
    document.body.innerHTML = `<button id="hang">Open workspace</button>`;
    const ref = await inspectButton("Open workspace");
    injectionMode = "hang-after-install";

    vi.useFakeTimers();
    const clickPromise = click(ref);
    let settled = false;
    void clickPromise.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(2_499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(clickPromise).resolves.toEqual(expect.objectContaining({
      popupBlocked: true,
      popupCollectionFailed: true,
      popupUrls: [],
    }));
  });

  it("rejects a malformed popup report forged by the page", async () => {
    document.body.innerHTML = `<button id="forge">Open workspace</button>`;
    const ref = await inspectButton("Open workspace");
    injectionMode = "forge-report";

    vi.useFakeTimers();
    const clickPromise = click(ref);
    await vi.advanceTimersByTimeAsync(1);
    await expect(clickPromise).resolves.toEqual(expect.objectContaining({
      popupCollectionFailed: true,
      popupUrls: [],
    }));
    await vi.advanceTimersByTimeAsync(2_000);
  });

  it("only reports new tabs opened by the task's working tab", async () => {
    document.body.innerHTML = `<button id="native">Open native popup</button>`;
    const ref = await inspectButton("Open native popup");
    tabsAfterClick = [
      { id: 2, windowId: 1, openerTabId: 1, pendingUrl: "https://example.com/opened", url: "", active: true },
      { id: 3, windowId: 1, openerTabId: 9, url: "https://unrelated.example/", active: false },
      { id: 4, windowId: 2, url: "https://user-opened.example/", active: true },
    ] as chrome.tabs.Tab[];

    vi.useFakeTimers();
    const clickPromise = click(ref);
    await vi.advanceTimersByTimeAsync(350);
    const result = await clickPromise;
    expect(result.createdTabs).toEqual([{ id: 2, url: "https://example.com/opened", title: "", active: true }]);
    expect(result.popupAttempts).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
  });

  it("serializes overlapping clicks on one tab and restores the native window.open", async () => {
    document.body.innerHTML = `<button id="first">First</button>`;
    const originalOpen = vi.fn(() => null);
    window.open = originalOpen;
    const first = await inspectButton("First");

    vi.useFakeTimers();
    const firstClick = click(first);
    const secondClick = click(first);
    await vi.advanceTimersByTimeAsync(800);
    await expect(firstClick).resolves.toEqual(expect.objectContaining({ clicked: true }));
    await expect(secondClick).resolves.toEqual(expect.objectContaining({ clicked: true }));

    expect(events).toEqual(["install", "click", "install", "click"]);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(window.open).toBe(originalOpen);
  });
});
