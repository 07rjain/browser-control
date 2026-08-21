import { describe, expect, it } from "vitest";
import { settleCanceledMessages } from "../src/sidepanel/chat-state";

describe("canceled chat state", () => {
  it("removes an empty streaming placeholder", () => {
    expect(settleCanceledMessages([
      { id: "user-1", role: "user", text: "Do something" },
      { id: "assistant-1", role: "assistant", text: "", streaming: true },
    ])).toEqual([{ id: "user-1", role: "user", text: "Do something", streaming: false }]);
  });

  it("keeps partial assistant text but stops its animation", () => {
    expect(settleCanceledMessages([
      { id: "assistant-1", role: "assistant", text: "Partially complete", streaming: true },
    ])).toEqual([{ id: "assistant-1", role: "assistant", text: "Partially complete", streaming: false }]);
  });
});
