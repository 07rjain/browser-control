import { z } from "zod";
import { attachmentSummarySchema } from "../shared/attachments";
import { AUTO_REVIEW_SETTINGS_KEY, DEFAULT_AUTO_REVIEW, REVIEW_MODEL, REVIEW_TIMEOUT_MS, readAutoReviewSettings, reviewCapabilitiesSchema, reviewVerdictSchema, verdictApproves, type AutoReviewSettings, type ReviewActivity } from "../shared/auto-review";
import { reviewCandidate, reviewFingerprint, reviewedTarget } from "./auto-review-policy";
import { freshCompletionNotice } from "../shared/completion-notice";
import {
  accountSchema,
  nativeEnvelopeSchema,
  type NativeEnvelope,
  type SidebarEvent,
  type UiResponse,
  skillDeletedResponseSchema,
  skillEnabledResponseSchema,
  skillSavedResponseSchema,
  skillsListResponseSchema,
  uiRequestSchema,
  isSafeHttpUrl,
} from "../shared/protocol";
import {
  BROWSER_PERMISSION_MODE_KEY,
  BROWSER_TASK_ACTION_LIMIT_KEY,
  FULL_ACCESS_HOST_GRANT_KEY,
  FULL_ACCESS_HOST_PATTERNS,
  TASK_ORIGINS_KEY,
  normalizeBrowserPermissionMode,
  normalizeBrowserTaskActionLimit,
  pageToolCallSchema,
  parsePageToolArguments,
  type BrowserPermissionMode,
  type PageToolCall,
} from "../shared/page-tools";
import {
  acceptRecorderPort,
  cancelSkillRecording,
  followRecordingActivation,
  forgetRecordingTab,
  grantSkillRecording,
  noteRecordingNavigation,
  readSkillRecording,
  recordingBlocksBrowserWork,
  saveSkillRecording,
  startSkillRecording,
  stopSkillRecording,
  updateSkillRecording,
} from "./skill-recording-host";
import { clearConversationStore, saveConversationSnapshot } from "./conversation-persist";
import { captureCurrentPage, PagePermissionRequiredError } from "./page-extractor";
import {
  currentControlOrigin,
  describePageTarget,
  executePageTool,
  PageControlPermissionRequiredError,
  setPageTaskIndicator,
} from "./page-executor-host";
import { decidePageAction, type PageTargetDescription } from "./page-policy";
import {
  describeCloseTarget,
  dynamicToolCallSchema,
  executeTabTool,
  parseToolArguments,
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
const REVIEW_INTENTS_KEY = "codexSidebarReviewIntents";
const EXECUTIONS_KEY = "codexSidebarApprovalExecutions";
const KNOWN_URLS_KEY = "codexSidebarThreadKnownUrls";
const MAX_KNOWN_URLS_PER_THREAD = 300;
const TASK_TOMBSTONE_TTL_MS = 10 * 60 * 1_000;
const accountResponseSchema = z.object({ account: accountSchema, requiresOpenaiAuth: z.boolean() });
const loginResponseSchema = z.object({
  type: z.literal("chatgpt"),
  loginId: z.string().min(1),
  authUrl: z.string().url(),
});
const threadResponseSchema = z.object({ threadId: z.string().min(1), model: z.string().min(1) });
const threadIdResponseSchema = z.object({ threadId: z.string().min(1) });
const turnResponseSchema = z.object({ turnId: z.string().min(1) });
const modelsResponseSchema = z.object({
  models: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    isDefault: z.boolean(),
    inputModalities: z.array(z.string()).optional(),
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
  successfulActionCount?: number;
  actionLimit?: number;
  permissionMode?: BrowserPermissionMode;
  autoReview?: AutoReviewSettings;
  reviewCount?: number;
  reviewLimit?: number;
  userInstruction?: string;
  canceled: boolean;
  finished?: boolean;
  browserActivityStarted?: boolean;
  authorizedOrigin?: string;
  authorizedOriginPattern?: string;
  authorizedTabId?: number;
  recoveryUrl?: string;
  workingTabClosed?: boolean;
  updatedAt: number;
}

interface ThreadWorkingTab {
  threadId: string;
  tabId: number;
  updatedAt: number;
}

interface ThreadKnownUrls {
  threadId: string;
  urls: string[];
  updatedAt: number;
}

interface PendingApproval {
  call: BrowserToolCall;
  target?: PageTargetDescription;
  review?: { id: string; fingerprint: string; deadline: number };
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
const processingCalls = new Map<string, BrowserToolCall>();
const decidingCalls = new Set<string>();
const liveReviews = new Map<string, string>();
interface ReviewIntent { threadId: string; text?: string; createdAt: number }
interface ExecutionMarker { key: string; taskKey?: string; createdAt: number }
const finishedTurns = new Set<string>();
const canceledTasks = new Set<string>();
const observedTasks = new Set<string>();
const retiredTasks = new Set<string>();
let lifecycleEpoch = 0;

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
    void handleNativeEnvelope(parsed.data);
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

async function handleNativeEnvelope(message: NativeEnvelope): Promise<void> {
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
  if (message.event === "skill.status") {
    await recordSkillStatus(message.data);
    return;
  }
  if (message.event === "chat.turnCompleted") {
    const data = message.data as { turnId?: unknown; turn?: { id?: unknown } } | undefined;
    const turnId = data?.turnId ?? data?.turn?.id;
    if (typeof turnId === "string") {
      finishedTurns.add(turnId);
      setTimeout(() => finishedTurns.delete(turnId), TASK_TOMBSTONE_TTL_MS);
      await finishBrowserTurn(turnId);
    }
  }
  broadcast(message.event, message.data);
}

function requestNative(method: string, params?: unknown, timeoutMs = NATIVE_TIMEOUT_MS): Promise<unknown> {
  const id = crypto.randomUUID();
  const port = connectNative();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingNative.delete(id);
      reject(new Error(`The native companion timed out while running ${method}.`));
    }, timeoutMs);
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

function taskKey(call: { threadId: string; turnId: string }): string {
  return `${call.threadId}:${call.turnId}`;
}

async function storedList<T>(key: string): Promise<T[]> {
  const result = await chrome.storage.session.get(key);
  return Array.isArray(result[key]) ? (result[key] as T[]) : [];
}

async function persistPendingPrompt(prompt: StoredPendingPrompt): Promise<void> {
  const call = prompt.approval?.call ?? prompt.permission?.call;
  if (call && retiredTasks.has(taskKey(call))) return;
  const prompts = (await storedList<StoredPendingPrompt>(PENDING_PROMPTS_KEY))
    .filter((item) => item.callId !== prompt.callId);
  if (call && retiredTasks.has(taskKey(call))) return;
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

function normalizedHttpUrl(value: unknown): string | null {
  return typeof value === "string" && isSafeHttpUrl(value) ? new URL(value).href : null;
}

function urlsInText(text: string): string[] {
  return (text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? []).map((url) => url.replace(/[.,;:!?)\]}]+$/, ""));
}

function inspectedUrls(result: unknown): unknown[] {
  if (!result || typeof result !== "object") return [];
  const { url, elements } = result as { url?: unknown; elements?: unknown };
  const hrefs = Array.isArray(elements)
    ? elements.map((element) => (element && typeof element === "object" ? (element as { href?: unknown }).href : undefined))
    : [];
  return [url, ...hrefs];
}

