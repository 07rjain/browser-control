// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runPopupGuardInPage } from "../src/background/page-executor-host";
import { decidePageAction, type PageTargetDescription } from "../src/background/page-policy";
import type { PageToolCall } from "../src/shared/page-tools";

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


type Inspection = { snapshotId: string; elements: Array<{ refId: string; label: string; sensitive: boolean; value?: string }> };

function frameDocument(html: string): Document {
  document.body.innerHTML = `<iframe id="frame"></iframe>`;
  const frame = document.getElementById("frame") as HTMLIFrameElement;
  const frameWindow = frame.contentWindow as Window & typeof globalThis;
  Object.defineProperty(frameWindow.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 30, width: 120, height: 30, toJSON: () => ({}) }),
  });
  const frameDoc = frame.contentDocument as Document;
  frameDoc.body.innerHTML = html;
  return frameDoc;
}

function describeLabel(label: string): PageTargetDescription {
  const inspection = command<Inspection>({ action: "INSPECT" });
  const element = inspection.elements.find((item) => item.label === label);
  expect(element).toBeDefined();
  return command<PageTargetDescription>({ action: "DESCRIBE", snapshotId: inspection.snapshotId, refId: element?.refId });
}

function policyFor(tool: "click" | "fill" | "keypress" | "submit", target: PageTargetDescription, mode: "full" | "ask" = "full") {
  const args = tool === "fill"
    ? { value: "x", mode: "replace" }
    : tool === "keypress"
      ? { key: "Enter" }
      : {};
  return decidePageAction({ tool, arguments: args } as unknown as PageToolCall, target, mode);
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
    expect(() => command({
      action: "CLICK",
      snapshotId: inspection.snapshotId,
      refId: field?.refId,
    })).toThrow(/sensitive/i);
  });

  it("treats hidden token fields as sensitive in form previews without leaking values", () => {
    document.body.innerHTML = `
      <form>
        <input type="hidden" name="csrf" value="hidden-token">
        <input type="hidden" name="api_key" value="sk-live-do-not-return">
        <input id="hidden-pass" type="password" value="do-not-return" style="display:none">
        <button type="submit">Continue</button>
      </form>
    `;
    const inspection = command<{ snapshotId: string; elements: Array<{ refId: string; label: string }> }>({ action: "INSPECT" });
    const submit = inspection.elements.find((item) => item.label === "Continue");
    const described = command<{
      form: { fields: Array<{ name: string; value: string; sensitive: boolean }> };
    }>({ action: "DESCRIBE", snapshotId: inspection.snapshotId, refId: submit?.refId });
    expect(described.form.fields.filter((field) => field.sensitive)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "api_key", value: "[sensitive value hidden]", sensitive: true }),
      expect.objectContaining({ name: "hidden-pass", value: "[sensitive value hidden]", sensitive: true }),
    ]));
    expect(described.form.fields.some((field) => field.name === "csrf")).toBe(false);
    expect(JSON.stringify(described)).not.toContain("sk-live-do-not-return");
    expect(JSON.stringify(described)).not.toContain("hidden-token");
    expect(JSON.stringify(described)).not.toContain("do-not-return");
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

  it("blocks a JavaScript-created popup during a real button click and records its URL", async () => {
    document.body.innerHTML = `<button id="launch">Open workspace</button>`;
    const button = document.getElementById("launch") as HTMLButtonElement;
    const originalOpen = window.open;
    button.addEventListener("click", () => window.open("/workspace", "_blank"));
    const inspection = command<{ snapshotId: string; elements: Array<{ refId: string; label: string }> }>({ action: "INSPECT" });
    const launch = inspection.elements.find((item) => item.label === "Open workspace");

    const report = runPopupGuardInPage("popup-test", 350, 10, 1_000, 60);
    expect(command({ action: "POPUP_GUARD_READY", guardId: "popup-test" })).toEqual({ ready: true });
    expect(command({ action: "CLICK", snapshotId: inspection.snapshotId, refId: launch?.refId, popupGuardId: "popup-test" })).toEqual(
      expect.objectContaining({ clicked: true }),
    );
    await expect(report).resolves.toEqual({
      attempted: 1,
      urls: ["http://localhost:3000/workspace"],
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(window.open).toBe(originalOpen);
    expect(command({ action: "POPUP_GUARD_READY", guardId: "popup-test" })).toEqual({ ready: false });
  });

  it("blocks a JavaScript-created popup with no URL instead of duplicating the current page", async () => {
    document.body.innerHTML = `<button id="launch-blank">Open blank popup</button>`;
    const button = document.getElementById("launch-blank") as HTMLButtonElement;
    button.addEventListener("click", () => window.open());
    const inspection = command<{ snapshotId: string; elements: Array<{ refId: string; label: string }> }>({ action: "INSPECT" });
    const launch = inspection.elements.find((item) => item.label === "Open blank popup");

    const report = runPopupGuardInPage("blank-popup-test", 350, 10, 1_000, 60);
    command({ action: "CLICK", snapshotId: inspection.snapshotId, refId: launch?.refId, popupGuardId: "blank-popup-test" });
    await expect(report).resolves.toEqual({ attempted: 1, urls: [] });
    await new Promise((resolve) => setTimeout(resolve, 80));
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

  it("keeps a compose field inside a same-origin frame when the inbox exceeds the control cap", () => {
    const rows = Array.from({ length: 81 }, (_, index) => `<button>Row ${index}</button>`).join("");
    document.body.innerHTML = `${rows}<div role="dialog"><iframe id="compose"></iframe><button>Send</button></div>`;
    const frame = document.querySelector<HTMLIFrameElement>("#compose");
    const frameWindow = frame?.contentDocument?.defaultView;
    if (frameWindow) {
      Object.defineProperty(frameWindow.HTMLElement.prototype, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 30, width: 120, height: 30, toJSON: () => ({}) }),
      });
    }
    const field = frame?.contentDocument?.createElement("textarea");
    expect(field).toBeTruthy();
    field?.setAttribute("aria-label", "Message Body");
    frame?.contentDocument?.body.append(field as HTMLTextAreaElement);

    const inspection = command<{ elements: Array<{ label: string }>; truncated: boolean; unsupportedFrames: number }>({ action: "INSPECT" });
    expect(inspection.truncated).toBe(true);
    expect(inspection.unsupportedFrames).toBe(0);
    expect(inspection.elements[0]?.label).toBe("Send");
    expect(inspection.elements.map((element) => element.label)).toContain("Message Body");
  });
  it("classifies a password field inside a same-origin frame as sensitive in both modes", () => {
    frameDocument(`
      <form action="/login">
        <label for="pw">Password</label><input id="pw" type="password" value="frame-secret-value">
        <button type="submit">Continue</button>
      </form>
    `);
    const inspection = command<Inspection>({ action: "INSPECT" });
    const field = inspection.elements.find((item) => item.label === "Password");
    expect(field).toMatchObject({ sensitive: true });
    expect(field?.value).toBeUndefined();
    expect(JSON.stringify(inspection)).not.toContain("frame-secret-value");

    const target = command<PageTargetDescription>({ action: "DESCRIBE", snapshotId: inspection.snapshotId, refId: field?.refId });
    for (const mode of ["full", "ask"] as const) {
      expect(policyFor("fill", target, mode).decision).toBe("refuse");
      expect(policyFor("click", target, mode).decision).toBe("refuse");
    }
    expect(() => command({ action: "FILL", snapshotId: inspection.snapshotId, refId: field?.refId, value: "x", mode: "replace" })).toThrow(/sensitive/i);
    expect(() => command({ action: "CLICK", snapshotId: inspection.snapshotId, refId: field?.refId })).toThrow(/sensitive/i);

    const submit = describeLabel("Continue");
    expect(submit.submitter).toBe(true);
    expect(submit.form?.action).toBe("http://localhost:3000/login");
    expect(submit.form?.fields).toEqual([{ name: "pw", value: "[sensitive value hidden]", sensitive: true }]);
    expect(JSON.stringify(submit)).not.toContain("frame-secret-value");
    expect(policyFor("submit", submit).decision).toBe("refuse");
    expect(policyFor("click", submit).decision).toBe("refuse");
  });

  it("treats a field as sensitive from its visible label text alone", () => {
    document.body.innerHTML = `<label for="field-1">Verification code</label><input id="field-1" name="field1" value="123456">`;
    const inspection = command<Inspection>({ action: "INSPECT" });
    expect(inspection.elements.find((item) => item.label === "Verification code")).toMatchObject({ sensitive: true });
    expect(JSON.stringify(inspection)).not.toContain("123456");
  });

  it("still refuses a download link inside a same-origin frame", () => {
    frameDocument(`<a href="/report.pdf" download>Download report</a>`);
    const target = describeLabel("Download report");
    expect(target.download).toBe(true);
    expect(policyFor("click", target)).toMatchObject({ decision: "refuse" });
  });

  it("describes the destination a submitter's formaction actually uses", () => {
    document.body.innerHTML = `
      <form action="/save" method="post">
        <input name="title" aria-label="Title" value="Event">
        <button type="submit" formaction="/checkout">Save</button>
        <button type="submit" formaction="">Save here</button>
        <button type="submit">Save default</button>
        <input type="image" alt="Pay now" formaction="/payment/start">
      </form>
    `;
    const checkout = describeLabel("Save");
    expect(checkout.form?.action).toBe("http://localhost:3000/checkout");
    expect(policyFor("click", checkout)).toMatchObject({ decision: "refuse" });
    expect(policyFor("submit", checkout)).toMatchObject({ decision: "refuse" });

    expect(describeLabel("Save here").form?.action).toBe(location.href);
    expect(describeLabel("Save default").form?.action).toBe("http://localhost:3000/save");
    const image = describeLabel("Pay now");
    expect(image.submitter).toBe(true);
    expect(image.form?.action).toBe("http://localhost:3000/payment/start");
    expect(policyFor("click", image)).toMatchObject({ decision: "refuse" });
  });

  it("uses the document URL for a form without an action and ignores clobbering controls", () => {
    document.body.innerHTML = `
      <form><input name="action" aria-label="Action name" value="x"><button type="submit">Go</button></form>
    `;
    expect(describeLabel("Go").form?.action).toBe(location.href);
  });

  it("resolves the form owner and submitter for indirect activations", () => {
    document.body.innerHTML = `
      <form id="other" action="/other"></form>
      <form action="/main">
        <button type="submit" form="other">Send elsewhere</button>
        <button type="submit" formaction="/nested"><span role="button">Nested label</span></button>
        <button id="go" type="submit" formaction="/labelled" aria-label="Hidden go"></button>
        <label for="go" role="button">Label go</label>
      </form>
    `;
    expect(describeLabel("Send elsewhere").form?.action).toBe("http://localhost:3000/other");
    const nested = describeLabel("Nested label");
    expect(nested.submitter).toBe(true);
    expect(nested.form?.action).toBe("http://localhost:3000/nested");
    const label = describeLabel("Label go");
    expect(label.submitter).toBe(true);
    expect(label.form?.action).toBe("http://localhost:3000/labelled");
  });

  it("detects a submitter inside a same-origin frame", () => {
    frameDocument(`<form action="/frame-save"><button type="submit" formaction="/purchase">Continue</button></form>`);
    const target = describeLabel("Continue");
    expect(target.submitter).toBe(true);
    expect(target.form?.action).toBe("http://localhost:3000/purchase");
    expect(policyFor("click", target)).toMatchObject({ decision: "refuse" });
  });

  it("submits through the submitter on Enter and SUBMIT and reports the effective action", () => {
    document.body.innerHTML = `
      <form action="/save"><button id="send" type="submit" formaction="/send" formmethod="post">Send update</button></form>
    `;
    const form = document.querySelector("form") as HTMLFormElement;
    const button = document.getElementById("send") as HTMLButtonElement;
    const requestSubmit = vi.spyOn(form, "requestSubmit").mockImplementation(() => undefined);
    const inspection = command<Inspection>({ action: "INSPECT" });
    const ref = inspection.elements.find((item) => item.label === "Send update");

    command({ action: "KEYPRESS", snapshotId: inspection.snapshotId, refId: ref?.refId, key: "Enter" });
    expect(requestSubmit).toHaveBeenLastCalledWith(button);
    expect(command({ action: "SUBMIT", snapshotId: inspection.snapshotId, refId: ref?.refId })).toEqual({
      submitted: true,
      action: "http://localhost:3000/send",
      method: "POST",
    });
    expect(requestSubmit).toHaveBeenLastCalledWith(button);
  });

  it("fails closed when formaction changes between review and execution", () => {
    document.body.innerHTML = `<form action="/save"><button id="save" type="submit">Save draft</button></form>`;
    const inspection = command<Inspection>({ action: "INSPECT" });
    const ref = inspection.elements.find((item) => item.label === "Save draft");
    expect(command<PageTargetDescription>({ action: "DESCRIBE", snapshotId: inspection.snapshotId, refId: ref?.refId }).form?.action)
      .toBe("http://localhost:3000/save");
    document.getElementById("save")?.setAttribute("formaction", "/checkout");

    expect(() => command({ action: "REVALIDATE", snapshotId: inspection.snapshotId, refId: ref?.refId })).toThrow(/changed/i);
    expect(() => command({ action: "CLICK", snapshotId: inspection.snapshotId, refId: ref?.refId })).toThrow(/changed/i);
  });

  it("surfaces a new-tab form target in the description and confirmation", () => {
    document.body.innerHTML = `<form action="/save"><button type="submit" formtarget="_blank">Publish post</button></form>`;
    const target = describeLabel("Publish post");
    expect(target.form?.target).toBe("_blank");
    expect(policyFor("submit", target, "ask")).toMatchObject({
      decision: "confirm",
      description: "Send the reviewed form to http://localhost:3000/save in a new tab or window.",
    });
    expect(policyFor("click", target, "ask")).toMatchObject({
      decision: "confirm",
      description: expect.stringContaining("http://localhost:3000/save in a new tab or window"),
    });
  });
});
