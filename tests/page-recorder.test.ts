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
      connect: () => ({
        onMessage: { addListener: (listener: PortListener) => { portListener = listener; } },
        onDisconnect: { addListener: vi.fn() },
        postMessage: (message: unknown) => { posted.push(message); },
        disconnect: vi.fn(),
      }),
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

  it("records a click inside a same-origin frame", async () => {
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
    expect(steps.map((message) => message.step.label)).toContain("Send");
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
});