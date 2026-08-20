import { z } from "zod";
import {
  accountSchema,
  nativeEnvelopeSchema,
  type NativeEnvelope,
  type SidebarEvent,
  type UiResponse,
  uiRequestSchema,
  isSafeHttpUrl,
} from "../shared/protocol";
import { captureCurrentPage, PagePermissionRequiredError } from "./page-extractor";
import {
  describeCloseTarget,
  dynamicToolCallSchema,
  executeTabTool,
  type DynamicToolCall,
} from "./tab-tools";

const NATIVE_HOST = "com.codex.sidebar";
const NATIVE_TIMEOUT_MS = 30_000;
const accountResponseSchema = z.object({ account: accountSchema, requiresOpenaiAuth: z.boolean() });
const loginResponseSchema = z.object({
  type: z.literal("chatgpt"),
  loginId: z.string().min(1),
  authUrl: z.string().url(),
});
const threadResponseSchema = z.object({ threadId: z.string().min(1), model: z.string().min(1) });
const turnResponseSchema = z.object({ turnId: z.string().min(1) });

interface PendingNativeRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

let nativePort: chrome.runtime.Port | null = null;
const pendingNative = new Map<string, PendingNativeRequest>();
const pendingCloseApprovals = new Map<string, DynamicToolCall>();
const completedToolCalls = new Map<string, unknown>();

function broadcast(event: string, data?: unknown): void {
  const message: SidebarEvent = { source: "codex-sidebar-background", event, data };
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

function rejectAllPending(reason: string): void {
  for (const pending of pendingNative.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
  }
  pendingNative.clear();
}

function connectNative(): chrome.runtime.Port {
  if (nativePort) return nativePort;

  const port = chrome.runtime.connectNative(NATIVE_HOST);
  nativePort = port;
  port.onMessage.addListener((message: unknown) => {
    const parsed = nativeEnvelopeSchema.safeParse(message);
    if (!parsed.success) {
      broadcast("bridge.error", { message: "The native companion sent an invalid message." });
      return;
    }
    handleNativeEnvelope(parsed.data);
  });
  port.onDisconnect.addListener(() => {
    const detail = chrome.runtime.lastError?.message ?? "Native companion disconnected.";
    nativePort = null;
    rejectAllPending(detail);
    broadcast("bridge.status", { connected: false, error: detail });
  });
  broadcast("bridge.status", { connected: true });
  return port;
}

function handleNativeEnvelope(message: NativeEnvelope): void {
  if (message.type === "response") {
    const pending = pendingNative.get(message.id);
    if (!pending) return;
    pendingNative.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.ok) pending.resolve(message.data);
    else pending.reject(new Error(message.error ?? "Native companion request failed."));
    return;
  }

  if (message.event === "tool.request") {
    void handleDynamicToolCall(message.data);
    return;
  }
  broadcast(message.event, message.data);
}

function requestNative(method: string, params?: unknown): Promise<unknown> {
  const id = crypto.randomUUID();
  const port = connectNative();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingNative.delete(id);
      reject(new Error(`The native companion timed out while running ${method}.`));
    }, NATIVE_TIMEOUT_MS);
    pendingNative.set(id, { resolve, reject, timeout });
    port.postMessage({ type: "request", id, method, params });
  });
}

async function respondToTool(call: DynamicToolCall, success: boolean, result: unknown): Promise<void> {
  await requestNative("tool.respond", {
    requestId: call.requestId,
    success,
    result,
  });
}

