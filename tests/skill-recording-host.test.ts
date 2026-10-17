import { beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_ACCESS_HOST_GRANT_KEY } from "../src/shared/page-tools";
import { RECORDER_PORT_NAME } from "../src/shared/skill-recording";

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

async function recordingFixture(url = "chrome://newtab/") {
  const sessionData: Record<string, unknown> = {};
  const tabs = new Map<number, chrome.tabs.Tab>([
    [4, { id: 4, url, title: "Recording page", status: "complete" } as chrome.tabs.Tab],
    [9, { id: 9, url: "https://other.example/", title: "Other", status: "complete" } as chrome.tabs.Tab],
  ]);
  vi.stubGlobal("chrome", {
    runtime: { id: "extension-id", sendMessage: vi.fn(async () => undefined) },
    storage: {
      session: storageArea(sessionData),
      local: storageArea({ [FULL_ACCESS_HOST_GRANT_KEY]: true }),
    },
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
  const connect = async (onFlush: (message: { nonce: string; requestId: string }) => void) => {
    let receive: (message: unknown) => void = () => {};
    let disconnect = () => {};
    let nonce = "";
    const port = {
      name: RECORDER_PORT_NAME,
      sender: { id: chrome.runtime.id, frameId: 0, tab: tabs.get(4), origin: new URL(tabs.get(4)!.url!).origin },
      onMessage: { addListener: (listener: typeof receive) => { receive = listener; } },
      onDisconnect: { addListener: (listener: () => void) => { disconnect = listener; } },
      postMessage: (message: { type: string; nonce: string; requestId: string }) => {
        if (message.type === "START") nonce = message.nonce;
        if (message.type === "FLUSH") onFlush(message);
      },
      disconnect: () => disconnect(),
    } as unknown as chrome.runtime.Port;
    host.acceptRecorderPort(port);
    await host.readSkillRecording();
    return { send: (message: unknown) => receive(message), nonce, disconnect: () => disconnect() };
  };
  return { host, tabs, connect };
}

describe("skill recording host", () => {
  beforeEach(() => vi.resetModules());

  it("attaches when the focused tab becomes a normal page and refuses a notes-only save", async () => {
    const { host, tabs } = await recordingFixture();
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

  it("persists 120 steps, bounds overflow, and previews a document beyond the old character limit", async () => {
    const { host, connect } = await recordingFixture(`https://example.com/${"p".repeat(490)}`);
    await host.startSkillRecording("A long demonstration");
    const recorder = await connect(({ nonce, requestId }) => recorder.send({ type: "FLUSHED", nonce, requestId }));
    for (let index = 1; index < 120; index += 1) {
      recorder.send({ type: "STEP", nonce: recorder.nonce, step: { kind: "click", role: "button", label: `Step ${index}` } });
    }
    const full = await host.readSkillRecording();
    expect(full.steps).toHaveLength(120);
    expect(full.truncated).toBe(false);
    recorder.send({ type: "STEP", nonce: recorder.nonce, step: { kind: "click", role: "button", label: "Overflow" } });
    expect((await host.readSkillRecording()).truncated).toBe(true);
    const review = await host.stopSkillRecording();
    expect(review.steps).toHaveLength(120);
    expect(review.steps.at(-1)).toMatchObject({ kind: "click", label: "Step 119" });
    expect(review.previewError).toBe("");
    expect(review.preview.length).toBeGreaterThan(24_000);
    expect(review.preview).toContain('120. On https://example.com/');
    const write = vi.fn(async () => ({ name: "A long demonstration" }));
    await host.saveSkillRecording(write);
    expect(write).toHaveBeenCalledWith(review.preview);
    expect((await host.readSkillRecording()).status).toBe("idle");
  });

  it("drains final steps before review, pins the recording while stopping, and shares duplicate Done requests", async () => {
    const { host, connect } = await recordingFixture("https://example.com/app");
    await host.startSkillRecording("Type a title");
    let flush: { nonce: string; requestId: string } | undefined;
    const recorder = await connect((message) => { flush = message; });
    const done = host.stopSkillRecording();
    expect(host.stopSkillRecording()).toBe(done);
    await host.readSkillRecording();
    host.followRecordingActivation(9);
    recorder.send({ type: "STEP", nonce: recorder.nonce, step: { kind: "fill", role: "textbox", label: "Title", example: "Last typed title" } });
    expect(flush).toBeDefined();
    recorder.send({ ...flush, type: "FLUSHED" });
    const review = await done;
    expect(review.status).toBe("review");
    expect(review.notice).toBe("");
    expect(review.steps).toMatchObject([{ kind: "navigate" }, { kind: "fill", example: "Last typed title" }]);
    await host.updateSkillRecording({ keepExample: { stepId: review.steps[1]!.id, keep: true } });
    expect((await host.readSkillRecording()).preview).toContain("Last typed title");
  });

  it.each(["disconnect", "timeout", "cancel"] as const)("finishes safely after a flush %s", async (failure) => {
    const { host, connect } = await recordingFixture("https://example.com/app");
    await host.startSkillRecording("Capture safely");
    const recorder = await connect(() => {});
    vi.useFakeTimers();
    try {
      const done = host.stopSkillRecording();
      const outcome = done.then((review) => ({ review }), (error: Error) => ({ error }));
      await host.readSkillRecording();
      if (failure === "cancel") await host.cancelSkillRecording();
      else if (failure === "disconnect") recorder.disconnect();
      else await vi.advanceTimersByTimeAsync(3_100);
      const result = await outcome;
      if (failure === "cancel") {
        expect(result).toMatchObject({ error: { message: "This skill recording was canceled." } });
        expect((await host.readSkillRecording()).status).toBe("idle");
      } else {
        expect(result).toMatchObject({ review: { status: "review", notice: expect.stringContaining("last typing or scroll may be missing") } });
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
