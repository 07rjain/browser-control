// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from "vitest";

type PortListener = (message: unknown) => void;

let portListener: PortListener;
const posted: unknown[] = [];

beforeAll(async () => {
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
  Object.defineProperty(event, "isTrusted", { configurable: true, get: () => true });
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
});