async function handleDynamicToolCall(input: unknown): Promise<void> {
  const parsed = dynamicToolCallSchema.safeParse(input);
  if (!parsed.success) {
    broadcast("tool.status", { status: "failed", error: "Rejected malformed browser tool request." });
    return;
  }
  const call = parsed.data;

  if (completedToolCalls.has(call.callId)) {
    await respondToTool(call, true, completedToolCalls.get(call.callId));
    return;
  }

  broadcast("tool.status", { ...call, status: "requested" });
  if (call.tool === "close") {
    try {
      const target = await describeCloseTarget(call);
      pendingCloseApprovals.set(call.callId, call);
      broadcast("tool.approval", { ...call, target });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to inspect the tab.";
      await respondToTool(call, false, { error: message });
      broadcast("tool.status", { ...call, status: "failed", error: message });
    }
    return;
  }

  try {
    broadcast("tool.status", { ...call, status: "running" });
    const result = await executeTabTool(call);
    completedToolCalls.set(call.callId, result);
    await respondToTool(call, true, result);
    broadcast("tool.status", { ...call, status: "succeeded", result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Browser action failed.";
    await respondToTool(call, false, { error: message });
    broadcast("tool.status", { ...call, status: "failed", error: message });
  }
}

async function decideClose(callId: string, approved: boolean): Promise<unknown> {
  const call = pendingCloseApprovals.get(callId);
  if (!call) throw new Error("This tab-close request is no longer pending.");
  pendingCloseApprovals.delete(callId);

  if (!approved) {
    await respondToTool(call, false, { error: "The user rejected this tab close." });
    broadcast("tool.status", { ...call, status: "rejected" });
    return { rejected: true };
  }

  try {
    const result = await executeTabTool(call);
    completedToolCalls.set(call.callId, result);
    await respondToTool(call, true, result);
    broadcast("tool.status", { ...call, status: "succeeded", result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to close the tab.";
    await respondToTool(call, false, { error: message });
    broadcast("tool.status", { ...call, status: "failed", error: message });
    throw error;
  }
}

async function routeRequest(input: unknown): Promise<unknown> {
  const request = uiRequestSchema.parse(input);
  switch (request.type) {
    case "BRIDGE_STATUS":
      return requestNative("bridge.status");
    case "ACCOUNT_READ":
      return accountResponseSchema.parse(await requestNative("account.read"));
    case "AUTH_LOGIN":
      return loginResponseSchema.parse(await requestNative("auth.login"));
    case "AUTH_CANCEL":
      return requestNative("auth.cancel", { loginId: request.loginId });
    case "AUTH_LOGOUT":
      return requestNative("auth.logout");
    case "CHAT_START":
      return threadResponseSchema.parse(await requestNative("chat.start"));
    case "CHAT_RESUME":
      return threadResponseSchema.parse(await requestNative("chat.resume", { threadId: request.threadId }));
    case "CHAT_SEND":
      return turnResponseSchema.parse(
        await requestNative("chat.send", {
          threadId: request.threadId,
          text: request.text,
          clientMessageId: request.clientMessageId,
        }),
      );
    case "CHAT_INTERRUPT":
      return requestNative("chat.interrupt", {
        threadId: request.threadId,
        turnId: request.turnId,
      });
    case "PAGE_ATTACH":
      return captureCurrentPage();
    case "OPEN_EXTERNAL":
      if (!isSafeHttpUrl(request.url)) throw new Error("Only http/https links can be opened.");
      return chrome.tabs.create({ url: request.url, active: true });
    case "TOOL_DECISION":
      return decideClose(request.callId, request.approved);
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if ((message as Partial<SidebarEvent>)?.source === "codex-sidebar-background") return false;
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: "Rejected message from an unknown sender." } satisfies UiResponse);
    return false;
  }

  void routeRequest(message)
    .then((data) => sendResponse({ ok: true, data } satisfies UiResponse))
    .catch((error: unknown) => {
      const isValidationError = error instanceof z.ZodError;
      const messageText = error instanceof Error ? error.message : "Unexpected extension error.";
      const isPagePermissionError = error instanceof PagePermissionRequiredError;
      sendResponse({
        ok: false,
        error: isValidationError ? "The extension rejected an invalid request." : messageText,
        code: isValidationError
          ? "INVALID_REQUEST"
          : isPagePermissionError
            ? "PAGE_PERMISSION_REQUIRED"
            : "REQUEST_FAILED",
        details: isPagePermissionError ? { originPattern: error.originPattern } : undefined,
      } satisfies UiResponse);
    });
  return true;
});

async function enableSidePanel(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(() => void enableSidePanel());
chrome.runtime.onStartup.addListener(() => void enableSidePanel());
void enableSidePanel();
