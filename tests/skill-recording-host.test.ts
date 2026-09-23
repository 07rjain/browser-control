import { beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_ACCESS_HOST_GRANT_KEY } from "../src/shared/page-tools";

function storageArea(data: Record<string, unknown>) {
  return {
    get: vi.fn(async (keys: unknown) => {
      if (typeof keys === "string") return { [keys]: data[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, data[String(key)]]));
      return { ...data };
    }),
    set: vi.fn(async (values: Record<string, unknown>) => Object.assign(data, values)),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }),
  };
}

describe("skill recording host", () => {
  beforeEach(() => vi.resetModules());

  it("attaches when the focused tab becomes a normal page and refuses a notes-only save", async () => {
    const sessionData: Record<string, unknown> = {};
    const localData: Record<string, unknown> = { [FULL_ACCESS_HOST_GRANT_KEY]: true };
    const tabs = new Map<number, chrome.tabs.Tab>([
      [4, { id: 4, url: "chrome://newtab/", title: "New Tab", status: "complete" } as chrome.tabs.Tab],
      [9, { id: 9, url: "https://other.example/", title: "Other", status: "complete" } as chrome.tabs.Tab],
    ]);
    vi.stubGlobal("chrome", {
      runtime: { id: "extension-id", sendMessage: vi.fn(async () => undefined) },
      storage: { session: storageArea(sessionData), local: storageArea(localData) },
      tabs: {
        query: vi.fn(async () => [tabs.get(4)]),
        get: vi.fn(async (tabId: number) => {
          const tab = tabs.get(tabId);
          if (!tab) throw new Error("missing tab");
          return tab;
        }),
      },
      permissions: { contains: vi.fn(async () => true) },
      scripting: { executeScript: vi.fn(async () => []) },
    });

    const host = await import("../src/background/skill-recording-host");
    const started = await host.startSkillRecording("mail to rishabh bothra");
    expect(started.status).toBe("recording");
    expect(started.steps).toEqual([]);

    host.noteRecordingNavigation(9, "https://other.example/");
    expect((await host.readSkillRecording()).steps).toEqual([]);

    const focused = tabs.get(4);
    if (focused) focused.url = "https://mail.google.com/mail/u/0/";
    host.noteRecordingNavigation(4, "https://mail.google.com/mail/u/0/");
    const recording = await host.readSkillRecording();
    expect(recording.steps.map((step) => step.kind)).toEqual(["navigate"]);

    const review = await host.stopSkillRecording();
    expect(review.status).toBe("review");
    await host.updateSkillRecording({ notes: "..", deleteStepId: review.steps[0]?.id });
    await expect(host.saveSkillRecording(async () => ({ name: "mail to rishabh bothra" }))).rejects.toThrow(/no page actions were captured/i);
  });
});