// Model-built addresses can carry page or tab data to another site, so
// tabs.open runs unprompted only for exact URLs that reached the thread from
// the user, an open tab, or an inspected page.
async function rememberThreadUrls(threadId: string, values: unknown[]): Promise<void> {
  const urls = values.map(normalizedHttpUrl).filter((url): url is string => url !== null);
  if (urls.length === 0) return;
  const entries = await storedList<ThreadKnownUrls>(KNOWN_URLS_KEY);
  const existing = entries.find((entry) => entry.threadId === threadId)?.urls ?? [];
  const merged = [...new Set([...existing, ...urls])].slice(-MAX_KNOWN_URLS_PER_THREAD);
  const others = entries.filter((entry) => entry.threadId !== threadId);
  await chrome.storage.session.set({
    [KNOWN_URLS_KEY]: [...others, { threadId, urls: merged, updatedAt: Date.now() }].slice(-40),
  });
}

async function isKnownThreadUrl(threadId: string, value: string): Promise<boolean> {
  const url = normalizedHttpUrl(value);
  if (!url) return false;
  const entries = await storedList<ThreadKnownUrls>(KNOWN_URLS_KEY);
  if (entries.find((entry) => entry.threadId === threadId)?.urls.includes(url)) return true;
  const tasks = await storedList<BrowserTaskState>(TASK_KEY);
  if (tasks.some((task) => task.threadId === threadId && normalizedHttpUrl(task.recoveryUrl) === url)) return true;
  const tabs = await chrome.tabs.query({});
  return tabs.some((tab) => normalizedHttpUrl(tab.url) === url || normalizedHttpUrl(tab.pendingUrl) === url);
}

async function copyThreadKnownUrls(sourceThreadId: string, targetThreadId: string): Promise<void> {
  const source = (await storedList<ThreadKnownUrls>(KNOWN_URLS_KEY)).find((entry) => entry.threadId === sourceThreadId);
  if (source) await rememberThreadUrls(targetThreadId, source.urls);
}

async function copyThreadWorkingTab(sourceThreadId: string, targetThreadId: string): Promise<void> {
  const tabId = await getThreadWorkingTab(sourceThreadId);
  if (tabId !== undefined) await setThreadWorkingTab(targetThreadId, tabId);
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

const skillStatusSchema = z.object({
  callId: z.string().min(1),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  status: z.enum(["succeeded", "failed"]),
  error: z.string().max(500).optional(),
});

async function recordSkillStatus(input: unknown): Promise<void> {
  const parsed = skillStatusSchema.safeParse(input);
  if (!parsed.success) return;
  await storeActivity({
    callId: parsed.data.callId,
    namespace: "skills",
    tool: parsed.data.name,
    threadId: parsed.data.threadId,
    turnId: parsed.data.turnId,
  }, parsed.data.status, parsed.data.error ? { error: parsed.data.error } : undefined);
}

async function storeActivity(call: { callId: string; namespace?: string; tool: string; threadId: string; turnId: string }, status: string, extra?: Record<string, unknown>): Promise<void> {
  if (retiredTasks.has(taskKey(call))) return;
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
  if (retiredTasks.has(taskKey(call))) return;
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
  const intent = (await storedList<ReviewIntent>(REVIEW_INTENTS_KEY)).find((item) => item.threadId === call.threadId && Date.now() - item.createdAt < 60_000);
  return {
    key,
    threadId: call.threadId,
    turnId: call.turnId,
    actionCount: 0,
    canceled: false,
    authorizedTabId: workingTabId,
    userInstruction: intent?.text,
    updatedAt: Date.now(),
  };
}

async function saveTask(task: BrowserTaskState): Promise<void> {
  if (retiredTasks.has(task.key)) return;
  const current = await storedList<BrowserTaskState>(TASK_KEY);
  if (retiredTasks.has(task.key)) return;
  const previous = current.find((item) => item.key === task.key);
  // Stop/finish are monotonic even when a slower review callback holds an old task object.
  task.canceled ||= canceledTasks.has(task.key) || (previous?.canceled ?? false);
  task.finished ||= finishedTurns.has(task.turnId) || (previous?.finished ?? false);
  task.actionCount = Math.max(task.actionCount, previous?.actionCount ?? 0);
  task.reviewCount = Math.max(task.reviewCount ?? 0, previous?.reviewCount ?? 0);
  if (task.canceled || task.finished) delete task.userInstruction;
  const tasks = current.filter((item) => item.key !== task.key);
  tasks.push(task);
  await chrome.storage.session.set({ [TASK_KEY]: tasks.slice(-20) });
}

async function syncTaskIndicator(tabId: number): Promise<void> {
  const tasks = await storedList<BrowserTaskState>(TASK_KEY);
  const shouldShow = tasks.some((task) =>
    task.authorizedTabId === tabId &&
    task.browserActivityStarted === true &&
    Boolean(task.authorizedOriginPattern) &&
    !task.canceled &&
    !task.finished,
  );
  await setPageTaskIndicator(tabId, shouldShow).catch(() => false);
}

async function hasRememberedControlAccess(originPattern: string): Promise<boolean> {
  const stored = await chrome.storage.local.get([TASK_ORIGINS_KEY, FULL_ACCESS_HOST_GRANT_KEY]);
  const rememberedOrigins = Array.isArray(stored[TASK_ORIGINS_KEY])
    ? (stored[TASK_ORIGINS_KEY] as string[])
    : [];
  if (rememberedOrigins.includes(originPattern)) {
    return chrome.permissions.contains({ origins: [originPattern] });
  }
  if (stored[FULL_ACCESS_HOST_GRANT_KEY] !== true) return false;
  const broadGrantPresent = await chrome.permissions.contains({ origins: [...FULL_ACCESS_HOST_PATTERNS] });
  if (!broadGrantPresent) return false;
  return chrome.permissions.contains({ origins: [originPattern] });
}

async function refreshRememberedTaskOrigin(task: BrowserTaskState, tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab) {
    task.authorizedTabId = undefined;
    task.authorizedOrigin = undefined;
    task.authorizedOriginPattern = undefined;
    task.workingTabClosed = true;
    return;
  }
  task.authorizedTabId = tabId;
  task.authorizedOrigin = undefined;
  task.authorizedOriginPattern = undefined;
  task.workingTabClosed = false;
  if (tab.url && isSafeHttpUrl(tab.url)) task.recoveryUrl = tab.url;
  try {
    const controlOrigin = await currentControlOrigin(tabId);
    const remembered = await hasRememberedControlAccess(controlOrigin.originPattern);
    if (remembered) {
      task.authorizedTabId = controlOrigin.tabId;
      task.authorizedOrigin = controlOrigin.origin;
      task.authorizedOriginPattern = controlOrigin.originPattern;
    }
  } catch {
    // Protected, loading, or unapproved pages remain focusable without receiving an indicator.
  }
}

async function initializeBrowserTask(threadId: string, turnId: string, tabId: number): Promise<void> {
  const key = `${threadId}:${turnId}`;
  const tasks = await storedList<BrowserTaskState>(TASK_KEY);
  const existing = tasks.find((task) => task.key === key);
  const task = existing ?? await getTask({ threadId, turnId } as BrowserToolCall);
  await getTaskPermissionMode(task);
  if (task.authorizedTabId === undefined && !task.workingTabClosed) task.authorizedTabId = tabId;
  if (task.authorizedTabId !== undefined) await refreshRememberedTaskOrigin(task, task.authorizedTabId);
  task.updatedAt = Date.now();
  await saveTask(task);
}

