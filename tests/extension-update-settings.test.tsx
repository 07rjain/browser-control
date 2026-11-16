// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExtensionUpdates from "../src/sidepanel/ExtensionUpdates";
import type { SidebarEvent } from "../src/shared/protocol";

const state = { currentVersion: "0.3.9", availableVersion: null, storeManaged: true };
let receive: (message: SidebarEvent, sender: chrome.runtime.MessageSender) => void;
beforeEach(() => {
  vi.stubGlobal("chrome", { runtime: { id: "extension-id", onMessage: {
    addListener: (listener: typeof receive) => { receive = listener; }, removeListener: vi.fn(),
  } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("update settings", () => {
  it("reads local status without starting a Store check", async () => {
    const request = vi.fn(async () => state);
    render(<ExtensionUpdates disabled={false} request={request} />);
    await screen.findByText("Browser Control 0.3.9");
    expect(request.mock.calls).toHaveLength(1);
    expect(request).toHaveBeenCalledWith({ type: "EXTENSION_UPDATE_READ" });
  });

  it.each([
    ["no_update", "Chrome isn't offering a newer version right now."],
    ["throttled", "Chrome has checked recently. Try again later; automatic checks continue."],
  ])("explains a %s result without claiming immediate global availability", async (status, text) => {
    const request = vi.fn(async (message: Record<string, unknown>) => message.type === "EXTENSION_UPDATE_READ" ? state : { ...state, status });
    render(<ExtensionUpdates disabled={false} request={request} />);
    await screen.findByText("Browser Control 0.3.9");
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect((await screen.findByRole("status")).textContent).toBe(text);
    expect(request).toHaveBeenLastCalledWith({ type: "EXTENSION_UPDATE_CHECK" });
  });

  it("shows a trusted background update and defers application until the sidebar closes", async () => {
    render(<ExtensionUpdates disabled={false} request={async () => state} />);
    await screen.findByText("Browser Control 0.3.9");
    const message: SidebarEvent = { source: "codex-sidebar-background", event: "extension.update", data: { ...state, availableVersion: "0.3.10" } };
    act(() => receive(message, { id: "other-extension" }));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => receive(message, { id: "extension-id" }));
    expect(screen.getByRole("status").textContent).toMatch(/0.3.10.*close Browser Control/);
    expect((screen.getByRole("button", { name: "Check for updates" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("allows retry after a check fails", async () => {
    let fail = true;
    const request = vi.fn(async (message: Record<string, unknown>) => {
      if (message.type === "EXTENSION_UPDATE_READ") return state;
      if (fail) throw new Error("Offline");
      return { ...state, status: "no_update" };
    });
    render(<ExtensionUpdates disabled={false} request={request} />);
    await screen.findByText("Browser Control 0.3.9");
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't check/);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await screen.findByRole("status");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables checks for development builds", async () => {
    render(<ExtensionUpdates disabled={false} request={async () => ({ ...state, storeManaged: false })} />);
    await screen.findByText(/Development build:/);
    expect((screen.getByRole("button", { name: "Check for updates" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables a manual check while a task or recording is active", async () => {
    render(<ExtensionUpdates disabled request={async () => state} />);
    await screen.findByText("Browser Control 0.3.9");
    expect((screen.getByRole("button", { name: "Check for updates" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
