// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  executePageTool,
  installPopupGuardInPage,
  waitForPopupGuardQuietInPage,
} from "../src/background/page-executor-host";
import { pageToolCallSchema } from "../src/shared/page-tools";

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean;

let listener: Listener;
let guardWasEnumerable = false;
let guardUsedStableName = false;
let failClickAfterDispatch = false;
let failTabGetAfterCapture = false;

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
      get: vi.fn(async () => {
        if (failTabGetAfterCapture) throw new Error("No tab with id");
        return {
          id: 1,
          windowId: 1,
          url: location.href,
          title: "Popup test",
          status: "complete",
          discarded: false,
        };
      }),
      sendMessage: vi.fn(async (_tabId: number, message: unknown) => {
        let response: unknown;
        listener(message, { id: "extension-id" }, (value) => {
          response = value;
        });
        if (failClickAfterDispatch && (message as { action?: unknown }).action === "CLICK") {
          return { ok: false, error: "Executor response failed after dispatch." };
        }
        return response;
      }),
      reload: vi.fn(async () => undefined),
    },
    permissions: { contains: vi.fn(async () => true) },
    scripting: {
      executeScript: vi.fn(async (injection: { func?: (...args: Array<string | number>) => unknown; args?: Array<string | number> }) => {
        if (!injection.func) return [];
        const result = await injection.func(...(injection.args ?? []));
        if (injection.func === installPopupGuardInPage) {
          const guardId = String(injection.args?.[0] ?? "");
          guardWasEnumerable = Object.prototype.propertyIsEnumerable.call(window.open, `__codexSidebarPopupGuardControlV3_${guardId}`);
          guardUsedStableName = Object.hasOwn(window.open, "__codexSidebarPopupGuardControlV3");
        }
        if (injection.func === waitForPopupGuardQuietInPage) failTabGetAfterCapture = true;
        return [{ frameId: 0, result }];
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
  guardWasEnumerable = false;
  guardUsedStableName = false;
  failClickAfterDispatch = false;
  failTabGetAfterCapture = false;
});

afterEach(() => vi.useRealTimers());

describe("page executor host popup guard", () => {
  it("captures a popup deferred beyond the former 150ms snapshot", async () => {
    document.body.innerHTML = `<button id="launch">Open deferred workspace</button>`;
    const button = document.getElementById("launch") as HTMLButtonElement;
    button.addEventListener("click", () => {
      setTimeout(() => window.open("/late-workspace", "_blank"), 300);
      setTimeout(() => window.open("/blocked-after-quiet", "_blank"), 400);
    });
    const originalOpen = vi.fn(() => null);
    window.open = originalOpen;
    const inspection = await executePageTool(pageToolCallSchema.parse({
      requestId: 1,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "inspect-popup",
      namespace: "page",
      tool: "inspect",
      arguments: { idempotencyKey: "inspect-popup-0001" },
    }), 1) as { snapshotId: string; elements: Array<{ label: string; ref: Record<string, unknown> }> };
    const launch = inspection.elements.find((element) => element.label === "Open deferred workspace");

    vi.useFakeTimers();
    const clickPromise = executePageTool(pageToolCallSchema.parse({
      requestId: 2,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "click-popup",
      namespace: "page",
      tool: "click",
      arguments: { idempotencyKey: "click-popup-00001", ref: launch?.ref },
    }), 1) as Promise<Record<string, unknown>>;
    let settled = false;
    void clickPromise.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(349);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await clickPromise;

    expect(result).toEqual(expect.objectContaining({
      clicked: true,
      popupAttempts: 1,
      popupUrls: ["http://localhost:3000/late-workspace"],
      popupCollectionFailed: false,
      tabUnavailable: true,
    }));
    expect(guardWasEnumerable).toBe(false);
    expect(guardUsedStableName).toBe(false);
    expect(originalOpen).not.toHaveBeenCalled();
    expect(window.open).not.toBe(originalOpen);
    await vi.advanceTimersByTimeAsync(75);
    expect(originalOpen).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_600);
    expect(window.open).toBe(originalOpen);
  });

  it("returns a captured popup when the click response fails after dispatch", async () => {
    document.body.innerHTML = `<button id="launch-error">Open before error</button>`;
    const button = document.getElementById("launch-error") as HTMLButtonElement;
    button.addEventListener("click", () => {
      window.open("/captured-before-error", "_blank");
      setTimeout(() => window.open("/second-sync-grace", "_blank"), 25);
    });
    const inspection = await executePageTool(pageToolCallSchema.parse({
      requestId: 3,
      threadId: "thread-2",
      turnId: "turn-2",
      callId: "inspect-error-popup",
      namespace: "page",
      tool: "inspect",
      arguments: { idempotencyKey: "inspect-error-popup-0001" },
    }), 1) as { elements: Array<{ label: string; ref: Record<string, unknown> }> };
    const launch = inspection.elements.find((element) => element.label === "Open before error");
    failClickAfterDispatch = true;

    vi.useFakeTimers();
    const clickPromise = executePageTool(pageToolCallSchema.parse({
      requestId: 4,
      threadId: "thread-2",
      turnId: "turn-2",
      callId: "click-error-popup",
      namespace: "page",
      tool: "click",
      arguments: { idempotencyKey: "click-error-popup-00001", ref: launch?.ref },
    }), 1) as Promise<Record<string, unknown>>;
    await vi.advanceTimersByTimeAsync(75);
    const result = await clickPromise;

    expect(result).toEqual(expect.objectContaining({
      clicked: false,
      actionError: "Executor response failed after dispatch.",
      popupAttempts: 2,
      popupUrls: [
        "http://localhost:3000/captured-before-error",
        "http://localhost:3000/second-sync-grace",
      ],
      tabUnavailable: true,
    }));
    await vi.advanceTimersByTimeAsync(1_925);
  });

  it("returns an ordinary no-popup click after the quiet window", async () => {
    document.body.innerHTML = `<button id="ordinary">Open menu</button>`;
    const inspection = await executePageTool(pageToolCallSchema.parse({
      requestId: 5,
      threadId: "thread-3",
      turnId: "turn-3",
      callId: "inspect-ordinary",
      namespace: "page",
      tool: "inspect",
      arguments: { idempotencyKey: "inspect-ordinary-0001" },
    }), 1) as { elements: Array<{ label: string; ref: Record<string, unknown> }> };
    const ordinary = inspection.elements.find((element) => element.label === "Open menu");
    vi.useFakeTimers();

    const clickPromise = executePageTool(pageToolCallSchema.parse({
      requestId: 6,
      threadId: "thread-3",
      turnId: "turn-3",
      callId: "click-ordinary",
      namespace: "page",
      tool: "click",
      arguments: { idempotencyKey: "click-ordinary-00001", ref: ordinary?.ref },
    }), 1) as Promise<Record<string, unknown>>;
    let settled = false;
    void clickPromise.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(349);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(clickPromise).resolves.toEqual(expect.objectContaining({
      clicked: true,
      popupAttempts: 0,
      popupUrls: [],
    }));
    await vi.advanceTimersByTimeAsync(1_650);
  });
});
