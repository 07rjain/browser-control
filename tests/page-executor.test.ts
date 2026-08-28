// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installPopupGuardInPage, releasePopupGuardInPage } from "../src/background/page-executor-host";

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean;

let listener: Listener;

beforeAll(async () => {
  class TestDataTransfer {}
  class TestDragEvent extends Event {
    readonly dataTransfer: unknown;

    constructor(type: string, init?: EventInit & { dataTransfer?: unknown }) {
      super(type, init);
      this.dataTransfer = init?.dataTransfer;
    }
  }
  vi.stubGlobal("DataTransfer", TestDataTransfer);
  vi.stubGlobal("DragEvent", TestDragEvent);
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension-id",
      onMessage: {
        addListener: (registered: Listener) => {
          listener = registered;
        },
      },
    },
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 30, width: 120, height: 30, toJSON: () => ({}) }),
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => null,
  });
  await import("../src/content/page-executor");
});

beforeEach(async () => {
  document.body.innerHTML = "";
  await new Promise((resolve) => setTimeout(resolve, 0));
});

function command<T>(message: Record<string, unknown>): T {
  let response: unknown;
  listener(
    { type: "CODEX_PAGE_EXECUTOR", ...message },
    { id: "extension-id" },
    (value) => {
      response = value;
    },
  );
  const envelope = response as { ok: boolean; data: T; error?: string };
  if (!envelope.ok) throw new Error(envelope.error);
  return envelope.data;
}

