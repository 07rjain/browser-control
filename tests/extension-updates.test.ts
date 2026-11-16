import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExtensionUpdater } from "../src/background/extension-updates";
import { EXTENSION_UPDATE_KEY, SIDEBAR_LIFETIME_PORT } from "../src/shared/extension-updates";

function fixture() {
  const data: Record<string, unknown> = {};
  let update: (details: { version: string }) => void = () => {};
  const manifest = { version: "0.3.9", update_url: "https://clients2.google.com/service/update2/crx" };
  const runtime = {
    id: "extension-id", getManifest: () => manifest,
    getContexts: vi.fn(async (): Promise<Array<{ contextType: string }>> => [{ contextType: "BACKGROUND" }]),
    requestUpdateCheck: vi.fn(async (): Promise<{ status: "no_update" | "throttled" | "update_available"; version?: string }> => ({ status: "no_update" })),
    reload: vi.fn(),
    onUpdateAvailable: { addListener: (fn: typeof update) => { update = fn; } },
  };
  const local = {
    get: vi.fn(async (key: string) => ({ [key]: data[key] })),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }),
  };
  vi.stubGlobal("chrome", { runtime, storage: { local } });
  const options = { isBusyNow: vi.fn(() => false), isBusy: vi.fn(async () => false), notify: vi.fn() };
  const updater = createExtensionUpdater(options);
  updater.register();
  const stage = async (version = "0.3.10") => {
    update({ version });
    await vi.advanceTimersByTimeAsync(0);
  };
  function port(sender = { id: runtime.id, tab: undefined as chrome.tabs.Tab | undefined }) {
    let disconnect = () => {};
    const value = { name: SIDEBAR_LIFETIME_PORT, sender, onDisconnect: { addListener: (fn: () => void) => { disconnect = fn; } } } as chrome.runtime.Port;
    return { value, close: () => disconnect() };
  }
  return { data, manifest, runtime, local, options, updater, stage, port };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Chrome-managed extension updates", () => {
  it("applies an update only after the idle grace period, with no network polling", async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f.runtime.requestUpdateCheck).not.toHaveBeenCalled();
    expect(f.runtime.reload).not.toHaveBeenCalled();
    await f.stage();
    expect(f.runtime.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.runtime.reload).toHaveBeenCalledOnce();
    expect(f.options.notify).toHaveBeenCalledWith({ currentVersion: "0.3.9", availableVersion: "0.3.10", storeManaged: true });
    expect(f.runtime.requestUpdateCheck).not.toHaveBeenCalled();
  });

  it("waits for all sidebars to close, including multiple windows", async () => {
    const f = fixture();
    const first = f.port(), second = f.port();
    expect(f.updater.acceptPort(first.value)).toBe(true);
    expect(f.updater.acceptPort(second.value)).toBe(true);
    await f.stage();
    await vi.advanceTimersByTimeAsync(1_000);
    first.close();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.runtime.reload).not.toHaveBeenCalled();
    second.close();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.runtime.reload).toHaveBeenCalledOnce();
  });

  it("protects an open extension page even before its sidebar port mounts", async () => {
    const f = fixture();
    f.runtime.getContexts.mockResolvedValue([{ contextType: "SIDE_PANEL" }]);
    await f.stage();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.runtime.reload).not.toHaveBeenCalled();
  });

  it("doesn't reload while a save/request is pending or during its final flush", async () => {
    const f = fixture();
    const release = f.updater.hold();
    await f.stage();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.runtime.reload).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(500);
    const finalSave = f.updater.hold();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.runtime.reload).not.toHaveBeenCalled();
    finalSave();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.runtime.reload).toHaveBeenCalledOnce();
  });

  it("defers installation until the persisted-work guard reports idle", async () => {
    const f = fixture();
    f.options.isBusy.mockResolvedValue(true);
    await f.stage();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.runtime.reload).not.toHaveBeenCalled();
    f.options.isBusy.mockResolvedValue(false);
    f.updater.reconsider();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.runtime.reload).toHaveBeenCalledOnce();
  });

  it("rechecks synchronous work after asynchronous context discovery", async () => {
    const f = fixture();
    f.runtime.getContexts.mockImplementation(async () => {
      f.updater.hold(); // A new user request arrived during Chrome's async read.
      return [];
    });
    await f.stage();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.runtime.reload).not.toHaveBeenCalled();
  });

  it("fails closed if Chrome cannot establish idle state", async () => {
    const f = fixture();
    f.runtime.getContexts.mockRejectedValue(new Error("Unavailable"));
    await f.stage();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.runtime.reload).not.toHaveBeenCalled();
    expect((await f.updater.read()).availableVersion).toBe("0.3.10");
  });

  it("recovers a staged update across worker restarts without a new Store request", async () => {
    const f = fixture();
    f.data[EXTENSION_UPDATE_KEY] = { fromVersion: "0.3.9", version: "0.3.10" };
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.runtime.reload).toHaveBeenCalledOnce();
    expect(f.runtime.requestUpdateCheck).not.toHaveBeenCalled();
    f.manifest.version = "0.3.10";
    expect((await f.updater.read()).availableVersion).toBeNull();
  });

  it("keeps the newest version when Chrome sends overlapping events", async () => {
    const f = fixture();
    await f.stage("0.4.0");
    await f.stage("0.3.10");
    await f.stage("0.3.9");
    await f.stage("invalid");
    expect((await f.updater.read()).availableVersion).toBe("0.4.0");
  });

  it.each(["no_update", "throttled"] as const)("reports %s and doesn't retry or reload", async (status) => {
    const f = fixture();
    f.runtime.requestUpdateCheck.mockResolvedValue({ status });
    expect((await f.updater.check()).status).toBe(status);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.runtime.requestUpdateCheck).toHaveBeenCalledOnce();
    expect(f.runtime.reload).not.toHaveBeenCalled();
  });

  it("coalesces simultaneous manual checks and remembers the offered update", async () => {
    const f = fixture();
    f.runtime.requestUpdateCheck.mockResolvedValue({ status: "update_available", version: "0.3.10" });
    const [one, two] = await Promise.all([f.updater.check(), f.updater.check()]);
    expect(one).toEqual(two);
    expect(one.availableVersion).toBe("0.3.10");
    await f.updater.check();
    expect(f.runtime.requestUpdateCheck).toHaveBeenCalledOnce();
  });

  it("reports unpacked builds separately and never requests a Store update for them", async () => {
    const f = fixture();
    f.manifest.update_url = "";
    expect((await f.updater.check()).status).toBe("unsupported");
    expect(f.runtime.requestUpdateCheck).not.toHaveBeenCalled();
  });

  it("doesn't let web pages impersonate a sidebar lifetime port", () => {
    const f = fixture();
    expect(f.updater.acceptPort(f.port({ id: "other-extension", tab: undefined }).value)).toBe(false);
    expect(f.updater.acceptPort(f.port({ id: "extension-id", tab: { id: 42 } as chrome.tabs.Tab }).value)).toBe(false);
  });
});
