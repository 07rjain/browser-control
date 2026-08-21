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
import {
  BROWSER_TASK_ACTION_LIMIT_KEY,
  normalizeBrowserTaskActionLimit,
  pageToolCallSchema,
  parsePageToolArguments,
  type PageToolCall,
} from "../shared/page-tools";
import { captureCurrentPage, PagePermissionRequiredError } from "./page-extractor";
import {
  currentControlOrigin,
  describePageTarget,
  executePageTool,
  PageControlPermissionRequiredError,
} from "./page-executor-host";
import { decidePageAction, type PageTargetDescription } from "./page-policy";
import {
  describeCloseTarget,
  dynamicToolCallSchema,
  executeTabTool,
  type DynamicToolCall,
} from "./tab-tools";

const NATIVE_HOST = "com.codex.sidebar";
const NATIVE_TIMEOUT_MS = 30_000;
const COMPLETED_KEY = "codexSidebarCompletedToolCalls";
const ACTIVITY_KEY = "codexSidebarBrowserActivities";
const TASK_KEY = "codexSidebarBrowserTasks";
const THREAD_TARGETS_KEY = "codexSidebarThreadWorkingTabs";
const COMPLETION_NOTICE_KEY = "codexSidebarCompletionNotice";
const PENDING_PROMPTS_KEY = "codexSidebarPendingBrowserPrompts";
const TASK_ORIGINS_KEY = "codexSidebarTaskControlOrigins";
const TASK_TOMBSTONE_TTL_MS = 10 * 60 * 1_000;
const accountResponseSchema = z.object({ account: accountSchema, requiresOpenaiAuth: z.boolean() });
const loginResponseSchema = z.object({
  type: z.literal("chatgpt"),
  loginId: z.string().min(1),
  authUrl: z.string().url(),
});
const threadResponseSchema = z.object({ threadId: z.string().min(1), model: z.string().min(1) });
const turnResponseSchema = z.object({ turnId: z.string().min(1) });
const modelsResponseSchema = z.object({
  models: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    isDefault: z.boolean(),
  })),
});

type BrowserToolCall = DynamicToolCall | PageToolCall;

interface PendingNativeRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface StoredToolResult {
  key: string;
  success: boolean;
  result: unknown;
  completedAt: number;
}

interface BrowserTaskState {
  key: string;
  threadId: string;
  turnId: string;
  actionCount: number;
  actionLimit?: number;
  canceled: boolean;
  finished?: boolean;
  authorizedOrigin?: string;
  authorizedOriginPattern?: string;
  authorizedTabId?: number;
  updatedAt: number;
}

interface ThreadWorkingTab {
  threadId: string;
  tabId: number;
  updatedAt: number;
}

interface PendingApproval {
  call: BrowserToolCall;
  target?: PageTargetDescription;
}

interface PendingPermission {
  call: PageToolCall;
  tabId: number;
  originPattern: string;
}

interface StoredPendingPrompt {
  callId: string;
  type: "approval" | "permission";
  data: Record<string, unknown>;
  approval?: PendingApproval;
  permission?: PendingPermission;
}

