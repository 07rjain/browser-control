// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REVIEW_SYSTEM_PROMPT } from "../src/shared/auto-review";
import { DEFAULT_CHAT_SYSTEM_PROMPT } from "../src/shared/chat-settings";
import App from "../src/sidepanel/App";
import type { SidebarEvent } from "../src/shared/protocol";

const page = { title: "Disposable page", url: "https://example.com/", origin: "https://example.com", readableText: "Public test page", selectedText: "", truncated: false };
const listeners = new Set<(message: SidebarEvent, sender: chrome.runtime.MessageSender) => void>();
let stored: Record<string, unknown>;
let capture: () => Promise<unknown>;
let requests: Array<Record<string, unknown>>;
let restoredNotice: unknown;
let reviewerAvailable: boolean;
let chatPrompt: string;
let chatSettingsError: string | null;

beforeEach(() => {
  stored = {}; requests = []; restoredNotice = null; reviewerAvailable = true;
  chatPrompt = DEFAULT_CHAT_SYSTEM_PROMPT; chatSettingsError = null;
  capture = async () => page;
  listeners.clear();
  vi.stubGlobal("chrome", {
    runtime: {
      id: "sidebar-test",
      getPlatformInfo: async () => ({ os: "mac" }),
      onMessage: { addListener: (listener: typeof listeners extends Set<infer T> ? T : never) => listeners.add(listener), removeListener: (listener: typeof listeners extends Set<infer T> ? T : never) => listeners.delete(listener) },
      sendMessage: vi.fn(async (request: Record<string, unknown>) => {
        requests.push(request);
        let data: unknown = {};
        switch (request.type) {
          case "ACCOUNT_READ": data = { account: { type: "chatgpt", email: null, planType: "test" } }; break;
          case "AUTO_REVIEW_READ": data = { version: 2, available: reviewerAvailable, configurableModel: true, editableSystemPrompt: true }; break;
          case "CHAT_SETTINGS_READ": data = { version: 1, systemPrompt: chatPrompt }; break;
          case "CHAT_SETTINGS_WRITE": {
            if (chatSettingsError) return { ok: false, error: chatSettingsError };
            chatPrompt = (request.settings as { systemPrompt: string }).systemPrompt;
            data = { version: 1, systemPrompt: chatPrompt }; break;
          }
          case "MODELS_READ": data = { models: [{ id: "alpha", name: "Alpha", isDefault: true }, { id: "beta", name: "Beta", isDefault: false }] }; break;
          case "RECORDING_READ": data = { status: "idle" }; break;
          case "SKILLS_LIST": data = { skills: [] }; break;
          case "BROWSER_STATE_READ": data = { activities: [], prompts: [], completionNotice: restoredNotice }; break;
          case "PAGE_ATTACH": data = await capture(); break;
        }
        return { ok: true, data };
      }),
    },
    permissions: { contains: async () => false, remove: vi.fn(async () => true), request: vi.fn(async () => true) },
    storage: { local: {
      get: async () => ({ ...stored }),
      set: async (data: Record<string, unknown>) => Object.assign(stored, data),
      remove: async (key: string) => { delete stored[key]; },
    } },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: () => undefined });
  // jsdom does not implement dialog.showModal/close; native focus and inertness are browser checks.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function ready() {
  render(<App />);
  await screen.findByRole("button", { name: "Attach the current page" });
}

async function enableAutoReview() {
  // A real browser cannot select this option until the companion capability
  // check completes. fireEvent otherwise bypasses the disabled option.
  await vi.waitFor(() => expect((screen.getByRole("option", { name: "Auto review" }) as HTMLOptionElement).disabled).toBe(false));
  await act(async () => fireEvent.change(screen.getByRole("combobox", { name: "Agent permission" }), { target: { value: "auto" } }));
}

function emit(event: string, data: unknown) {
  for (const listener of listeners) listener({ source: "codex-sidebar-background", event, data } as SidebarEvent, { id: "sidebar-test" });
}

describe("sidebar interactions", () => {
  it("shows one settings section at a time, keeps drafts across sections, and supports keyboard navigation and dismissal", async () => {
    await ready(); fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    const settings = screen.getByRole("dialog", { name: "Settings" });
    expect(within(settings).getByRole("tabpanel", { name: "General" })).toBeTruthy();
    expect(within(settings).getByRole("combobox", { name: "Theme" })).toBeTruthy();
    expect(within(settings).queryByRole("combobox", { name: "Agent permission" })).toBeNull();
    expect(within(settings).queryByRole("group", { name: "Models in composer" })).toBeNull();
    expect(within(settings).queryByRole("button", { name: /Delete all Browser Control data/ })).toBeNull();
    fireEvent.click(within(settings).getByRole("tab", { name: "Agent" }));
    expect(within(settings).getByText("Auto review settings").closest("details")?.open).toBe(false);
    fireEvent.click(within(settings).getByText("Main chat system prompt"));
    const prompt = await within(settings).findByRole("textbox", { name: "Main system prompt" }) as HTMLTextAreaElement;
    await vi.waitFor(() => expect(prompt.disabled).toBe(false));
    fireEvent.change(prompt, { target: { value: "Keep my unsaved instructions." } });
    const models = within(settings).getByRole("tab", { name: "Models" });
    fireEvent.click(models);
    expect(within(settings).getByRole("group", { name: "Models in composer" })).toBeTruthy();
    fireEvent.keyDown(models, { key: "ArrowRight" });
    expect(within(settings).getByRole("tab", { name: "Agent" }).getAttribute("aria-selected")).toBe("true");
    expect(within(settings).getByRole("textbox", { name: "Main system prompt" })).toBe(prompt);
    expect(prompt.value).toBe("Keep my unsaved instructions.");
    fireEvent.keyDown(within(settings).getByRole("tab", { name: "Agent" }), { key: "End" });
    expect(within(settings).getByRole("button", { name: /Delete all Browser Control data/ })).toBeTruthy();
    fireEvent(settings, new Event("cancel", { cancelable: true, bubbles: true }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open settings" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("loads, edits, saves and resets the main prompt independently of reviewer settings", async () => {
    await ready(); fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    fireEvent.click(screen.getByText("Main chat system prompt"));
    const prompt = await screen.findByRole("textbox", { name: "Main system prompt" }) as HTMLTextAreaElement;
    await vi.waitFor(() => expect(prompt.disabled).toBe(false));
    expect(prompt.value).toBe(DEFAULT_CHAT_SYSTEM_PROMPT);
    const custom = "  Use concise replies.\nExplain browser results clearly.  ";
    fireEvent.change(prompt, { target: { value: custom } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save main prompt" })));
    expect(requests).toContainEqual(expect.objectContaining({ type: "CHAT_SETTINGS_WRITE", settings: { version: 1, systemPrompt: custom } }));
    expect(screen.getByText(/Main system prompt saved/)).toBeTruthy();
    expect(stored.codexSidebarAutoReview).toBeUndefined();
    cleanup(); await ready(); fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    fireEvent.click(screen.getByText("Main chat system prompt"));
    const restored = await screen.findByRole("textbox", { name: "Main system prompt" }) as HTMLTextAreaElement;
    await vi.waitFor(() => expect(restored.value).toBe(custom));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reset main prompt to default" })));
    expect(restored.value).toBe(DEFAULT_CHAT_SYSTEM_PROMPT);
    expect(requests.at(-1)).toMatchObject({ type: "CHAT_SETTINGS_WRITE", settings: { version: 1, systemPrompt: DEFAULT_CHAT_SYSTEM_PROMPT } });
  });

  it("rejects invalid main prompts and retains the draft when saving fails", async () => {
    await ready(); fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    fireEvent.click(screen.getByText("Main chat system prompt"));
    const prompt = await screen.findByRole("textbox", { name: "Main system prompt" }) as HTMLTextAreaElement;
    await vi.waitFor(() => expect(prompt.disabled).toBe(false));
    for (const value of ["  ", "x".repeat(12001), "bad\0prompt"]) {
      fireEvent.change(prompt, { target: { value } });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save main prompt" })));
      expect(screen.getByRole("alert").textContent).toMatch(/non-empty main system prompt/);
    }
    expect(requests.filter((request) => request.type === "CHAT_SETTINGS_WRITE")).toHaveLength(0);
    chatSettingsError = "Unable to write local settings.";
    fireEvent.change(prompt, { target: { value: "Keep this draft." } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save main prompt" })));
    expect(screen.getByRole("alert").textContent).toBe(chatSettingsError);
    expect(prompt.value).toBe("Keep this draft.");
    expect(chatPrompt).toBe(DEFAULT_CHAT_SYSTEM_PROMPT);
  });

  it("opts into Auto review with legacy Ask storage and an independent Luna model", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    const select = screen.getByRole("combobox", { name: "Agent permission" });
    await enableAutoReview();
    expect(stored.codexSidebarBrowserPermissionMode).toBe("ask");
    expect(stored.codexSidebarAutoReview).toEqual({ version: 2, enabled: true, model: "gpt-6-luna", systemPrompt: DEFAULT_REVIEW_SYSTEM_PROMPT });
    fireEvent.click(screen.getByText("Auto review settings"));
    expect((screen.getByRole("combobox", { name: "Reviewer model" }) as HTMLSelectElement).value).toBe("gpt-6-luna");
    expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ["http://*/*", "https://*/*"] });
    await act(async () => fireEvent.change(select, { target: { value: "ask" } }));
    expect(stored.codexSidebarAutoReview).toMatchObject({ enabled: false });
    expect(screen.getByRole("combobox", { name: "Reviewer model" })).toBeTruthy();
  });

  it("lets the user choose a hidden composer model and save/reset an independent reviewer prompt", async () => {
    stored.codexSidebarVisibleModels = ["alpha"];
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    const permission = screen.getByRole("combobox", { name: "Agent permission" });
    await enableAutoReview();
    fireEvent.click(screen.getByText("Auto review settings"));
    const model = screen.getByRole("combobox", { name: "Reviewer model" });
    expect(within(model).getByRole("option", { name: "Beta" })).toBeTruthy();
    const prompt = screen.getByRole("textbox", { name: "Reviewer system prompt" });
    expect((prompt as HTMLTextAreaElement).value).toBe(DEFAULT_REVIEW_SYSTEM_PROMPT);
    const custom = "Approve only explicitly requested benign searches. Ask me for every other action.";
    fireEvent.change(prompt, { target: { value: custom } });
    await act(async () => fireEvent.change(model, { target: { value: "beta" } }));
    expect((prompt as HTMLTextAreaElement).value).toBe(custom);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save prompt" })));
    expect(stored.codexSidebarAutoReview).toMatchObject({ version: 2, model: "beta", systemPrompt: custom, enabled: true });
    await act(async () => fireEvent.change(permission, { target: { value: "ask" } }));
    await act(async () => fireEvent.change(permission, { target: { value: "auto" } }));
    expect(stored.codexSidebarAutoReview).toMatchObject({ model: "beta", systemPrompt: custom });
    cleanup(); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    fireEvent.click(screen.getByText("Auto review settings"));
    expect((screen.getByRole("combobox", { name: "Reviewer model" }) as HTMLSelectElement).value).toBe("beta");
    expect((screen.getByRole("textbox", { name: "Reviewer system prompt" }) as HTMLTextAreaElement).value).toBe(custom);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reset prompt to default" })));
    expect(stored.codexSidebarAutoReview).toMatchObject({ model: "beta", systemPrompt: DEFAULT_REVIEW_SYSTEM_PROMPT });
  });

  it("rejects an empty prompt while retaining the saved prompt", async () => {
    await ready(); fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    await enableAutoReview();
    fireEvent.click(screen.getByText("Auto review settings"));
    fireEvent.change(screen.getByRole("textbox", { name: "Reviewer system prompt" }), { target: { value: "  " } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save prompt" })));
    expect(screen.getByRole("alert").textContent).toMatch(/non-empty system prompt/);
    expect(stored.codexSidebarAutoReview).toMatchObject({ systemPrompt: DEFAULT_REVIEW_SYSTEM_PROMPT });
  });

  it("disables new Auto review selection for an unsupported companion", async () => {
    reviewerAvailable = false;
    await ready(); fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    const option = screen.getByRole("option", { name: "Auto review" }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(screen.getByText(/Auto review requires the updated companion/)).toBeTruthy();
  });

  it("updates the same activity row through review and preserves approval attribution", async () => {
    await ready();
    const call = { callId: "review", namespace: "page", tool: "submit", turnId: "review-turn", threadId: "thread" };
    act(() => { emit("chat.delta", { turnId: "review-turn", delta: "Searching" }); emit("tool.status", { ...call, status: "reviewing", review: { model: "gpt-6-luna", status: "reviewing", reason: "Reviewing the proposed action." } }); });
    const row = screen.getByText("Browser · page.submit").closest("li")!;
    expect(within(row).getByText(/gpt-6-luna/)).toBeTruthy();
    act(() => emit("tool.status", { ...call, status: "running", review: { model: "gpt-6-luna", status: "approved", source: "reviewer", reason: "Approved a verified low-risk action." } }));
    act(() => emit("tool.status", { ...call, status: "succeeded" }));
    expect(screen.getByText("Browser · page.submit").closest("li")).toBe(row);
    expect(within(row).getByText(/Approved a verified low-risk action/)).toBeTruthy();
  });

  it("toggles page attachment repeatedly and discards a capture completed after detach", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Attach the current page" }));
    await screen.findByRole("button", { name: "Detach the current page" });
    fireEvent.click(screen.getByRole("button", { name: "Detach the current page" }));
    expect(screen.queryByRole("button", { name: "Remove page attachment" })).toBeNull();
    let finish!: (value: unknown) => void;
    capture = () => new Promise((resolve) => { finish = resolve; });
    fireEvent.click(screen.getByRole("button", { name: "Attach the current page" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel page attachment" }));
    await act(async () => finish(page));
    expect(screen.queryByRole("button", { name: "Remove page attachment" })).toBeNull();
    capture = async () => page;
    fireEvent.click(screen.getByRole("button", { name: "Attach the current page" }));
    await screen.findByRole("button", { name: "Detach the current page" });
  });

  it("persists visible models and shows only enabled choices, keeping one selectable", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Models" }));
    const settings = screen.getByRole("group", { name: "Models in composer" });
    await within(settings).findByRole("checkbox", { name: "Beta" });
    fireEvent.click(within(settings).getByRole("checkbox", { name: "Beta" }));
    fireEvent.click(within(settings).getByRole("checkbox", { name: "Codex default" }));
    expect((within(settings).getByRole("checkbox", { name: "Alpha" }) as HTMLInputElement).disabled).toBe(true);
    expect(stored.codexSidebarVisibleModels).toEqual(["alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Model, Alpha" }));
    expect(within(screen.getByRole("listbox", { name: "Models" })).getAllByRole("option").map((option) => option.textContent)).toEqual(["Alpha · Default"]);
    cleanup();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^Model,/ }));
    expect(screen.queryByRole("option", { name: "Beta" })).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("updates one activity row through running/failure and clears the running border and notice after completion", async () => {
    await ready();
    vi.useFakeTimers();
    const call = { callId: "call-1", namespace: "tabs", tool: "list", turnId: "turn-1", threadId: "thread-1" };
    act(() => {
      emit("chat.delta", { turnId: "turn-1", delta: "Checking tabs" });
      emit("tool.status", { ...call, status: "requested" });
    });
    const composer = screen.getByRole("form", { name: "Message composer" });
    expect(composer.classList.contains("composer-running")).toBe(true);
    const row = screen.getByText("Browser · tabs.list").closest("li");
    act(() => emit("tool.status", { ...call, status: "running" }));
    expect(screen.getByText("Browser · tabs.list").closest("li")).toBe(row);
    expect(within(row!).getByText("running")).toBeTruthy();
    act(() => emit("tool.status", { ...call, status: "failed", error: "Test failure" }));
    expect(screen.getAllByText("Browser · tabs.list")).toHaveLength(1);
    expect(within(row!).getByText("Test failure")).toBeTruthy();
    act(() => emit("tool.status", { ...call, callId: "call-2", status: "succeeded" }));
    act(() => emit("chat.turnCompleted", { turn: { id: "turn-1", status: "completed" } }));
    expect(composer.classList.contains("composer-running")).toBe(false);
    expect(screen.getByText(/Task complete —/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(9_999));
    expect(screen.getByText(/Task complete —/)).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.queryByText(/Task complete —/)).toBeNull();
    expect(requests.some((request) => request.type === "COMPLETION_NOTICE_DISMISS")).toBe(true);
  });

  it("does not resurrect an old completion notice when reopening the sidebar", async () => {
    restoredNotice = { message: "Old task complete", timestamp: Date.now() - 11_000 };
    await ready();
    expect(screen.queryByText("Old task complete")).toBeNull();
  });

  it("clears the running highlight when Codex reports an error", async () => {
    await ready();
    act(() => emit("chat.delta", { turnId: "failed-turn", delta: "Starting" }));
    const composer = screen.getByRole("form", { name: "Message composer" });
    expect(composer.classList.contains("composer-running")).toBe(true);
    act(() => emit("chat.error", { message: "Test failure" }));
    expect(composer.classList.contains("composer-running")).toBe(false);
  });

  it("clears the running highlight when Stop finishes interrupting a turn", async () => {
    stored.codexSidebarState = { threadId: "thread-1", currentConversationId: "test-chat", messages: [], theme: "system", selectedModel: "" };
    await ready();
    act(() => emit("chat.delta", { turnId: "stopped-turn", delta: "Starting" }));
    const composer = screen.getByRole("form", { name: "Message composer" });
    expect(composer.classList.contains("composer-running")).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stop response" })); });
    expect(composer.classList.contains("composer-running")).toBe(false);
    expect(requests.some((request) => request.type === "CHAT_INTERRUPT" && request.turnId === "stopped-turn")).toBe(true);
  });

  it("uses the remaining notice lifetime after reopening instead of starting another ten seconds", async () => {
    vi.useFakeTimers();
    restoredNotice = { message: "Recent task complete", timestamp: Date.now() - 9_000 };
    await act(async () => { render(<App />); });
    expect(screen.getByText("Recent task complete")).toBeTruthy();
    act(() => vi.advanceTimersByTime(999));
    expect(screen.getByText("Recent task complete")).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Recent task complete")).toBeNull();
  });
});