function workingTabRecoveryError(task: BrowserTaskState): Error {
  const destination = task.recoveryUrl
    ? ` Reopen ${task.recoveryUrl} with tabs.open, or select another appropriate tab with tabs.activate.`
    : " Open a replacement with tabs.open, or select an appropriate existing tab with tabs.activate.";
  return new Error(
    `The task's working tab was closed. The browser task is still active.${destination} Then inspect the replacement page and continue without reusing old element references.`,
  );
}

async function markWorkingTabClosed(task: BrowserTaskState): Promise<void> {
  task.authorizedTabId = undefined;
  task.authorizedOrigin = undefined;
  task.authorizedOriginPattern = undefined;
  task.workingTabClosed = true;
  task.updatedAt = Date.now();
  await saveTask(task);
}

async function focusThreadWorkingTab(threadId: string): Promise<Record<string, unknown>> {
  const tabId = await getThreadWorkingTab(threadId);
  if (tabId === undefined) throw new Error("This conversation does not have an available working tab.");
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  const focused = await chrome.tabs.update(tabId, { active: true });
  if (!focused) throw new Error("Chrome could not focus the agent's working tab.");
  return {
    tabId,
    windowId: focused.windowId,
    title: focused.title ?? "Agent working tab",
    url: focused.url ?? "",
  };
}

async function recordAction(call: BrowserToolCall): Promise<void> {
  const task = await getTask(call);
  if (retiredTasks.has(taskKey(call))) throw new Error("This browser session was cleared.");
  if (finishedTurns.has(call.turnId)) throw new Error("This browser turn already finished.");
  if (task.canceled || canceledTasks.has(task.key)) throw new Error("The user stopped this browser task.");
  if (task.finished) throw new Error("This browser turn already finished.");
  if (task.actionLimit === undefined) {
    const stored = await chrome.storage.local.get(BROWSER_TASK_ACTION_LIMIT_KEY);
    task.actionLimit = normalizeBrowserTaskActionLimit(stored[BROWSER_TASK_ACTION_LIMIT_KEY]);
    task.reviewLimit = Math.min(task.reviewLimit ?? 20, task.actionLimit);
  }
  if (task.actionCount >= task.actionLimit) {
    throw new Error(`This browser task reached its ${task.actionLimit}-action safety limit.`);
  }
  const markers = await storedList<ExecutionMarker>(EXECUTIONS_KEY);
  if (markers.some((marker) => marker.key === toolKey(call))) throw new Error("This action's previous outcome is uncertain. Inspect the page before repeating it.");
  // Keep active-task markers even on long tasks; expire only finished-task history.
  const activeKeys = new Set((await storedList<BrowserTaskState>(TASK_KEY)).filter((item) => !item.finished && !item.canceled).map((item) => item.key));
  if (retiredTasks.has(task.key) || canceledTasks.has(task.key) || finishedTurns.has(call.turnId)) throw new Error("This browser task stopped before execution.");
  // Persist consumption before any browser side effect. A suspended worker cannot replay it.
  await chrome.storage.session.set({ [EXECUTIONS_KEY]: [...markers.filter((marker) => Date.now() - marker.createdAt < TASK_TOMBSTONE_TTL_MS || (marker.taskKey && activeKeys.has(marker.taskKey))), { key: toolKey(call), taskKey: task.key, createdAt: Date.now() }] });
  task.actionCount += 1;
  task.updatedAt = Date.now();
  await saveTask(task);
}

async function getTaskPermissionMode(task: BrowserTaskState): Promise<BrowserPermissionMode> {
  if (task.permissionMode !== undefined) {
    const normalized = normalizeBrowserPermissionMode(task.permissionMode);
    task.autoReview = normalized === "ask" ? readAutoReviewSettings(task.autoReview) : { ...DEFAULT_AUTO_REVIEW };
    if (task.permissionMode !== normalized) {
      task.permissionMode = normalized;
      await saveTask(task);
    }
    return normalized;
  }
  const stored = await chrome.storage.local.get([BROWSER_PERMISSION_MODE_KEY, AUTO_REVIEW_SETTINGS_KEY, BROWSER_TASK_ACTION_LIMIT_KEY]);
  task.permissionMode = normalizeBrowserPermissionMode(stored[BROWSER_PERMISSION_MODE_KEY]);
  task.autoReview = task.permissionMode === "ask" ? readAutoReviewSettings(stored[AUTO_REVIEW_SETTINGS_KEY]) : { ...DEFAULT_AUTO_REVIEW };
  task.reviewCount = 0;
  task.reviewLimit = Math.min(20, normalizeBrowserTaskActionLimit(stored[BROWSER_TASK_ACTION_LIMIT_KEY]));
  task.updatedAt = Date.now();
  await saveTask(task);
  return task.permissionMode;
}

async function activeTask(call: BrowserToolCall): Promise<BrowserTaskState> {
  const task = await getTask(call);
  if (retiredTasks.has(taskKey(call))) throw new Error("This browser session was cleared.");
  if (finishedTurns.has(call.turnId) || task.finished) throw new Error("This browser turn already finished.");
  if (task.canceled || canceledTasks.has(task.key)) throw new Error("The user stopped this browser task.");
  return task;
}

async function respondToTool(call: BrowserToolCall, success: boolean, result: unknown): Promise<void> {
  await requestNative("tool.respond", { requestId: call.requestId, success, result });
}

async function finishTool(call: BrowserToolCall, success: boolean, result: unknown, status: string): Promise<void> {
  if (retiredTasks.has(taskKey(call))) return;
  pendingPrompts.delete(call.callId);
  await removePendingPrompt(call.callId);
  if (success) {
    const task = await getTask(call);
    task.successfulActionCount = (task.successfulActionCount ?? 0) + 1;
    task.updatedAt = Date.now();
    await saveTask(task);
  }
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
  const task = await activeTask(call);
  if (announce) await storeActivity(call, "requested");
  task.browserActivityStarted = true;
  if (task.authorizedTabId !== undefined) await refreshRememberedTaskOrigin(task, task.authorizedTabId);
  task.updatedAt = Date.now();
  await saveTask(task);
  if (task.authorizedTabId !== undefined) await syncTaskIndicator(task.authorizedTabId);
  const permissionMode = await getTaskPermissionMode(task);
  let bypassedApproval: Record<string, unknown> | undefined;
  if (call.tool === "close") {
    const target = await describeCloseTarget(call);
    if (permissionMode === "ask") {
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
      await activeTask(call);
      pendingApprovals.set(call.callId, { call });
      pendingPrompts.set(call.callId, { type: "approval", data: prompt });
      await persistPendingPrompt({ callId: call.callId, type: "approval", data: prompt, approval: { call } });
      broadcast("tool.approval", prompt);
      return;
    }
    bypassedApproval = {
      permissionMode,
      confirmationBypassed: true,
      target: { label: target.title, url: target.url },
    };
  }
  if (call.tool === "open") {
    const url = new URL(parseToolArguments(call).url as string).href;
    if (!(await isKnownThreadUrl(call.threadId, url))) {
      await storeActivity(call, "awaiting confirmation", { target: { url } });
      const prompt = {
        callId: call.callId,
        namespace: call.namespace,
        tool: call.tool,
        title: "Open this page?",
        description: "This address did not come from your message, an open tab, or a link on an inspected page. Opening it sends everything in the address to that site.",
        target: { label: new URL(url).host, url },
        approveLabel: "Open page",
        rejectLabel: "Cancel",
        danger: false,
      };
      await activeTask(call);
      pendingApprovals.set(call.callId, { call });
      pendingPrompts.set(call.callId, { type: "approval", data: prompt });
      await persistPendingPrompt({ callId: call.callId, type: "approval", data: prompt, approval: { call } });
      broadcast("tool.approval", prompt);
      return;
    }
  }
  await recordAction(call);
  await storeActivity(call, "running", bypassedApproval);
  const result = await executeTabToolForThread(call);
  await finishTool(call, true, result, "succeeded");
}