let nativePort: chrome.runtime.Port | null = null;
const pendingNative = new Map<string, PendingNativeRequest>();
const pendingApprovals = new Map<string, PendingApproval>();
const pendingPermissions = new Map<string, PendingPermission>();
const pendingPrompts = new Map<string, { type: "approval" | "permission"; data: Record<string, unknown> }>();
const finishedTurns = new Set<string>();

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
  if (message.event === "chat.turnCompleted") {
    const data = message.data as { turnId?: unknown; turn?: { id?: unknown } } | undefined;
    const turnId = data?.turnId ?? data?.turn?.id;
    if (typeof turnId === "string") {
      finishedTurns.add(turnId);
      setTimeout(() => finishedTurns.delete(turnId), TASK_TOMBSTONE_TTL_MS);
      void finishBrowserTurn(turnId);
    }
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

function toolKey(call: BrowserToolCall): string {
  if (call.namespace === "page") {
    const args = parsePageToolArguments(call);
    return `page:${call.threadId}:${call.turnId}:${args.idempotencyKey}`;
  }
  return call.callId;
}

function taskKey(call: BrowserToolCall): string {
  return `${call.threadId}:${call.turnId}`;
}

async function storedList<T>(key: string): Promise<T[]> {
  const result = await chrome.storage.session.get(key);
  return Array.isArray(result[key]) ? (result[key] as T[]) : [];
}

async function persistPendingPrompt(prompt: StoredPendingPrompt): Promise<void> {
  const prompts = (await storedList<StoredPendingPrompt>(PENDING_PROMPTS_KEY))
    .filter((item) => item.callId !== prompt.callId);
  prompts.push(prompt);
  await chrome.storage.session.set({ [PENDING_PROMPTS_KEY]: prompts.slice(-20) });
}

async function removePendingPrompt(callId: string): Promise<void> {
  const prompts = await storedList<StoredPendingPrompt>(PENDING_PROMPTS_KEY);
  await chrome.storage.session.set({
    [PENDING_PROMPTS_KEY]: prompts.filter((item) => item.callId !== callId),
  });
}

async function getThreadWorkingTab(threadId: string): Promise<number | undefined> {
  const targets = await storedList<ThreadWorkingTab>(THREAD_TARGETS_KEY);
  const target = targets.find((item) => item.threadId === threadId);
  if (!target) return undefined;
  try {
    await chrome.tabs.get(target.tabId);
    return target.tabId;
  } catch {
    await chrome.storage.session.set({
      [THREAD_TARGETS_KEY]: targets.filter((item) => item.threadId !== threadId),
    });
    return undefined;
  }
}

async function setThreadWorkingTab(threadId: string, tabId: number): Promise<void> {
  await chrome.tabs.get(tabId);
  const targets = (await storedList<ThreadWorkingTab>(THREAD_TARGETS_KEY)).filter((item) => item.threadId !== threadId);
  targets.push({ threadId, tabId, updatedAt: Date.now() });
  await chrome.storage.session.set({ [THREAD_TARGETS_KEY]: targets.slice(-40) });
}

async function ensureThreadWorkingTab(threadId: string): Promise<number> {
  const existing = await getThreadWorkingTab(threadId);
  if (existing !== undefined) return existing;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id === undefined) throw new Error("No browser tab is available for this request.");
  await setThreadWorkingTab(threadId, active.id);
  return active.id;
}

async function getCompleted(call: BrowserToolCall): Promise<StoredToolResult | undefined> {
  const key = toolKey(call);
  return (await storedList<StoredToolResult>(COMPLETED_KEY)).find((item) => item.key === key);
}

async function storeCompleted(call: BrowserToolCall, success: boolean, result: unknown): Promise<void> {
  const key = toolKey(call);
  const current = (await storedList<StoredToolResult>(COMPLETED_KEY)).filter((item) => item.key !== key);
  current.push({ key, success, result, completedAt: Date.now() });
  await chrome.storage.session.set({ [COMPLETED_KEY]: current.slice(-30) });
}

async function storeActivity(call: BrowserToolCall, status: string, extra?: Record<string, unknown>): Promise<void> {
  const entry = {
    callId: call.callId,
    namespace: call.namespace,
    tool: call.tool,
    status,
    threadId: call.threadId,
    turnId: call.turnId,
    timestamp: Date.now(),
    ...extra,
  };
  const current = await storedList<Record<string, unknown>>(ACTIVITY_KEY);
  current.push(entry);
  await chrome.storage.session.set({ [ACTIVITY_KEY]: current.slice(-100) });
  broadcast("tool.status", entry);
}

async function getTask(call: BrowserToolCall): Promise<BrowserTaskState> {
  const key = taskKey(call);
  const tasks = await storedList<BrowserTaskState>(TASK_KEY);
  const existing = tasks.find((item) => item.key === key);
  if (existing) return existing;
  const workingTabId = await getThreadWorkingTab(call.threadId);
  return {
    key,
    threadId: call.threadId,
    turnId: call.turnId,
    actionCount: 0,
    canceled: false,
    authorizedTabId: workingTabId,
    updatedAt: Date.now(),
  };
}

