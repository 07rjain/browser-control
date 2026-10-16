// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from "vitest";

type PortListener = (message: unknown) => void;

let portListener: PortListener;
const posted: unknown[] = [];

const trustedEvents = new WeakSet<Event>();

beforeAll(async () => {
  (globalThis as { __codexRecorderTrustedEvents?: WeakSet<Event> }).__codexRecorderTrustedEvents = trustedEvents;
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension-id",
      connect: () => {
        let disconnected = false;
        let onDisconnect = () => {};
        return {
          onMessage: { addListener: (listener: PortListener) => {
            portListener = (message) => { if (!disconnected) listener(message); };
          } },
          onDisconnect: { addListener: (listener: () => void) => { onDisconnect = listener; } },
          postMessage: (message: unknown) => {
            if (disconnected) throw new Error("Disconnected port");
            posted.push(message);
          },
          disconnect: () => { disconnected = true; onDisconnect(); },
        };
      },
    },
  });
  await import("../src/content/page-recorder");
});

function trustedClick(target: Element): void {
  const event = new MouseEvent("click", { bubbles: true, composed: true });
  trustedEvents.add(event);
  target.dispatchEvent(event);
}

describe("page skill recorder", () => {
  it("records a trusted click and skips a password field", () => {
    posted.length = 0;
    document.body.innerHTML = `
      <button id="create">Create</button>
      <input id="secret" type="password" aria-label="Password" />
      <select id="expiry" autocomplete="cc-exp" aria-label="Expiry"><option>01/30</option></select>
    `;
    portListener({ type: "START", nonce: crypto.randomUUID() });
    const frame = document.querySelector("[data-browser-control-recording='active']");
    expect(frame).not.toBeNull();
    expect((frame as HTMLElement).style.pointerEvents).toBe("none");

    trustedClick(document.querySelector("#create") as HTMLButtonElement);
    const untrusted = new MouseEvent("click", { bubbles: true });
    document.querySelector("#create")?.dispatchEvent(untrusted);
    trustedClick(document.querySelector("#secret") as HTMLInputElement);

    const steps = posted.filter((message) => (message as { type?: string }).type === "STEP") as Array<{ step: { kind: string; label?: string; reason?: string } }>;
    expect(steps.map((message) => message.step.kind === "click" ? message.step.label : message.step.reason)).toEqual([
      "Create",
      "sensitive",
    ]);
    expect(JSON.stringify(posted)).not.toContain("password-value");
  });

  it("records semantic controls inside a same-origin frame", async () => {
    posted.length = 0;
    document.body.replaceChildren();
    portListener({ type: "START", nonce: crypto.randomUUID() });
    const frame = document.createElement("iframe");
    document.body.append(frame);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = frame.contentDocument?.createElement("button");
    expect(button).toBeTruthy();
    button!.textContent = "Send";
    frame.contentDocument?.body.append(button as HTMLButtonElement);
    trustedClick(button as HTMLButtonElement);

    const steps = posted.filter((message) => (message as { type?: string }).type === "STEP") as Array<{ step: { kind: string; label?: string } }>;
    expect(steps.map((message) => message.step)).toContainEqual({ kind: "click", role: "button", label: "Send" });

    const doc = frame.contentDocument!;
    doc.body.insertAdjacentHTML("beforeend", `
      <select aria-label="Colour"><option>Red</option><option selected>Blue</option></select>
      <input type="checkbox" aria-label="Weekly digest" checked>
      <form aria-label="Checkout"></form>
    `);
    for (const control of doc.querySelectorAll("select, input, form")) {
      const event = new Event(control.tagName === "FORM" ? "submit" : "change", { bubbles: true });
      trustedEvents.add(event);
      control.dispatchEvent(event);
    }
    expect(posted.slice(1).map((message) => (message as { step: unknown }).step)).toEqual([
      { kind: "select", role: "combobox", label: "Colour", option: "Blue" },
      { kind: "check", role: "checkbox", label: "Weekly digest", checked: true },
      { kind: "skipped", reason: "purchase" },
    ]);
  });

  it("skips labeled secrets and revealed password fields in a same-origin frame", async () => {
    posted.length = 0;
    document.body.replaceChildren();
    portListener({ type: "START", nonce: crypto.randomUUID() });
    const frame = document.createElement("iframe");
    document.body.append(frame);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frameDocument = frame.contentDocument as Document;
    frameDocument.body.innerHTML = `
      <span id="code-label">Verification code</span><input id="field-1" aria-labelledby="code-label" value="frame-code-value">
      <input id="field-2" type="password" aria-label="Entry">
    `;
    trustedClick(frameDocument.getElementById("field-1") as HTMLInputElement);
    const revealed = frameDocument.getElementById("field-2") as HTMLInputElement;
    revealed.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    revealed.type = "text";
    revealed.value = "revealed-frame-value";
    trustedClick(revealed);

    const steps = posted.filter((message) => (message as { type?: string }).type === "STEP") as Array<{ step: { kind: string; reason?: string } }>;
    expect(steps.map((message) => message.step.reason)).toEqual(["sensitive", "sensitive"]);
    expect(JSON.stringify(posted)).not.toContain("frame-code-value");
    expect(JSON.stringify(posted)).not.toContain("revealed-frame-value");
  });

  it("records the email chip inside a recipient combobox", async () => {
    posted.length = 0;
    document.body.replaceChildren();
    portListener({ type: "START", nonce: crypto.randomUUID() });
    document.body.innerHTML = `
      <div role="combobox" aria-label="To recipients">
        <span email="rishabh@example.com"></span>
        <input aria-label="To" />
        <div role="listbox"><span email="other@example.com"></span></div>
      </div>
    `;
    const field = document.querySelector("input");
    expect(field).toBeTruthy();
    const event = new Event("input", { bubbles: true });
    trustedEvents.add(event);
    field?.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 450));

    const steps = posted.filter((message) => (message as { type?: string }).type === "STEP") as Array<{ step: { kind: string; role?: string; label?: string; example?: string } }>;
    expect(steps.at(-1)?.step).toMatchObject({
      kind: "fill",
      role: "combobox",
      label: "To recipients",
      example: "rishabh@example.com",
    });
  });

  it("flushes pending input and scrolling before acknowledging Done", async () => {
    posted.length = 0;
    document.body.innerHTML = '<input aria-label="Title" value="Last typed title">';
    const nonce = crypto.randomUUID();
    portListener({ type: "START", nonce });
    const input = new Event("input", { bubbles: true });
    const wheel = new WheelEvent("wheel", { bubbles: true, deltaY: 80 });
    trustedEvents.add(input);
    trustedEvents.add(wheel);
    document.querySelector("input")!.dispatchEvent(input);
    document.body.dispatchEvent(wheel);
    const requestId = crypto.randomUUID();
    portListener({ type: "FLUSH", nonce, requestId });
    expect(posted).toEqual([
      { type: "STEP", nonce, step: { kind: "fill", role: "textbox", label: "Title", example: "Last typed title" } },
      { type: "STEP", nonce, step: { kind: "scroll", direction: "down" } },
      { type: "FLUSHED", nonce, requestId },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(posted).toHaveLength(3);
  });

  it("restarts after stopping and reinjection without duplicate listeners", async () => {
    document.body.innerHTML = '<button>Restart check</button>';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      portListener({ type: "STOP" });
      posted.length = 0;
      trustedClick(document.querySelector("button")!);
      expect(posted).toEqual([]);
      vi.resetModules();
      await import("../src/content/page-recorder");
      portListener({ type: "START", nonce: crypto.randomUUID() });
      trustedClick(document.querySelector("button")!);
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ step: { kind: "click", role: "button", label: "Restart check" } });
    }
    portListener({ type: "STOP" });
    expect(document.querySelector("[data-browser-control-recording='active']")).toBeNull();
  });
});
