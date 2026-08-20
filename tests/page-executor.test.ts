// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean;

let listener: Listener;

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
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 30, width: 120, height: 30, toJSON: () => ({}) }),
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => document.querySelector("button, input, a"),
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
});