async function saveTask(task: BrowserTaskState): Promise<void> {
  const tasks = (await storedList<BrowserTaskState>(TASK_KEY)).filter((item) => item.key !== task.key);
  tasks.push(task);
  await chrome.storage.session.set({ [TASK_KEY]: tasks.slice(-20) });
}

async function recordAction(call: BrowserToolCall): Promise<void> {
  const task = await getTask(call);
  if (finishedTurns.has(call.turnId)) throw new Error("This browser turn already finished.");
  if (task.canceled) throw new Error("The user stopped this browser task.");
  if (task.finished) throw new Error("This browser turn already finished.");
  if (task.actionLimit === undefined) {
    const stored = await chrome.storage.local.get(BROWSER_TASK_ACTION_LIMIT_KEY);
    task.actionLimit = normalizeBrowserTaskActionLimit(stored[BROWSER_TASK_ACTION_LIMIT_KEY]);
  }
  if (task.actionCount >= task.actionLimit) {
    throw new Error(`This browser task reached its ${task.actionLimit}-action safety limit.`);
  }
  task.actionCount += 1;
  task.updatedAt = Date.now();
  await saveTask(task);
}

async function respondToTool(call: BrowserToolCall, success: boolean, result: unknown): Promise<void> {
  await requestNative("tool.respond", { requestId: call.requestId, success, result });
}

async function finishTool(call: BrowserToolCall, success: boolean, result: unknown, status: string): Promise<void> {
  pendingPrompts.delete(call.callId);
  await removePendingPrompt(call.callId);
  await storeCompleted(call, success, result);
  await respondToTool(call, success, result);
  const error = typeof result === "object" && result && "error" in result ? (result as { error: unknown }).error : "Browser action failed.";
  await storeActivity(call, status, success ? undefined : { error });
}

function parseBrowserToolCall(input: unknown): BrowserToolCall | null {
  const tab = dynamicToolCallSchema.safeParse(input);
  if (tab.success) return tab.data;
  const page = pageToolCallSchema.safeParse(input);
  return page.success ? page.data : null;
}

async function handleTabCall(call: DynamicToolCall, announce: boolean): Promise<void> {
  if (announce) await storeActivity(call, "requested");
  if (call.tool === "close") {
    const target = await describeCloseTarget(call);
    pendingApprovals.set(call.callId, { call });
    await storeActivity(call, "awaiting confirmation", { target: { title: target.title, url: target.url } });
    const prompt = {
      callId: call.callId,
      namespace: call.namespace,
      tool: call.tool,
      title: "Close this tab?",
      description: "Closing a tab can discard unsaved page state.",
      target: { label: target.title, url: target.url },
      approveLabel: "Close tab",
      rejectLabel: "Keep tab",
      danger: true,
    };
    pendingPrompts.set(call.callId, { type: "approval", data: prompt });
    await persistPendingPrompt({ callId: call.callId, type: "approval", data: prompt, approval: { call } });
    broadcast("tool.approval", prompt);
    return;
  }
  await recordAction(call);
  await storeActivity(call, "running");
  let result = await executeTabTool(call);
  if (call.tool === "list" && Array.isArray(result)) {
    const workingTabId = await getThreadWorkingTab(call.threadId);
    result = result.map((tab) => tab && typeof tab === "object"
      ? { ...tab, selectedForTask: "id" in tab && tab.id === workingTabId }
      : tab);
  }
  if ((call.tool === "activate" || call.tool === "open") && result && typeof result === "object" && "id" in result) {
    const tabId = (result as { id?: unknown }).id;
    if (typeof tabId === "number") {
      const task = await getTask(call);
      task.authorizedTabId = tabId;
      task.authorizedOrigin = undefined;
      task.authorizedOriginPattern = undefined;
      task.updatedAt = Date.now();
      await saveTask(task);
      await setThreadWorkingTab(call.threadId, tabId);
    }
  }
  await finishTool(call, true, result, "succeeded");
}