async function executeTabToolForThread(call: DynamicToolCall): Promise<unknown> {
  let result = await executeTabTool(call);
  if (call.tool === "open") await rememberThreadUrls(call.threadId, [parseToolArguments(call).url]);
  if (call.tool === "list" && Array.isArray(result)) {
    const workingTabId = await getThreadWorkingTab(call.threadId);
    result = result.map((tab) => tab && typeof tab === "object"
      ? { ...tab, selectedForTask: "id" in tab && tab.id === workingTabId }
      : tab);
  }
  if ((call.tool === "activate" || call.tool === "open") && result && typeof result === "object" && "id" in result) {
    const tabId = (result as { id?: unknown }).id;
    if (typeof tabId === "number") {
      const updatedTask = await getTask(call);
      const previousTabId = updatedTask.authorizedTabId;
      await refreshRememberedTaskOrigin(updatedTask, tabId);
      updatedTask.updatedAt = Date.now();
      await saveTask(updatedTask);
      await setThreadWorkingTab(call.threadId, tabId);
      if (previousTabId !== undefined && previousTabId !== tabId) await syncTaskIndicator(previousTabId);
      await syncTaskIndicator(tabId);
    }
  }
  return result;
}

async function executePageCallForTask(
  call: PageToolCall,
  task: BrowserTaskState,
  target?: PageTargetDescription,
  approved = false,
): Promise<unknown> {
  if (call.tool === "click" && target?.newTab && target.href && isSafeHttpUrl(target.href)) {
    if (task.authorizedTabId === undefined) throw new Error("This browser task has no working tab.");
    const previousTabId = task.authorizedTabId;
    const source = await chrome.tabs.get(previousTabId);
    const created = await chrome.tabs.create({ url: target.href, active: false, windowId: source.windowId });
    if (created.id === undefined) throw new Error("Chrome did not return the opened background tab.");
    await refreshRememberedTaskOrigin(task, created.id);
    task.updatedAt = Date.now();
    await saveTask(task);
    await setThreadWorkingTab(call.threadId, created.id);
    await syncTaskIndicator(previousTabId);
    await syncTaskIndicator(created.id);
    return {
      tabId: created.id,
      url: created.url ?? target.href,
      title: created.title ?? "Loading…",
      openedInBackground: true,
      selectedForTask: true,
    };
  }
  const result = await executePageTool(call, task.authorizedTabId, approved && target ? JSON.stringify(target) : undefined);
  return processCapturedPopup(call, task, result);
}

async function processCapturedPopup(
  call: PageToolCall,
  task: BrowserTaskState,
  result: unknown,
): Promise<unknown> {
  if (call.tool !== "click" || !result || typeof result !== "object" || actionResultFailed(result)) return result;

  const clickResult = result as Record<string, unknown>;
  const createdTabs = Array.isArray(clickResult.createdTabs)
    ? clickResult.createdTabs.filter((tab): tab is { id: number; url: string; title?: string; active?: boolean } =>
      Boolean(tab && typeof tab === "object" && typeof (tab as { id?: unknown }).id === "number"))
    : [];
  const safeCreated: Array<{ id: number; url: string }> = [];
  for (const tab of createdTabs) {
    let url = typeof tab.url === "string" ? tab.url : "";
    if (!url) {
      const current = await chrome.tabs.get(tab.id).catch(() => undefined);
      url = current?.pendingUrl || current?.url || "";
    }
    if (!url || !isSafeHttpUrl(url)) {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
      continue;
    }
    if (tab.active === true) await chrome.tabs.update(tab.id, { active: false }).catch(() => undefined);
    safeCreated.push({ id: tab.id, url });
  }

  const popupAttempts = typeof clickResult.popupAttempts === "number" ? clickResult.popupAttempts : 0;
  const popupCollectionFailed = clickResult.popupCollectionFailed === true && safeCreated.length === 0;
  const popupUrls = Array.isArray(clickResult.popupUrls)
    ? clickResult.popupUrls.filter((url): url is string => typeof url === "string" && isSafeHttpUrl(url))
    : [];
  if (popupCollectionFailed) {
    return {
      ...clickResult,
      popupBlocked: true,
      popupReason: "The popup was blocked, but its destination could not be collected safely.",
    };
  }
  if (popupAttempts === 0 && safeCreated.length === 0) return result;
  if (popupUrls.length === 0 && safeCreated.length === 0) {
    return {
      ...clickResult,
      popupBlocked: true,
      popupReason: "The page tried to open a popup without a safe http or https URL.",
    };
  }

  if (task.authorizedTabId === undefined) throw new Error("This browser task has no working tab.");
  const previousTabId = task.authorizedTabId;
  const source = await chrome.tabs.get(previousTabId).catch(() => undefined);
  const opened = safeCreated[0] ?? await (async () => {
    const created = await chrome.tabs.create({
      url: popupUrls[0],
      active: false,
      ...(source?.windowId === undefined ? {} : { windowId: source.windowId }),
    });
    if (created.id === undefined) throw new Error("Chrome did not return the opened background tab.");
    return { id: created.id, url: created.url ?? popupUrls[0] };
  })();
  await refreshRememberedTaskOrigin(task, opened.id);
  task.updatedAt = Date.now();
  await saveTask(task);
  await setThreadWorkingTab(call.threadId, opened.id);
  await syncTaskIndicator(previousTabId);
  await syncTaskIndicator(opened.id);
  return {
    ...clickResult,
    popupBlocked: popupAttempts > 1 || safeCreated.length > 1,
    blockedPopupCount: Math.max(0, Math.max(popupAttempts, safeCreated.length) - 1),
    openedPopupUrl: opened.url,
    openedPopupTabId: opened.id,
    openedInBackground: true,
    selectedForTask: true,
  };
}

function actionResultFailed(result: unknown): boolean {
  return Boolean(result && typeof result === "object" && "actionError" in result);
}

