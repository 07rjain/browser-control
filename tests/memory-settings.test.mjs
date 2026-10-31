// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import MemorySettings from "../src/sidepanel/MemorySettings";

afterEach(cleanup);
it("retains the user's edit draft and shows the host error when a stale save is rejected", async () => {
  const state = {
    version: 1, identity: "11111111-1111-4111-8111-111111111111", revision: 1, enabled: true,
    records: [{ id: "22222222-2222-4222-8222-222222222222", kind: "preference", text: "Prefer short answers", pinned: false, createdAt: 1, updatedAt: 1, expiresAt: null, source: { type: "manual" } }],
  };
  render(createElement(MemorySettings, {
    disabled: false, onNewChatWithoutMemory: () => {},
    request: async (operation) => {
      if (operation === "read") return state;
      throw new Error("Memory changed. Refresh and review the current version before saving.");
    },
  }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
  fireEvent.change(screen.getByRole("textbox", { name: "Edit memory" }), { target: { value: "Prefer detailed examples" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/Memory changed/));
  expect(screen.getByRole("textbox", { name: "Edit memory" }).value).toBe("Prefer detailed examples");
  expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(false);
});
