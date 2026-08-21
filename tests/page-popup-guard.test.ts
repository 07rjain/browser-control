// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  executePageTool,
  installPopupGuardInPage,
} from "../src/background/page-executor-host";
import { pageToolCallSchema } from "../src/shared/page-tools";

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean;

let listener: Listener;
let guardWasEnumerable = false;
let failClickAfterDispatch = false;

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
      get: vi.fn(async () => ({
        id: 1,
        windowId: 1,
        url: location.href,
        title: "Popup test",
        status: "complete",
        discarded: false,
      })),
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
      executeScript: vi.fn(async (injection: { func?: (...args: string[]) => unknown; args?: string[] }) => {
        if (!injection.func) return [];
        const result = injection.func(...(injection.args ?? []));
        if (injection.func === installPopupGuardInPage) {
          guardWasEnumerable = Object.prototype.propertyIsEnumerable.call(window.open, "__codexSidebarPopupGuardControlV2");
        }
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
  failClickAfterDispatch = false;
});

describe("page executor host popup guard", () => {
  it("keeps the MAIN-world guard through deferred popup handlers", async () => {
    document.body.innerHTML = `<button id="launch">Open deferred workspace</button>`;
    const button = document.getElementById("launch") as HTMLButtonElement;
    button.addEventListener("click", () => {
      setTimeout(() => window.open("/deferred-workspace", "_blank"), 20);
      setTimeout(() => window.open("/late-workspace", "_blank"), 300);
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

    const result = await executePageTool(pageToolCallSchema.parse({
      requestId: 2,
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "click-popup",
      namespace: "page",
      tool: "click",
      arguments: { idempotencyKey: "click-popup-00001", ref: launch?.ref },
    }), 1) as Record<string, unknown>;

    expect(result).toEqual(expect.objectContaining({
      clicked: true,
      popupAttempts: 1,
      popupUrls: ["http://localhost:3000/deferred-workspace"],
      popupCollectionFailed: false,
    }));
    expect(guardWasEnumerable).toBe(false);
    expect(window.open).not.toBe(originalOpen);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(originalOpen).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(window.open).toBe(originalOpen);
  });

  it("returns a captured popup when the click response fails after dispatch", async () => {
    document.body.innerHTML = `<button id="launch-error">Open before error</button>`;
    const button = document.getElementById("launch-error") as HTMLButtonElement;
    button.addEventListener("click", () => window.open("/captured-before-error", "_blank"));
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

    const result = await executePageTool(pageToolCallSchema.parse({
      requestId: 4,
      threadId: "thread-2",
      turnId: "turn-2",
      callId: "click-error-popup",
      namespace: "page",
      tool: "click",
      arguments: { idempotencyKey: "click-error-popup-00001", ref: launch?.ref },
    }), 1) as Record<string, unknown>;

    expect(result).toEqual(expect.objectContaining({
      clicked: false,
      actionError: "Executor response failed after dispatch.",
      popupAttempts: 1,
      popupUrls: ["http://localhost:3000/captured-before-error"],
    }));
  });
});