async function executePageCallForTask(
  call: PageToolCall,
  task: BrowserTaskState,
  target?: PageTargetDescription,
): Promise<unknown> {
  if (call.tool === "click" && target?.newTab && target.href && isSafeHttpUrl(target.href)) {
    if (task.authorizedTabId === undefined) throw new Error("This browser task has no working tab.");
    const source = await chrome.tabs.get(task.authorizedTabId);
    const created = await chrome.tabs.create({ url: target.href, active: false, windowId: source.windowId });
    if (created.id === undefined) throw new Error("Chrome did not return the opened background tab.");
    task.authorizedTabId = created.id;
    task.authorizedOrigin = undefined;
    task.authorizedOriginPattern = undefined;
    task.updatedAt = Date.now();
    await saveTask(task);
    await setThreadWorkingTab(call.threadId, created.id);
    return {
      tabId: created.id,
      url: created.url ?? target.href,
      title: created.title ?? "Loading…",
      openedInBackground: true,
      selectedForTask: true,
    };
  }
  return executePageTool(call, task.authorizedTabId);
}

async function handlePageCall(call: PageToolCall, announce: boolean): Promise<void> {
  parsePageToolArguments(call);
  if (announce) await storeActivity(call, "requested");
  const task = await getTask(call);
  if (task.authorizedTabId === undefined) {
    task.authorizedTabId = await ensureThreadWorkingTab(call.threadId);
    task.updatedAt = Date.now();
    await saveTask(task);
  }
  const controlOrigin = await currentControlOrigin(task.authorizedTabId);
  if (
    task.authorizedTabId !== controlOrigin.tabId ||
    task.authorizedOrigin !== controlOrigin.origin ||
    task.authorizedOriginPattern !== controlOrigin.originPattern
  ) {
    const storedOrigins = await chrome.storage.local.get(TASK_ORIGINS_KEY);
    const rememberedControlOrigins = Array.isArray(storedOrigins[TASK_ORIGINS_KEY])
      ? (storedOrigins[TASK_ORIGINS_KEY] as string[])
      : [];
    const remembered =
      rememberedControlOrigins.includes(controlOrigin.originPattern) &&
      (await chrome.permissions.contains({ origins: [controlOrigin.originPattern] }));
    if (!remembered) throw new PageControlPermissionRequiredError(controlOrigin.origin, controlOrigin.originPattern);
    task.authorizedOrigin = controlOrigin.origin;
    task.authorizedOriginPattern = controlOrigin.originPattern;
    task.authorizedTabId = controlOrigin.tabId;
    task.updatedAt = Date.now();
    await saveTask(task);
  }
  let target: PageTargetDescription | undefined;
  if (["click", "keypress", "submit"].includes(call.tool)) target = await describePageTarget(call, false, task.authorizedTabId);
  const policy = decidePageAction(call, target);
  if (policy.decision === "refuse") {
    await finishTool(call, false, { error: policy.reason }, "failed");
    return;
  }
  if (policy.decision === "confirm") {
    pendingApprovals.set(call.callId, { call, target });
    await storeActivity(call, "awaiting confirmation", { origin: target?.form?.action ?? target?.href });
    const prompt = {
      callId: call.callId,
      namespace: call.namespace,
      tool: call.tool,
      title: policy.title,
      description: policy.description,
      target: {
        label: target?.label ?? call.tool,
        url: target?.href ?? target?.form?.action,
        form: target?.form,
      },
      approveLabel: call.tool === "submit" ? "Submit form" : "Allow once",
      rejectLabel: "Cancel",
      danger: call.tool === "submit",
    };
    pendingPrompts.set(call.callId, { type: "approval", data: prompt });
    await persistPendingPrompt({ callId: call.callId, type: "approval", data: prompt, approval: { call, target } });
    broadcast("tool.approval", prompt);
    return;
  }
  await recordAction(call);
  await storeActivity(call, "running");
  const result = await executePageCallForTask(call, task, target);
  await finishTool(call, true, result, "succeeded");
}

