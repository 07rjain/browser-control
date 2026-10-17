import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversationSnapshotSchema, readStoredSidebarState, SIDEBAR_STATE_STORAGE_KEY, type ConversationSnapshot } from "../src/shared/conversation-state";

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

  it("stores teaching offers with their response and retains dismissals through validated saves and restoration", async () => {
    const data: Record<string, unknown> = {};
    vi.stubGlobal("chrome", { storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: data[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => Object.assign(data, values)),
    } } });
    const persist = await import("../src/background/conversation-persist");
    const state = snapshot("teach", "Please show me this workflow.", Date.now());
    const message = { id: "offered-turn", role: "assistant" as const, text: "I could not finish.", recordingOffer: { reason: "Learning from a demonstration would help.", description: "Arrange the example board.", state: "offered" as const } };
    state.messages.push(message);
    state.conversationHistory[0]!.messages = state.messages;
    await persist.saveConversationSnapshot(conversationSnapshotSchema.parse(state));
    expect(readStoredSidebarState(data[SIDEBAR_STATE_STORAGE_KEY])?.messages.at(-1)?.recordingOffer).toEqual(message.recordingOffer);
    state.messages[state.messages.length - 1] = { ...message, recordingOffer: { ...message.recordingOffer, state: "dismissed" } };
    state.savedAt += 1;
    state.conversationHistory[0]!.updatedAt += 1;
    await persist.saveConversationSnapshot(conversationSnapshotSchema.parse(state));
    const restored = readStoredSidebarState(data[SIDEBAR_STATE_STORAGE_KEY]);
    expect(restored?.messages.at(-1)?.recordingOffer?.state).toBe("dismissed");
    expect(restored?.conversationHistory[0]?.messages.at(-1)?.recordingOffer?.state).toBe("dismissed");
  });

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
