import { describe, expect, it } from "vitest";
import {
  createConversationRecord,
  MAX_CONVERSATION_HISTORY,
  readConversationHistory,
  upsertConversation,
  type ConversationRecord,
} from "../src/sidepanel/conversation-history";

describe("conversation history", () => {
  it("creates a compact title and keeps activity belonging to the transcript", () => {
    const record = createConversationRecord(
      "conversation-1",
      "thread-1",
      [{ id: "turn-1", role: "user", text: "  Organize   all of my open tabs by topic  " }],
      [
        { callId: "call-1", tool: "list", status: "succeeded", turnId: "turn-1" },
        { callId: "call-2", tool: "open", status: "succeeded", turnId: "another-turn" },
      ],
      10,
    );

    expect(record.title).toBe("Organize all of my open tabs by topic");
    expect(record.toolStatuses).toHaveLength(1);
  });

  it("updates an existing conversation and bounds the history", () => {
    let history: ConversationRecord[] = [];
    for (let index = 0; index <= MAX_CONVERSATION_HISTORY; index += 1) {
      history = upsertConversation(history, createConversationRecord(
        `conversation-${index}`,
        null,
        [{ id: `message-${index}`, role: "user", text: `Message ${index}` }],
        [],
        index,
      ));
    }

    expect(history).toHaveLength(MAX_CONVERSATION_HISTORY);
    expect(history[0]?.id).toBe(`conversation-${MAX_CONVERSATION_HISTORY}`);
    expect(history.some((item) => item.id === "conversation-0")).toBe(false);
  });

  it("safely reads persisted history and settles streaming messages", () => {
    expect(readConversationHistory([{
      id: "conversation-1",
      threadId: "thread-1",
      messages: [{ id: "message-1", role: "assistant", text: "Done", streaming: true }],
      updatedAt: 42,
    }, { id: 3 }])).toEqual([expect.objectContaining({
      id: "conversation-1",
      messages: [expect.objectContaining({ streaming: false })],
      toolStatuses: [],
    })]);
  });
});