async function handleDynamicToolCall(input: unknown): Promise<void> {
  const call = parseBrowserToolCall(input);
  if (!call) {
    broadcast("tool.status", { status: "failed", error: "Rejected malformed browser tool request." });
    return;
  }
  try {
    const completed = await getCompleted(call);
    if (completed) {
      await respondToTool(call, completed.success, completed.result);
      return;
    }
    if (call.namespace === "tabs") await handleTabCall(call, true);
    else await handlePageCall(call, true);
  } catch (error) {
    if (error instanceof PageControlPermissionRequiredError && call.namespace === "page") {
      const permissionTask = await getTask(call);
      if (permissionTask.authorizedTabId === undefined) {
        await finishTool(call, false, { error: "This browser task has no working tab." }, "failed").catch(() => undefined);
        return;
      }
      const pendingPermission: PendingPermission = {
        call,
        tabId: permissionTask.authorizedTabId,
        originPattern: error.originPattern,
      };
      pendingPermissions.set(call.callId, pendingPermission);
      await storeActivity(call, "awaiting permission", { origin: error.origin });
      const prompt = { callId: call.callId, origin: error.origin, originPattern: error.originPattern };
      pendingPrompts.set(call.callId, { type: "permission", data: prompt });
      await persistPendingPrompt({
        callId: call.callId,
        type: "permission",
        data: prompt,
        permission: pendingPermission,
      });
      broadcast("tool.permission", prompt);
      return;
    }
    const message = error instanceof Error ? error.message : "Browser action failed.";
    if (error instanceof z.ZodError && call.namespace === "page") {
      await respondToTool(call, false, { error: "The page tool arguments were rejected by policy." }).catch(() => undefined);
      await storeActivity(call, "failed", { error: "The page tool arguments were rejected by policy." });
      return;
    }
    await finishTool(call, false, { error: message }, /stale|expired|changed/i.test(message) ? "stale" : "failed").catch(() => undefined);
  }
}

async function decideTool(callId: string, approved: boolean): Promise<unknown> {
  const stored = (await storedList<StoredPendingPrompt>(PENDING_PROMPTS_KEY)).find((item) => item.callId === callId);
  const pending = pendingApprovals.get(callId) ?? stored?.approval;
  if (!pending) throw new Error("This browser-action request is no longer pending.");
  pendingApprovals.delete(callId);
  pendingPrompts.delete(callId);
  await removePendingPrompt(callId);
  const { call } = pending;
  if (!approved) {
    await finishTool(call, false, { error: "The user rejected this browser action." }, "rejected");
    return { rejected: true };
  }
  try {
    if (call.namespace === "page" && pending.target) {
      const approvalTask = await getTask(call);
      const currentTarget = await describePageTarget(call, true, approvalTask.authorizedTabId);
      const expected = JSON.stringify({
        label: pending.target.label,
        href: pending.target.href,
        form: pending.target.form,
        snapshotId: pending.target.snapshotId,
      });
      const current = JSON.stringify({
        label: currentTarget.label,
        href: currentTarget.href,
        form: currentTarget.form,
        snapshotId: currentTarget.snapshotId,
      });
      if (expected !== current) throw new Error("The page or reviewed form changed. Inspect it again before approving.");
    }
    await recordAction(call);
    await storeActivity(call, "running");
    const task = await getTask(call);
    const result = call.namespace === "tabs" ? await executeTabTool(call) : await executePageCallForTask(call, task, pending.target);
    await finishTool(call, true, result, "succeeded");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Browser action failed.";
    await finishTool(call, false, { error: message }, /stale|expired|changed/i.test(message) ? "stale" : "failed");
    throw error;
  }
}