async function handlePageCall(call: PageToolCall, announce: boolean): Promise<void> {
  parsePageToolArguments(call);
  const task = await activeTask(call);
  if (announce) await storeActivity(call, "requested");
  if (task.authorizedTabId === undefined) {
    if (task.workingTabClosed) throw workingTabRecoveryError(task);
    task.authorizedTabId = await ensureThreadWorkingTab(call.threadId);
    task.updatedAt = Date.now();
    await saveTask(task);
  }
  const workingTab = await chrome.tabs.get(task.authorizedTabId).catch(() => undefined);
  if (!workingTab) {
    await markWorkingTabClosed(task);
    throw workingTabRecoveryError(task);
  }
  if (workingTab.url && isSafeHttpUrl(workingTab.url)) task.recoveryUrl = workingTab.url;
  const controlOrigin = await currentControlOrigin(task.authorizedTabId);
  if (
    task.authorizedTabId !== controlOrigin.tabId ||
    task.authorizedOrigin !== controlOrigin.origin ||
    task.authorizedOriginPattern !== controlOrigin.originPattern
  ) {
    const remembered = await hasRememberedControlAccess(controlOrigin.originPattern);
    if (!remembered) throw new PageControlPermissionRequiredError(controlOrigin.origin, controlOrigin.originPattern);
    task.authorizedOrigin = controlOrigin.origin;
    task.authorizedOriginPattern = controlOrigin.originPattern;
    task.authorizedTabId = controlOrigin.tabId;
    task.workingTabClosed = false;
    task.updatedAt = Date.now();
    await saveTask(task);
  }
  task.browserActivityStarted = true;
  task.updatedAt = Date.now();
  await saveTask(task);
  await syncTaskIndicator(task.authorizedTabId);
  let target: PageTargetDescription | undefined;
  if (["click", "fill", "keypress", "submit"].includes(call.tool)) target = await describePageTarget(call, false, task.authorizedTabId);
  const permissionMode = await getTaskPermissionMode(task);
  const confirmationBypassed = permissionMode === "full" && decidePageAction(call, target, "ask").decision === "confirm";
  const policy = decidePageAction(call, target, permissionMode);
  if (policy.decision === "refuse") {
    await finishTool(call, false, { error: policy.reason }, "failed");
    return;
  }
  if (policy.decision === "confirm") {
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
    await activeTask(call);
    pendingApprovals.set(call.callId, { call, target });
    pendingPrompts.set(call.callId, { type: "approval", data: prompt });
    await persistPendingPrompt({ callId: call.callId, type: "approval", data: prompt, approval: { call, target } });
    if (task.autoReview?.enabled) {
      await reviewPageApproval(call, target, task, prompt);
    } else broadcast("tool.approval", prompt);
    return;
  }
  await recordAction(call);
  await storeActivity(call, "running", confirmationBypassed
    ? {
        permissionMode,
        confirmationBypassed: true,
        target: {
          label: target?.label ?? call.tool,
          url: target?.href ?? target?.form?.action,
          form: target?.form,
        },
      }
    : undefined);
  const result = await executePageCallForTask(call, task, target);
  if (call.tool === "inspect") await rememberThreadUrls(call.threadId, inspectedUrls(result));
  const actionFailed = actionResultFailed(result);
  await finishTool(call, !actionFailed, result, actionFailed ? "failed" : "succeeded");
}

function reviewActivity(model: string, status: ReviewActivity["status"], reason: string, source?: ReviewActivity["source"]): { review: ReviewActivity } {
  return { review: { model, status, reason, ...(source ? { source } : {}) } };
}

async function showReviewFallback(call: PageToolCall, prompt: Record<string, unknown>, reason: string): Promise<void> {
  if (!pendingApprovals.has(call.callId) || await getCompleted(call)) return;
  await activeTask(call);
  const pending = pendingApprovals.get(call.callId)!;
  delete pending.review;
  const data = { ...prompt, description: `${String(prompt.description)} ${reason}` };
  pendingPrompts.set(call.callId, { type: "approval", data });
  await persistPendingPrompt({ callId: call.callId, type: "approval", data, approval: pending });
  await storeActivity(call, "awaiting confirmation", reviewActivity((await getTask(call)).autoReview?.model ?? REVIEW_MODEL, "ask_user", reason));
  broadcast("tool.approval", data);
}

async function reviewPageApproval(call: PageToolCall, target: PageTargetDescription | undefined, task: BrowserTaskState, prompt: Record<string, unknown>): Promise<void> {
  const candidate = reviewCandidate(call, target, task.userInstruction, task.authorizedTabId!, task.authorizedOrigin!);
  if (!("evidence" in candidate)) return showReviewFallback(call, prompt, candidate.reason);
  if ((task.reviewCount ?? 0) >= (task.reviewLimit ?? 0)) return showReviewFallback(call, prompt, "The automatic-review budget was reached. Please review this action.");
  const id = crypto.randomUUID();
  liveReviews.set(call.callId, id);
  try {
    const review = { id, fingerprint: await reviewFingerprint(call, target!, candidate.evidence, task.autoReview), deadline: Date.now() + REVIEW_TIMEOUT_MS };
    if (liveReviews.get(call.callId) !== id || !pendingApprovals.has(call.callId)) return;
    await activeTask(call);
    const pending: PendingApproval = { call, target, review };
    pendingApprovals.set(call.callId, pending);
    pendingPrompts.delete(call.callId);
    await persistPendingPrompt({ callId: call.callId, type: "approval", data: prompt, approval: pending });
    task.reviewCount = (task.reviewCount ?? 0) + 1;
    await saveTask(task);
    await activeTask(call);
    if (liveReviews.get(call.callId) !== id || !pendingApprovals.has(call.callId)) return;
    await storeActivity(call, "reviewing", reviewActivity(task.autoReview!.model, "reviewing", "Reviewing the proposed action."));
    const raw = await requestNative("approval.reviewConfigured", { configurationVersion: 2, systemPrompt: task.autoReview!.systemPrompt, reviewId: id, parentThreadId: call.threadId, parentTurnId: call.turnId, parentCallId: call.callId, model: task.autoReview!.model, deadline: review.deadline, evidence: candidate.evidence }, REVIEW_TIMEOUT_MS + 1500);
    if (liveReviews.get(call.callId) !== id || !pendingApprovals.has(call.callId) || await getCompleted(call)) return;
    await activeTask(call);
    const result = reviewVerdictSchema.safeParse(raw);
    if (Date.now() <= review.deadline && result.success && verdictApproves(result.data, candidate.evidence.category)) {
      await decideTool(call.callId, true, id);
    } else {
      const reason = result.success && result.data.reasonCode === "timeout" ? "Automatic review timed out. Please review this action." : "Automatic review could not verify a low-risk action that matches your request. Please review it.";
      await showReviewFallback(call, prompt, reason);
    }
  } catch {
    // Model availability, validation and transport failures never authorize an action.
    await showReviewFallback(call, prompt, "Automatic review is unavailable. Please review this action.").catch(() => undefined);
  } finally {
    if (liveReviews.get(call.callId) === id) liveReviews.delete(call.callId);
    void requestNative("approval.cancel", { threadId: call.threadId, turnId: call.turnId }).catch(() => undefined);
  }
}