describe("packaged page executor", () => {
  it("shows and removes a non-interactive agent-working frame", () => {
    expect(command({ action: "TASK_INDICATOR", active: true })).toEqual({ active: true });
    const indicator = document.querySelector<HTMLElement>("[data-browser-control-task-indicator='active']");
    expect(indicator).not.toBeNull();
    expect(indicator?.getAttribute("aria-hidden")).toBe("true");
    expect(indicator?.style.pointerEvents).toBe("none");

    expect(command({ action: "TASK_INDICATOR", active: false })).toEqual({ active: false });
    expect(document.querySelector("[data-browser-control-task-indicator='active']")).toBeNull();
  });

  it("expires an unrefreshed working frame if task completion is lost", () => {
    vi.useFakeTimers();
    expect(command({ action: "TASK_INDICATOR", active: true })).toEqual({ active: true });
    vi.advanceTimersByTime(2 * 60 * 1_000);
    expect(document.querySelector("[data-browser-control-task-indicator='active']")).toBeNull();
    vi.useRealTimers();
  });

  it("inspects visible controls without exposing password values", async () => {
    document.body.innerHTML = `
      <a href="/pricing">Pricing</a>
      <label for="name">Name</label><input id="name" value="Rishabh">
      <label for="secret">Password</label><input id="secret" type="password" value="do-not-return">
      <form><input type="hidden" name="csrf" value="hidden-token"><button type="submit">Continue</button></form>
    `;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = command<{ elements: Array<{ label: string; sensitive: boolean; value?: string }> }>({ action: "INSPECT" });
    expect(result.elements.map((item) => item.label)).toContain("Pricing");
    expect(result.elements.find((item) => item.label === "Name")?.value).toBe("Rishabh");
    expect(result.elements.find((item) => item.label === "Password")).toMatchObject({ sensitive: true });
    expect(JSON.stringify(result)).not.toContain("do-not-return");
    expect(JSON.stringify(result)).not.toContain("hidden-token");
  });

  it("fills a non-sensitive field and refuses a stale snapshot", async () => {
    document.body.innerHTML = `<label for="query">Search</label><input id="query">`;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const inspection = command<{ snapshotId: string; elements: Array<{ refId: string; label: string }> }>({ action: "INSPECT" });
    const field = inspection.elements.find((item) => item.label === "Search");
    expect(field).toBeDefined();
    const filled = command<{ filled: boolean; characterCount: number }>({
      action: "FILL",
      snapshotId: inspection.snapshotId,
      refId: field?.refId,
      value: "Codex",
      mode: "replace",
    });
    expect(filled).toEqual(expect.objectContaining({ filled: true, characterCount: 5 }));
    expect((document.getElementById("query") as HTMLInputElement).value).toBe("Codex");

    expect(() => command({ action: "DESCRIBE", snapshotId: "old", refId: field?.refId })).toThrow(/stale/i);
  });

  it("inspects and fills a contenteditable textbox", () => {
    document.body.innerHTML = `<div contenteditable="true" role="textbox" aria-label="Chat message">Draft</div>`;
    const editor = document.querySelector<HTMLElement>("[contenteditable]") as HTMLElement;
    const input = vi.fn();
    editor.addEventListener("input", input);
    const inspection = command<{
      snapshotId: string;
      elements: Array<{ refId: string; label: string; role: string; value?: string }>;
    }>({ action: "INSPECT" });
    const field = inspection.elements.find((item) => item.label === "Chat message");

    expect(field).toEqual(expect.objectContaining({ role: "textbox", value: "Draft" }));
    expect(command({
      action: "FILL",
      snapshotId: inspection.snapshotId,
      refId: field?.refId,
      value: "What is the meaning of life?",
      mode: "replace",
    })).toEqual(expect.objectContaining({ filled: true, characterCount: 28 }));
    expect(editor.textContent).toBe("What is the meaning of life?");
    expect(input).toHaveBeenCalledOnce();
  });

  it("does not expose or fill a sensitive contenteditable field", () => {
    document.body.innerHTML = `<div contenteditable="true" role="textbox" aria-label="Recovery code">do-not-return</div>`;
    const inspection = command<{
      snapshotId: string;
      elements: Array<{ refId: string; label: string; sensitive: boolean; value?: string }>;
    }>({ action: "INSPECT" });
    const field = inspection.elements.find((item) => item.label === "Recovery code");

    expect(field).toEqual(expect.objectContaining({ sensitive: true, value: undefined }));
    expect(JSON.stringify(inspection)).not.toContain("do-not-return");
    expect(() => command({
      action: "FILL",
      snapshotId: inspection.snapshotId,
      refId: field?.refId,
      value: "replacement",
      mode: "replace",
    })).toThrow(/sensitive/i);
  });

  it("keeps references valid when an unrelated part of a dynamic page changes", async () => {
    document.body.innerHTML = `<button id="save">Save</button><div id="live-region">Idle</div>`;
    const inspection = command<{ snapshotId: string; elements: Array<{ refId: string; label: string }> }>({ action: "INSPECT" });
    const save = inspection.elements.find((item) => item.label === "Save");

    const liveRegion = document.getElementById("live-region") as HTMLDivElement;
    liveRegion.className = "updated";
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.textContent = "Calendar refreshed";
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(command({ action: "DESCRIBE", snapshotId: inspection.snapshotId, refId: save?.refId })).toEqual(
      expect.objectContaining({ label: "Save", tag: "button" }),
    );
  });

  it("rebinds a uniquely identifiable control replaced by a reactive render", () => {
    document.body.innerHTML = `<button id="save" aria-label="Save event">Save</button>`;
    const inspection = command<{ snapshotId: string; elements: Array<{ refId: string; label: string }> }>({ action: "INSPECT" });
    const save = inspection.elements.find((item) => item.label === "Save event");
    const original = document.getElementById("save") as HTMLButtonElement;
    const replacement = original.cloneNode(true) as HTMLButtonElement;
    original.replaceWith(replacement);

    const result = command<{ clicked: boolean }>({ action: "CLICK", snapshotId: inspection.snapshotId, refId: save?.refId });
    expect(result.clicked).toBe(true);
  });

  it("inspects and activates controls inside an open shadow root", () => {
    const host = document.createElement("div");
    host.id = "interop-outlet";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<button aria-label="Post update">Post</button>`;
    document.body.append(host);
    const button = shadow.querySelector("button") as HTMLButtonElement;
    const hitTest = vi.spyOn(document, "elementFromPoint").mockReturnValue(host);
    const clicked = vi.fn();
    const keydown = vi.fn();
    button.addEventListener("click", clicked);
    button.addEventListener("keydown", keydown);

    const inspection = command<{ snapshotId: string; elements: Array<{ refId: string; label: string }> }>({ action: "INSPECT" });
    const post = inspection.elements.find((item) => item.label === "Post update");
    expect(post).toBeDefined();
    expect(command({ action: "CLICK", snapshotId: inspection.snapshotId, refId: post?.refId })).toEqual(
      expect.objectContaining({ clicked: true, label: "Post update" }),
    );
    expect(clicked).toHaveBeenCalledOnce();
    expect(command({ action: "KEYPRESS", snapshotId: inspection.snapshotId, refId: post?.refId, key: "ArrowDown" })).toEqual(
      expect.objectContaining({ dispatched: true, key: "ArrowDown" }),
    );
    expect(keydown).toHaveBeenCalledOnce();
    hitTest.mockRestore();
  });

  it("omits covered controls and prioritizes a foreground shadow editor over the element cap", () => {
    document.body.innerHTML = Array.from({ length: 80 }, (_, index) => `<button>Offscreen ${index + 1}</button>`).join("");
    for (const button of Array.from(document.querySelectorAll("button"))) {
      Object.defineProperty(button, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ x: 0, y: 2_000, top: 2_000, left: 0, right: 120, bottom: 2_030, width: 120, height: 30, toJSON: () => ({}) }),
      });
    }
    const covered = document.createElement("button");
    covered.textContent = "Start a post";
    document.body.prepend(covered);
    const host = document.createElement("div");
    host.id = "interop-outlet";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<div contenteditable="true" role="textbox" aria-label="Text editor for creating content">Draft post</div>`;
    document.body.append(host);
    const hitTest = vi.spyOn(document, "elementFromPoint").mockReturnValue(host);

    const inspection = command<{ elements: Array<{ label: string }> }>({ action: "INSPECT" });
    expect(inspection.elements).toHaveLength(80);
    expect(inspection.elements[0]?.label).toBe("Text editor for creating content");
    expect(inspection.elements.map((item) => item.label)).not.toContain("Start a post");
    hitTest.mockRestore();
  });

  it("still rejects a control when an unrelated overlay appears after inspection", () => {
    document.body.innerHTML = `<button aria-label="Continue">Continue</button><div id="overlay"></div>`;
    const buttonElement = document.querySelector("button") as HTMLButtonElement;
    const overlay = document.getElementById("overlay") as HTMLDivElement;
    const hitTest = vi.spyOn(document, "elementFromPoint").mockReturnValue(buttonElement);
    const inspection = command<{ snapshotId: string; elements: Array<{ refId: string; label: string }> }>({ action: "INSPECT" });
    const button = inspection.elements.find((item) => item.label === "Continue");
    hitTest.mockReturnValue(overlay);

    expect(() => command({ action: "CLICK", snapshotId: inspection.snapshotId, refId: button?.refId })).toThrow(/covered/i);
    hitTest.mockRestore();
  });

  it("blocks a JavaScript-created popup during a real button click and records its URL", () => {
    document.body.innerHTML = `<button id="launch">Open workspace</button>`;
    const button = document.getElementById("launch") as HTMLButtonElement;
    const originalOpen = window.open;
    button.addEventListener("click", () => window.open("/workspace", "_blank"));
    const inspection = command<{ snapshotId: string; elements: Array<{ refId: string; label: string }> }>({ action: "INSPECT" });
    const launch = inspection.elements.find((item) => item.label === "Open workspace");

    installPopupGuardInPage("popup-test");
    expect(command({ action: "CLICK", snapshotId: inspection.snapshotId, refId: launch?.refId })).toEqual(
      expect.objectContaining({ clicked: true }),
    );
    expect(releasePopupGuardInPage("popup-test")).toEqual({
      attempted: 1,
      urls: ["http://localhost:3000/workspace"],
    });
    expect(window.open).toBe(originalOpen);
  });

  it("blocks a JavaScript-created popup with no URL instead of duplicating the current page", () => {
    document.body.innerHTML = `<button id="launch-blank">Open blank popup</button>`;
    const button = document.getElementById("launch-blank") as HTMLButtonElement;
    button.addEventListener("click", () => window.open());
    const inspection = command<{ snapshotId: string; elements: Array<{ refId: string; label: string }> }>({ action: "INSPECT" });
    const launch = inspection.elements.find((item) => item.label === "Open blank popup");

    installPopupGuardInPage("blank-popup-test");
    command({ action: "CLICK", snapshotId: inspection.snapshotId, refId: launch?.refId });
    expect(releasePopupGuardInPage("blank-popup-test")).toEqual({ attempted: 1, urls: [] });
  });

  it("fails closed when a changed target cannot be rebound unambiguously", () => {
    document.body.innerHTML = `<button id="save" aria-label="Save event">Save</button>`;
    const inspection = command<{ snapshotId: string; elements: Array<{ refId: string; label: string }> }>({ action: "INSPECT" });
    const save = inspection.elements.find((item) => item.label === "Save event");
    document.getElementById("save")?.remove();
    document.body.insertAdjacentHTML("beforeend", `
      <button id="save" aria-label="Save event">Save</button>
      <button id="save" aria-label="Save event">Save</button>
    `);

    expect(() => command({ action: "CLICK", snapshotId: inspection.snapshotId, refId: save?.refId })).toThrow(/changed|no longer exists/i);
  });

  it("refreshes an expired reference only through confirmation revalidation", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    document.body.innerHTML = `<button id="save" aria-label="Save event">Save</button>`;
    const inspection = command<{ snapshotId: string; elements: Array<{ refId: string; label: string }> }>({ action: "INSPECT" });
    const save = inspection.elements.find((item) => item.label === "Save event");
    now.mockReturnValue(32_000);

    expect(() => command({ action: "DESCRIBE", snapshotId: inspection.snapshotId, refId: save?.refId })).toThrow(/expired/i);
    expect(command({ action: "REVALIDATE", snapshotId: inspection.snapshotId, refId: save?.refId })).toEqual(
      expect.objectContaining({ label: "Save event", tag: "button" }),
    );
    expect(command({ action: "CLICK", snapshotId: inspection.snapshotId, refId: save?.refId })).toEqual(
      expect.objectContaining({ clicked: true }),
    );
    now.mockRestore();
  });

  it("dispatches a semantic drag sequence between inspected controls", () => {
    document.body.innerHTML = `
      <div id="source" draggable="true" aria-label="Draft event">Draft</div>
      <div id="target" role="gridcell" aria-label="Sunday column">Sunday</div>
    `;
    const inspection = command<{ snapshotId: string; elements: Array<{ refId: string; label: string }> }>({ action: "INSPECT" });
    const source = inspection.elements.find((item) => item.label === "Draft event");
    const target = inspection.elements.find((item) => item.label === "Sunday column");
    const sourceElement = document.getElementById("source") as HTMLDivElement;
    const targetElement = document.getElementById("target") as HTMLDivElement;
    const events: string[] = [];
    sourceElement.addEventListener("dragstart", (event) => events.push(event.type));
    targetElement.addEventListener("dragenter", (event) => events.push(event.type));
    targetElement.addEventListener("dragover", (event) => events.push(event.type));
    targetElement.addEventListener("drop", (event) => events.push(event.type));
    sourceElement.addEventListener("dragend", (event) => events.push(event.type));
    const hitTest = vi.spyOn(document, "elementFromPoint")
      .mockReturnValueOnce(sourceElement)
      .mockReturnValueOnce(targetElement);

    expect(command({
      action: "DRAG",
      snapshotId: inspection.snapshotId,
      sourceRefId: source?.refId,
      targetRefId: target?.refId,
    })).toEqual(expect.objectContaining({ dragged: true, source: "Draft event", target: "Sunday column" }));
    expect(events).toEqual(["dragstart", "dragenter", "dragover", "drop", "dragend"]);
    hitTest.mockRestore();
  });
});