async function continueAfterPermission(callId: string, originPattern: string, granted: boolean): Promise<unknown> {
  const stored = (await storedList<StoredPendingPrompt>(PENDING_PROMPTS_KEY)).find((item) => item.callId === callId);
  const pending = pendingPermissions.get(callId) ?? stored?.permission;
  if (!pending) throw new Error("This browser permission request is no longer pending.");
  const { call, tabId, originPattern: expectedOriginPattern } = pending;
  pendingPermissions.delete(callId);
  pendingPrompts.delete(callId);
  await removePendingPrompt(callId);
  const expected = await currentControlOrigin(tabId);
  if (expected.originPattern !== originPattern || expectedOriginPattern !== originPattern) {
    await finishTool(call, false, { error: "The task's working page changed before permission was granted." }, "failed");
    throw new Error("The task's working page changed before permission was granted.");
  }
  if (!granted) {
    await finishTool(call, false, { error: "The user denied site access." }, "rejected");
    return { rejected: true };
  }
  const allowed = await chrome.permissions.contains({ origins: [originPattern] });
  if (!allowed) throw new Error("Chrome did not grant the requested site access.");
  const task = await getTask(call);
  task.authorizedOrigin = expected.origin;
  task.authorizedOriginPattern = originPattern;
  task.authorizedTabId = expected.tabId;
  task.updatedAt = Date.now();
  await saveTask(task);
  const storedOrigins = await chrome.storage.local.get(TASK_ORIGINS_KEY);
  const currentOrigins = Array.isArray(storedOrigins[TASK_ORIGINS_KEY])
    ? (storedOrigins[TASK_ORIGINS_KEY] as string[])
    : [];
  await chrome.storage.local.set({ [TASK_ORIGINS_KEY]: [...new Set([...currentOrigins, originPattern])] });
  await handlePageCall(call, false);
  return { continued: true };
}

async function finishBrowserTurn(turnId: string): Promise<void> {
  const now = Date.now();
  const tasks = (await storedList<BrowserTaskState>(TASK_KEY))
    .filter((task) => now - task.updatedAt < TASK_TOMBSTONE_TTL_MS);
  const completedTask = tasks.find((task) => task.turnId === turnId);
  for (const task of tasks) {
    if (task.turnId === turnId) {
      task.finished = true;
      task.updatedAt = now;
    }
  }
  await chrome.storage.session.set({ [TASK_KEY]: tasks.slice(-40) });
  if (completedTask && completedTask.actionCount > 0 && !completedTask.canceled) {
    await chrome.storage.session.set({
      [COMPLETION_NOTICE_KEY]: {
        turnId,
        message: "Task complete — you can check the result when you’re ready.",
        timestamp: now,
      },
    });
  }
}

async function cancelBrowserTask(threadId: string, turnId?: string): Promise<void> {
  const tasks = await storedList<BrowserTaskState>(TASK_KEY);
  let matched = false;
  for (const task of tasks) {
    if (task.threadId === threadId && (!turnId || task.turnId === turnId)) {
      matched = true;
      task.canceled = true;
      task.updatedAt = Date.now();
    }
  }
  if (turnId && !matched) {
    tasks.push({
      key: `${threadId}:${turnId}`,
      threadId,
      turnId,
      actionCount: 0,
      canceled: true,
      updatedAt: Date.now(),
    });
  }
  await chrome.storage.session.set({ [TASK_KEY]: tasks });
  const pendingByCall = new Map<string, { call: BrowserToolCall }>();
  for (const item of pendingApprovals.values()) pendingByCall.set(item.call.callId, { call: item.call });
  for (const item of pendingPermissions.values()) pendingByCall.set(item.call.callId, { call: item.call });
  const storedPrompts = await storedList<StoredPendingPrompt>(PENDING_PROMPTS_KEY);
  for (const item of storedPrompts) {
    const call = item.approval?.call ?? item.permission?.call;
    if (call) pendingByCall.set(call.callId, { call });
  }
  const canceledCallIds = new Set<string>();
  for (const item of pendingByCall.values()) {
    if (item.call.threadId === threadId && (!turnId || item.call.turnId === turnId)) {
      canceledCallIds.add(item.call.callId);
      pendingApprovals.delete(item.call.callId);
      pendingPermissions.delete(item.call.callId);
      pendingPrompts.delete(item.call.callId);
      await finishTool(item.call, false, { error: "The user stopped this browser task." }, "canceled").catch(() => undefined);
    }
  }
  await chrome.storage.session.set({
    [PENDING_PROMPTS_KEY]: storedPrompts.filter((item) => !canceledCallIds.has(item.callId)),
  });
}