async function handleDynamicToolCall(input: unknown): Promise<void> {
  const call = parseBrowserToolCall(input);
  if (!call) {
    broadcast("tool.status", { status: "failed", error: "Rejected malformed browser tool request." });
    return;
  }
  const observedKey = taskKey(call);
  if (!observedTasks.has(observedKey)) {
    observedTasks.add(observedKey);
    setTimeout(() => observedTasks.delete(observedKey), TASK_TOMBSTONE_TTL_MS);
  }
  if (retiredTasks.has(taskKey(call))) return;
  let key: string;
  try { key = toolKey(call); } catch {
    await respondToTool(call, false, { error: "The page tool arguments were rejected by policy." }).catch(() => undefined);
    await storeActivity(call, "failed", { error: "The page tool arguments were rejected by policy." });
    return;
  }
  const inProgress = processingCalls.get(key);
  if (inProgress) {
    if (inProgress.requestId !== call.requestId) await respondToTool(call, false, { error: "This action is already in progress. Do not repeat it." });
    return;
  }
  processingCalls.set(key, call);
  try {
    const completed = await getCompleted(call);
    if (completed) {
      await respondToTool(call, completed.success, completed.result);
      return;
    }
    const pending = (await storedList<StoredPendingPrompt>(PENDING_PROMPTS_KEY)).find((item) => {
      const saved = item.approval?.call ?? item.permission?.call;
      return saved && toolKey(saved) === key;
    });
    if (pending) {
      if (pending.callId !== call.callId) await respondToTool(call, false, { error: "This action is already awaiting approval. Do not repeat it." });
      return;
    }
    if ((await storedList<ExecutionMarker>(EXECUTIONS_KEY)).some((marker) => marker.key === key)) {
      await finishTool(call, false, { error: "The previous action outcome is uncertain. Inspect the page before repeating it." }, "failed");
      return;
    }
    if (await recordingBlocksBrowserWork()) {
      await finishTool(call, false, { error: "Skill recording is open. Finish or cancel it before browser actions." }, "failed");
      return;
    }
    if (call.namespace === "tabs") await handleTabCall(call, true);
    else await handlePageCall(call, true);
  } catch (error) {
    if (error instanceof PageControlPermissionRequiredError && call.namespace === "page") {
      const permissionTask = await activeTask(call).catch(async (cause) => {
        const message = cause instanceof Error ? cause.message : "This browser task is no longer active.";
        await finishTool(call, false, { error: message }, "canceled").catch(() => undefined);
        return undefined;
      });
      if (!permissionTask) return;
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
    let message = error instanceof Error ? error.message : "Browser action failed.";
    let recoveryTask: BrowserTaskState | undefined;
    if (call.namespace === "page") {
      const failedTask = await getTask(call).catch(() => undefined);
      if (failedTask?.workingTabClosed) {
        recoveryTask = failedTask;
        message = workingTabRecoveryError(failedTask).message;
      }
    }
    if (error instanceof z.ZodError && call.namespace === "page") {
      await respondToTool(call, false, { error: "The page tool arguments were rejected by policy." }).catch(() => undefined);
      await storeActivity(call, "failed", { error: "The page tool arguments were rejected by policy." });
      return;
    }
    const result = recoveryTask
      ? { error: message, recoverable: true, recoveryAction: "open-or-activate-tab" }
      : { error: message };
    await finishTool(call, false, result, /stale|expired|changed|closed/i.test(message) ? "stale" : "failed").catch(() => undefined);
  } finally {
    processingCalls.delete(key);
  }
}

async function decideTool(callId: string, approved: boolean, reviewerId?: string): Promise<unknown> {
  if (decidingCalls.has(callId)) throw new Error("This action is already being handled.");
  decidingCalls.add(callId);
  let pending: PendingApproval | undefined;
  try {
    const stored = (await storedList<StoredPendingPrompt>(PENDING_PROMPTS_KEY)).find((item) => item.callId === callId);
    pending = pendingApprovals.get(callId) ?? stored?.approval;
    if (!pending || await getCompleted(pending.call)) throw new Error("This browser-action request is no longer pending.");
    if (!reviewerId && liveReviews.has(callId)) throw new Error("This action is still being reviewed.");
    const { call } = pending;
    await activeTask(call);
    if (reviewerId && (liveReviews.get(callId) !== reviewerId || pending.review?.id !== reviewerId || Date.now() > pending.review.deadline)) throw new Error("This automatic review expired.");
    if (!approved) {
      pendingApprovals.delete(callId);
      await finishTool(call, false, { error: "The user rejected this browser action." }, "rejected");
      return { rejected: true };
    }
    if (call.namespace === "page" && pending.target) {
      const task = await activeTask(call);
      if (task.authorizedTabId === undefined) throw new Error("The task no longer has a working tab.");
      const origin = await currentControlOrigin(task.authorizedTabId);
      if (origin.tabId !== task.authorizedTabId || origin.origin !== task.authorizedOrigin || !(await hasRememberedControlAccess(origin.originPattern))) throw new Error("The page or its permission changed. Inspect it again before approving.");
      const currentTarget = await describePageTarget(call, true, task.authorizedTabId);
      if (reviewedTarget(pending.target) !== reviewedTarget(currentTarget)) throw new Error("The page or reviewed form changed. Inspect it again before approving.");
      const recheck = decidePageAction(call, currentTarget, await getTaskPermissionMode(task));
      if (recheck.decision === "refuse") throw new Error(recheck.reason);
      if (reviewerId) {
        const candidate = reviewCandidate(call, currentTarget, task.userInstruction, origin.tabId, origin.origin);
        if (!("evidence" in candidate) || await reviewFingerprint(call, currentTarget, candidate.evidence, task.autoReview) !== pending.review!.fingerprint || Date.now() > pending.review!.deadline) throw new Error("The automatic-review evidence changed or expired. Inspect again.");
      }
    }
    await recordAction(call);
    const task = await activeTask(call);
    if (reviewerId && (liveReviews.get(callId) !== reviewerId || Date.now() > pending.review!.deadline)) throw new Error("The automatic review was canceled or expired.");
    pendingApprovals.delete(callId);
    pendingPrompts.delete(callId);
    await removePendingPrompt(callId);
    const metadata = task.autoReview?.enabled ? reviewActivity(task.autoReview.model, "approved", reviewerId ? "Approved a verified low-risk action." : "Approved by you.", reviewerId ? "reviewer" : "user") : undefined;
    await storeActivity(call, "running", metadata);
    await activeTask(call);
    const result = call.namespace === "tabs" ? await executeTabToolForThread(call) : await executePageCallForTask(call, task, pending.target, true);
    const actionFailed = actionResultFailed(result);
    await finishTool(call, !actionFailed, result, actionFailed ? "failed" : "succeeded");
    return result;
  } catch (error) {
    if (pending && (!liveReviews.has(callId) || reviewerId)) {
      pendingApprovals.delete(callId);
      if (!(await getCompleted(pending.call))) {
        const message = error instanceof Error ? error.message : "Browser action failed.";
        await finishTool(pending.call, false, { error: message }, /stale|expired|changed/i.test(message) ? "stale" : "failed");
      }
    }
    throw error;
  } finally { decidingCalls.delete(callId); }
}

async function continueAfterPermission(callId: string, originPattern: string, granted: boolean): Promise<unknown> {
  const stored = (await storedList<StoredPendingPrompt>(PENDING_PROMPTS_KEY)).find((item) => item.callId === callId);
  const pending = pendingPermissions.get(callId) ?? stored?.permission;
  if (!pending) throw new Error("This browser permission request is no longer pending.");
  const { call, tabId, originPattern: expectedOriginPattern } = pending;
  pendingPermissions.delete(callId);
  pendingPrompts.delete(callId);
  await removePendingPrompt(callId);
  try {
    const expected = await currentControlOrigin(tabId);
    if (expected.originPattern !== originPattern || expectedOriginPattern !== originPattern) {
      throw new Error("The task's working page changed before permission was granted.");
    }
    if (!granted) {
      await finishTool(call, false, { error: "The user denied site access." }, "rejected");
      return { rejected: true };
    }
    const allowed = await chrome.permissions.contains({ origins: [originPattern] });
    if (!allowed) throw new Error("Chrome did not grant the requested site access.");
    const task = await activeTask(call);
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "The browser permission could not be resumed.";
    await finishTool(call, false, { error: message }, /changed|closed|available/i.test(message) ? "stale" : "failed").catch(() => undefined);
    throw error;
  }
}

async function finishBrowserTurn(turnId: string): Promise<void> {
  finishedTurns.add(turnId);
  setTimeout(() => finishedTurns.delete(turnId), TASK_TOMBSTONE_TTL_MS);
  for (const pending of pendingApprovals.values()) {
    if (pending.call.turnId === turnId) {
      liveReviews.delete(pending.call.callId);
      void requestNative("approval.cancel", { threadId: pending.call.threadId, turnId }).catch(() => undefined);
    }
  }
  const now = Date.now();
  const storedTasks = await storedList<BrowserTaskState>(TASK_KEY);
  const tasks = storedTasks
    .filter((task) => now - task.updatedAt < TASK_TOMBSTONE_TTL_MS);
  const completedTask = storedTasks.find((task) => task.turnId === turnId);
  const affectedTabIds = new Set(
    storedTasks
      .filter((task) => task.turnId === turnId && task.authorizedTabId !== undefined)
      .map((task) => task.authorizedTabId as number),
  );
  for (const task of tasks) {
    if (task.turnId === turnId) {
      task.finished = true;
      delete task.userInstruction;
      task.updatedAt = now;
    }
  }
  await chrome.storage.session.set({ [TASK_KEY]: tasks.slice(-40) });
  for (const prompt of await storedList<StoredPendingPrompt>(PENDING_PROMPTS_KEY)) {
    const call = prompt.approval?.call ?? prompt.permission?.call;
    if (call?.turnId === turnId) {
      pendingApprovals.delete(call.callId);
      pendingPermissions.delete(call.callId);
      await finishTool(call, false, { error: "This browser turn already finished." }, "canceled").catch(() => undefined);
    }
  }
  await Promise.all([...affectedTabIds].map((tabId) => syncTaskIndicator(tabId)));
  if (completedTask && (completedTask.successfulActionCount ?? 0) > 0 && !completedTask.canceled) {
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
  const markCanceled = (key: string) => {
    canceledTasks.add(key);
    setTimeout(() => canceledTasks.delete(key), TASK_TOMBSTONE_TTL_MS);
  };
  if (turnId) markCanceled(`${threadId}:${turnId}`);
  for (const pending of pendingApprovals.values()) if (pending.call.threadId === threadId && (!turnId || pending.call.turnId === turnId)) liveReviews.delete(pending.call.callId);
  void requestNative("approval.cancel", { threadId, turnId }).catch(() => undefined);
  const tasks = await storedList<BrowserTaskState>(TASK_KEY);
  let matched = false;
  const affectedTabIds = new Set<number>();
  for (const task of tasks) {
    if (task.threadId === threadId && (!turnId || task.turnId === turnId)) {
      matched = true;
      markCanceled(task.key);
      if (task.authorizedTabId !== undefined) affectedTabIds.add(task.authorizedTabId);
      task.canceled = true;
      delete task.userInstruction;
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
  await Promise.all([...affectedTabIds].map((tabId) => syncTaskIndicator(tabId)));
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
      for (const prompt of storedPrompts) {
        const savedCall = prompt.approval?.call ?? prompt.permission?.call;
        if (savedCall && !(await activeTask(savedCall).catch(() => undefined))) {
          promptByCall.delete(prompt.callId);
          pendingApprovals.delete(prompt.callId);
          pendingPermissions.delete(prompt.callId);
          pendingPrompts.delete(prompt.callId);
          await removePendingPrompt(prompt.callId);
          continue;
        }
        if (liveReviews.has(prompt.callId)) { promptByCall.delete(prompt.callId); continue; }
        if (prompt.approval?.review) {
          if (await getCompleted(prompt.approval.call)) { promptByCall.delete(prompt.callId); continue; }
          if ((await storedList<ExecutionMarker>(EXECUTIONS_KEY)).some((marker) => marker.key === toolKey(prompt.approval!.call))) {
            promptByCall.delete(prompt.callId);
            await finishTool(prompt.approval.call, false, { error: "The previous action outcome is uncertain. Inspect the page before repeating it." }, "failed");
          } else {
            delete prompt.approval.review;
            prompt.data = { ...prompt.data, description: `${String(prompt.data.description)} Automatic review was interrupted. Please review this action.` };
            await persistPendingPrompt(prompt);
            promptByCall.set(prompt.callId, { type: prompt.type, data: prompt.data });
            await storeActivity(prompt.approval.call, "awaiting confirmation", reviewActivity((await getTask(prompt.approval.call)).autoReview?.model ?? REVIEW_MODEL, "ask_user", "Automatic review was interrupted. Please review this action."));
          }
        }
      }
      const storedNotice = (await chrome.storage.session.get(COMPLETION_NOTICE_KEY))[COMPLETION_NOTICE_KEY];
      const completionNotice = freshCompletionNotice(storedNotice);
      if (storedNotice && !completionNotice) await chrome.storage.session.remove(COMPLETION_NOTICE_KEY);
      return {
        activities: await storedList<Record<string, unknown>>(ACTIVITY_KEY),
        prompts: [...promptByCall.values()],
        completionNotice,
      };
    }
    case "COMPLETION_NOTICE_DISMISS":
      await chrome.storage.session.remove(COMPLETION_NOTICE_KEY);
      return { dismissed: true };
    case "ACCOUNT_READ": return accountResponseSchema.parse(await requestNative("account.read"));
    case "AUTH_LOGIN": return loginResponseSchema.parse(await requestNative("auth.login"));
    case "AUTH_CANCEL": return requestNative("auth.cancel", { loginId: request.loginId });
    case "AUTH_LOGOUT":
    case "DELETE_ALL_LOCAL_DATA":
      lifecycleEpoch++;
      for (const key of observedTasks) {
        retiredTasks.add(key);
        setTimeout(() => { retiredTasks.delete(key); observedTasks.delete(key); }, TASK_TOMBSTONE_TTL_MS);
      }
      for (const prompt of pendingApprovals.values()) liveReviews.delete(prompt.call.callId);
      for (const task of await storedList<BrowserTaskState>(TASK_KEY)) {
        retiredTasks.add(task.key);
        setTimeout(() => retiredTasks.delete(task.key), TASK_TOMBSTONE_TTL_MS);
        if (!task.finished && !task.canceled) {
          await cancelBrowserTask(task.threadId, task.turnId);
          void requestNative("chat.interrupt", { threadId: task.threadId, turnId: task.turnId }).catch(() => undefined);
        }
      }
      pendingApprovals.clear();
      pendingPermissions.clear();
      pendingPrompts.clear();
      return requestNative(request.type === "AUTH_LOGOUT" ? "auth.logout" : "data.deleteAll");
    case "AUTO_REVIEW_READ": return reviewCapabilitiesSchema.parse(await requestNative("approval.capabilities"));
    case "MODELS_READ": return modelsResponseSchema.parse(await requestNative("models.list"));
    case "ATTACHMENTS_REQUEST": return requestNative("attachments.request", request.request, NATIVE_TIMEOUT_MS);
    case "SKILLS_LIST": return skillsListResponseSchema.parse(await requestNative("skills.list"));
    case "SKILLS_SET_ENABLED": return skillEnabledResponseSchema.parse(await requestNative("skills.setEnabled", { name: request.name, enabled: request.enabled }));
    case "SKILLS_DELETE": return skillDeletedResponseSchema.parse(await requestNative("skills.delete", { name: request.name }));
    case "RECORDING_READ": return readSkillRecording();
    case "RECORDING_START": return startSkillRecording(request.description);
    case "RECORDING_STOP": return stopSkillRecording();
    case "RECORDING_CANCEL": return cancelSkillRecording();
    case "RECORDING_GRANT": return grantSkillRecording(request.originPattern, request.granted);
    case "RECORDING_UPDATE": return updateSkillRecording(request);
    case "RECORDING_SAVE": {
      const saved = await saveSkillRecording(async (markdown) => skillSavedResponseSchema.parse(await requestNative("skills.save", { markdown })));
      broadcast("skills.changed");
      return saved;
    }
    case "CONVERSATION_SAVE": return saveConversationSnapshot(request.snapshot);
    case "CONVERSATION_CLEAR": return clearConversationStore();
    case "CHAT_START": return threadResponseSchema.parse(await requestNative("chat.start", { model: request.model }));
    case "CHAT_RESUME": return threadResponseSchema.parse(await requestNative("chat.resume", { threadId: request.threadId, model: request.model }));
    case "CHAT_FORK": {
      const result = threadIdResponseSchema.parse(await requestNative("chat.fork", {
        threadId: request.threadId,
        lastTurnId: request.lastTurnId,
      }));
      await copyThreadWorkingTab(request.threadId, result.threadId);
      await copyThreadKnownUrls(request.threadId, result.threadId);
      return result;
    }
    case "CHAT_SEND": {
      if (await recordingBlocksBrowserWork()) throw new Error("Finish or cancel skill recording before sending a message.");
      const epoch = lifecycleEpoch;
      const tabId = await ensureThreadWorkingTab(request.threadId);
      await rememberThreadUrls(request.threadId, urlsInText(request.text));
      const intents = (await storedList<ReviewIntent>(REVIEW_INTENTS_KEY)).filter((item) => item.threadId !== request.threadId && Date.now() - item.createdAt < 60_000);
      await chrome.storage.session.set({ [REVIEW_INTENTS_KEY]: [...intents, { threadId: request.threadId, text: request.text.length <= 4000 ? request.text : undefined, createdAt: Date.now() }].slice(-20) });
      const raw = await requestNative("chat.send", { threadId: request.threadId, userText: request.text, pageContext: request.pageContext, attachments: request.attachments, owner: request.owner, clientMessageId: request.clientMessageId, model: request.model });
      const result = turnResponseSchema.extend({ replayed: z.boolean().optional(), attachments: z.array(attachmentSummarySchema).max(5).optional() }).parse(raw);
      if (epoch !== lifecycleEpoch) throw new Error("This browser session was cleared before the message was accepted.");
      if (!result.replayed) await initializeBrowserTask(request.threadId, result.turnId, tabId);
      await chrome.storage.session.set({ [REVIEW_INTENTS_KEY]: (await storedList<ReviewIntent>(REVIEW_INTENTS_KEY)).filter((item) => item.threadId !== request.threadId) });
      return result;
    }
    case "CHAT_CANCEL_SEND": return requestNative("chat.cancelSend", { threadId: request.threadId, clientMessageId: request.clientMessageId });
    case "CHAT_INTERRUPT":
      await cancelBrowserTask(request.threadId, request.turnId);
      return requestNative("chat.interrupt", { threadId: request.threadId, turnId: request.turnId });
    case "BROWSER_TASK_CANCEL": return cancelBrowserTask(request.threadId, request.turnId);
    case "WORKING_TAB_FOCUS": return focusThreadWorkingTab(request.threadId);
    case "PAGE_ATTACH": return captureCurrentPage();
    case "PAGE_CONTROL_PERMISSION_RESULT": return continueAfterPermission(request.callId, request.originPattern, request.granted);
    case "OPEN_EXTERNAL":
      if (!isSafeHttpUrl(request.url)) throw new Error("Only http/https links can be opened.");
      return chrome.tabs.create({ url: request.url, active: true });
    case "TOOL_DECISION": return decideTool(request.callId, request.approved);
  }
}

function isTrustedUiSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.tab === undefined;
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if ((message as Partial<SidebarEvent>)?.source === "codex-sidebar-background") return false;
  if (!isTrustedUiSender(sender)) {
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
  void handleRemovedWorkingTab(tabId);
});
chrome.runtime.onConnect?.addListener?.((port) => {
  acceptRecorderPort(port);
});
chrome.tabs.onActivated?.addListener?.((info) => {
  followRecordingActivation(info.tabId);
});
chrome.tabs.onUpdated?.addListener?.((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") noteRecordingNavigation(tabId, changeInfo.url ?? tab.url);
});

async function handleRemovedWorkingTab(tabId: number): Promise<void> {
  await forgetRecordingTab(tabId).catch(() => undefined);
  const targets = await storedList<ThreadWorkingTab>(THREAD_TARGETS_KEY);
  await chrome.storage.session.set({
    [THREAD_TARGETS_KEY]: targets.filter((target) => target.tabId !== tabId),
  });
  const tasks = await storedList<BrowserTaskState>(TASK_KEY);
  const affectedTasks = new Map<string, BrowserTaskState>();
  for (const task of tasks) {
    if (task.authorizedTabId === tabId && !task.finished && !task.canceled) {
      task.authorizedTabId = undefined;
      task.authorizedOrigin = undefined;
      task.authorizedOriginPattern = undefined;
      task.workingTabClosed = true;
      task.updatedAt = Date.now();
      affectedTasks.set(task.key, task);
    }
  }
  await chrome.storage.session.set({ [TASK_KEY]: tasks });

  if (affectedTasks.size === 0) return;
  const storedPrompts = await storedList<StoredPendingPrompt>(PENDING_PROMPTS_KEY);
  const pendingCalls = new Map<string, BrowserToolCall>();
  for (const pending of pendingApprovals.values()) pendingCalls.set(pending.call.callId, pending.call);
  for (const pending of pendingPermissions.values()) pendingCalls.set(pending.call.callId, pending.call);
  for (const prompt of storedPrompts) {
    const call = prompt.approval?.call ?? prompt.permission?.call;
    if (call) pendingCalls.set(call.callId, call);
  }
  const failedCallIds = new Set<string>();
  for (const call of pendingCalls.values()) {
    const task = affectedTasks.get(taskKey(call));
    if (!task) continue;
    failedCallIds.add(call.callId);
    pendingApprovals.delete(call.callId);
    pendingPermissions.delete(call.callId);
    pendingPrompts.delete(call.callId);
    await finishTool(
      call,
      false,
      { error: workingTabRecoveryError(task).message, recoverable: true, recoveryAction: "open-or-activate-tab" },
      "stale",
    ).catch(() => undefined);
  }
  if (failedCallIds.size > 0) {
    await chrome.storage.session.set({
      [PENDING_PROMPTS_KEY]: storedPrompts.filter((prompt) => !failedCallIds.has(prompt.callId)),
    });
  }
}

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

export const serviceWorkerTestHooks = {
  routeRequest,
  handleDynamicToolCall,
  finishBrowserTurn,
  getTask,
  getThreadWorkingTab,
  handleRemovedWorkingTab,
  processCapturedPopup,
  actionResultFailed,
  isTrustedUiSender,
};
