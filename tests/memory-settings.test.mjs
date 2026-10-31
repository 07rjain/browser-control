// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import MemorySettings from "../src/sidepanel/MemorySettings";

afterEach(cleanup);
const initial = () => ({
  version: 1, identity: "11111111-1111-4111-8111-111111111111", revision: 1, enabled: true,
  records: [{ id: "22222222-2222-4222-8222-222222222222", kind: "preference", text: "Prefer short answers", pinned: false, createdAt: 1, updatedAt: 1, expiresAt: null, source: { type: "manual" } }],
});
it("edits memories in their existing rows, keeps a conflicting draft, and loads changes without a refresh button", async () => {
  const state = initial();
  const request = async (operation) => {
    if (operation === "read") return structuredClone(state);
    throw new Error("Memory changed. The latest version has been loaded; review your edit and save again.");
  };
  const view = render(createElement(MemorySettings, { disabled: false, refreshKey: 0, request }));
  const editor = await screen.findByRole("textbox", { name: "Memory 1" });
  expect(screen.queryByRole("button", { name: "Edit", exact: true })).toBeNull();
  expect(screen.queryByRole("button", { name: "Refresh memory" })).toBeNull();
  expect(screen.queryByLabelText(/Expires/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Start a chat without memory" })).toBeNull();
  fireEvent.change(editor, { target: { value: "Prefer detailed examples" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/Memory changed/));
  expect(screen.getByRole("textbox", { name: "Memory 1" }).value).toBe("Prefer detailed examples");
  expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(false);
  state.revision++; state.records.push({ ...state.records[0], id: "33333333-3333-4333-8333-333333333333", text: "My name is Rishabh" });
  await act(async () => view.rerender(createElement(MemorySettings, { disabled: false, refreshKey: 1, request })));
  expect((await screen.findByRole("textbox", { name: "Memory 2" })).value).toBe("My name is Rishabh");
  expect(screen.getByRole("textbox", { name: "Memory 1" }).value).toBe("Prefer detailed examples");
});
