import { describe, expect, it } from "vitest";
import {
  mergeSidebarState,
  readStoredSidebarState,
  type ConversationSnapshot,
  type StoredConversation,
} from "../src/shared/conversation-state";

function message(id: string, text: string) {
  return { id, role: "user" as const, text };
}

function conversation(id: string, text: string, updatedAt: number, toolStatuses: StoredConversation["toolStatuses"] = []): StoredConversation {
  return {
    id,
    threadId: `thread-${id}`,
    title: text,
    messages: [message(`${id}-message`, text)],
    toolStatuses,
    updatedAt,
  };
}

function snapshot(current: StoredConversation | null, history: StoredConversation[], savedAt = 10): ConversationSnapshot {
  return {
    savedAt,
    threadId: current?.threadId ?? null,
    currentConversationId: current?.id ?? "new-chat",
    messages: current?.messages ?? [],
    theme: "system",
    selectedModel: "",
    completionSoundEnabled: false,
    conversationHistory: history,
  };
}

describe("conversation state merge", () => {
  it("keeps a stored conversation that a later snapshot omitted", () => {
    const research = conversation("research", "course details for the fall term", 5);
    const stored = snapshot(research, [research], 5);
    const emptyPanel = snapshot(null, [], 9);

    const merged = mergeSidebarState(stored, emptyPanel);

    expect(merged.currentConversationId).toBe("research");
    expect(merged.messages.map((item) => item.text)).toEqual(["course details for the fall term"]);
    expect(merged.conversationHistory.map((item) => item.id)).toEqual(["research"]);
  });

  it("does not replace a longer transcript with a shorter one", () => {
    const full = conversation("research", "course details for the fall term and the reply", 5);
    const partial = conversation("research", "course details", 9);
    const merged = mergeSidebarState(snapshot(full, [full], 5), snapshot(partial, [partial], 9));

    expect(merged.messages[0]?.text).toBe("course details for the fall term and the reply");
    expect(merged.conversationHistory[0]?.messages[0]?.text).toBe("course details for the fall term and the reply");
  });

  it("keeps a newer longer transcript and a new chat", () => {
    const research = conversation("research", "course details", 5);
    const longer = conversation("research", "course details and the admissions reply", 8);
    const merged = mergeSidebarState(
      snapshot(research, [research], 5),
      snapshot(longer, [longer], 8),
    );
    expect(merged.messages[0]?.text).toBe("course details and the admissions reply");

    const startedNewChat = mergeSidebarState(merged, snapshot(null, [longer], 12));
    expect(startedNewChat.currentConversationId).toBe("new-chat");
    expect(startedNewChat.messages).toEqual([]);
    expect(startedNewChat.conversationHistory.map((item) => item.id)).toEqual(["research"]);
  });

  it("keeps activity when a newer copy of the same transcript has none", () => {
    const withActivity = conversation("research", "course details", 5, [{ callId: "call-1", tool: "tabs.list", status: "succeeded" }]);
    const withoutActivity = conversation("research", "course details", 9);
    const merged = mergeSidebarState(snapshot(withActivity, [withActivity], 5), snapshot(withoutActivity, [withoutActivity], 9));

    expect(merged.conversationHistory[0]?.toolStatuses).toEqual(withActivity.toolStatuses);
  });

  it("reads a saved sidebar blob that has no savedAt", () => {
    const restored = readStoredSidebarState({
      threadId: "thread-1",
      currentConversationId: "research",
      messages: [],
      theme: "dark",
      selectedModel: "gpt",
      completionSoundEnabled: true,
      conversationHistory: [conversation("research", "course details", 4)],
    });

    expect(restored?.savedAt).toBe(0);
    expect(restored?.theme).toBe("dark");
    expect(restored?.messages).toEqual([]);
    expect(restored?.conversationHistory[0]?.messages[0]?.text).toBe("course details");
  });
});