async function routeRequest(input: unknown): Promise<unknown> {
  const request = uiRequestSchema.parse(input);
  switch (request.type) {
    case "BRIDGE_STATUS": return requestNative("bridge.status");
    case "BROWSER_STATE_READ": {
      const storedPrompts = await storedList<StoredPendingPrompt>(PENDING_PROMPTS_KEY);
      const promptByCall = new Map(storedPrompts.map((prompt) => [prompt.callId, { type: prompt.type, data: prompt.data }]));
      for (const [callId, prompt] of pendingPrompts) promptByCall.set(callId, prompt);
      return {
        activities: await storedList<Record<string, unknown>>(ACTIVITY_KEY),
        prompts: [...promptByCall.values()],
        completionNotice: (await chrome.storage.session.get(COMPLETION_NOTICE_KEY))[COMPLETION_NOTICE_KEY] ?? null,
      };
    }
    case "COMPLETION_NOTICE_DISMISS":
      await chrome.storage.session.remove(COMPLETION_NOTICE_KEY);
      return { dismissed: true };
    case "ACCOUNT_READ": return accountResponseSchema.parse(await requestNative("account.read"));
    case "AUTH_LOGIN": return loginResponseSchema.parse(await requestNative("auth.login"));
    case "AUTH_CANCEL": return requestNative("auth.cancel", { loginId: request.loginId });
    case "AUTH_LOGOUT": return requestNative("auth.logout");
    case "MODELS_READ": return modelsResponseSchema.parse(await requestNative("models.list"));
    case "CHAT_START": return threadResponseSchema.parse(await requestNative("chat.start", { model: request.model }));
    case "CHAT_RESUME": return threadResponseSchema.parse(await requestNative("chat.resume", { threadId: request.threadId, model: request.model }));
    case "CHAT_SEND": {
      await ensureThreadWorkingTab(request.threadId);
      return turnResponseSchema.parse(await requestNative("chat.send", { threadId: request.threadId, text: request.text, clientMessageId: request.clientMessageId, model: request.model }));
    }
    case "CHAT_INTERRUPT": return requestNative("chat.interrupt", { threadId: request.threadId, turnId: request.turnId });
    case "BROWSER_TASK_CANCEL": return cancelBrowserTask(request.threadId, request.turnId);
    case "PAGE_ATTACH": return captureCurrentPage();
    case "PAGE_CONTROL_PERMISSION_RESULT": return continueAfterPermission(request.callId, request.originPattern, request.granted);
    case "OPEN_EXTERNAL":
      if (!isSafeHttpUrl(request.url)) throw new Error("Only http/https links can be opened.");
      return chrome.tabs.create({ url: request.url, active: true });
    case "TOOL_DECISION": return decideTool(request.callId, request.approved);
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
        code: isValidationError ? "INVALID_REQUEST" : isPagePermissionError ? "PAGE_PERMISSION_REQUIRED" : "REQUEST_FAILED",
        details: isPagePermissionError ? { originPattern: error.originPattern } : undefined,
      } satisfies UiResponse);
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const targets = await storedList<ThreadWorkingTab>(THREAD_TARGETS_KEY);
    await chrome.storage.session.set({
      [THREAD_TARGETS_KEY]: targets.filter((target) => target.tabId !== tabId),
    });
    const tasks = await storedList<BrowserTaskState>(TASK_KEY);
    for (const task of tasks) {
      if (task.authorizedTabId === tabId && !task.finished) {
        task.canceled = true;
        task.updatedAt = Date.now();
      }
    }
    await chrome.storage.session.set({ [TASK_KEY]: tasks });
  })();
});

async function enableSidePanel(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(() => {
  void enableSidePanel();
});
chrome.runtime.onStartup.addListener(() => {
  void enableSidePanel();
});
void enableSidePanel();
