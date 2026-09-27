import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIDEBAR_STATE_STORAGE_KEY, type ConversationSnapshot } from "../src/shared/conversation-state";

function snapshot(id: string, text: string, savedAt: number): ConversationSnapshot {
  const record = {
    id,
    threadId: `thread-${id}`,
    title: text,
    messages: [{ id: `${id}-message`, role: "user" as const, text }],
    toolStatuses: [],
    updatedAt: savedAt,
  };
  return {
    savedAt,
    threadId: record.threadId,
    currentConversationId: id,
    messages: record.messages,
    theme: "system",
    selectedModel: "",
    completionSoundEnabled: false,
    conversationHistory: [record],
  };
}

describe("conversation persistence", () => {
  beforeEach(() => vi.resetModules());

  it("unions overlapping saves so the later snapshot cannot erase the earlier conversation", async () => {
    const data: Record<string, unknown> = {};
    let releaseFirstRead: () => void = () => undefined;
    let markFirstReadStarted: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    const firstReadStarted = new Promise<void>((resolve) => {
      markFirstReadStarted = resolve;
    });
    let reads = 0;
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => {
            reads += 1;
            if (reads === 1) {
              markFirstReadStarted();
              await gate;
            }
            return { [key]: data[key] };
          }),
          set: vi.fn(async (values: Record<string, unknown>) => Object.assign(data, values)),
          remove: vi.fn(async (key: string) => {
            delete data[key];
          }),
        },
      },
    });

    const persist = await import("../src/background/conversation-persist");
    const first = persist.saveConversationSnapshot(snapshot("research", "course details", 20));
    const second = persist.saveConversationSnapshot(snapshot("other", "hello", 21));
    await firstReadStarted;
    releaseFirstRead();
    await first;
    await second;

    const stored = data[SIDEBAR_STATE_STORAGE_KEY] as ConversationSnapshot;
    expect(stored.conversationHistory.map((item) => item.id).sort()).toEqual(["other", "research"]);
  });

  it("drops a snapshot saved before clear, including one that arrives afterward", async () => {
    const data: Record<string, unknown> = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: data[key] })),
          set: vi.fn(async (values: Record<string, unknown>) => Object.assign(data, values)),
          remove: vi.fn(async (key: string) => {
            delete data[key];
          }),
        },
      },
    });

    const persist = await import("../src/background/conversation-persist");
    await persist.saveConversationSnapshot(snapshot("research", "course details", Date.now()));
    await persist.clearConversationStore();
    await persist.saveConversationSnapshot(snapshot("research", "course details", 1));

    expect(data[SIDEBAR_STATE_STORAGE_KEY]).toBeUndefined();
  });

  it("retries without the duplicate transcript when storage is full", async () => {
    const data: Record<string, unknown> = {};
    let writes = 0;
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: data[key] })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            writes += 1;
            if (writes === 1) throw new Error("QUOTA_BYTES quota exceeded");
            Object.assign(data, values);
          }),
          remove: vi.fn(async (key: string) => {
            delete data[key];
          }),
        },
      },
    });

    const persist = await import("../src/background/conversation-persist");
    await persist.saveConversationSnapshot(snapshot("research", "course details", 30));

    const stored = data[SIDEBAR_STATE_STORAGE_KEY] as ConversationSnapshot;
    expect(stored.messages).toEqual([]);
    expect(stored.conversationHistory[0]?.messages[0]?.text).toBe("course details");
  });

  it("reports a storage-full error when the transcript itself cannot be stored", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: undefined })),
          set: vi.fn(async () => {
            throw new Error("QUOTA_BYTES quota exceeded");
          }),
          remove: vi.fn(async () => undefined),
        },
      },
    });

    const persist = await import("../src/background/conversation-persist");
    await expect(persist.saveConversationSnapshot(snapshot("research", "course details", 40)))
      .rejects.toThrow(/storage is full/i);
  });
});
