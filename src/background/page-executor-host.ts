import {
  checkArgumentsSchema,
  clickArgumentsSchema,
  dragArgumentsSchema,
  elementRefSchema,
  fillArgumentsSchema,
  historyArgumentsSchema,
  inspectArgumentsSchema,
  keypressArgumentsSchema,
  originPatternForUrl,
  scrollArgumentsSchema,
  selectArgumentsSchema,
  submitArgumentsSchema,
  waitArgumentsSchema,
  type ElementRef,
  type PageToolCall,
} from "../shared/page-tools";
import { isSafeHttpUrl } from "../shared/protocol";
import type { PageTargetDescription } from "./page-policy";

export class PageControlPermissionRequiredError extends Error {
  readonly originPattern: string;
  readonly origin: string;

  constructor(origin: string, originPattern: string) {
    super(`Allow browser actions on ${origin} to continue.`);
    this.name = "PageControlPermissionRequiredError";
    this.origin = origin;
    this.originPattern = originPattern;
  }
}

interface PageTarget {
  tabId: number;
  origin: string;
  originPattern: string;
  title: string;
  url: string;
}

interface ExecutorResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface RawInspection {
  title: string;
  url: string;
  origin: string;
  snapshotId: string;
  expiresAt: number;
  truncated: boolean;
  unsupportedFrames: number;
  elements: Array<Record<string, unknown> & { refId: string }>;
}

interface PopupGuardReport {
  attempted: number;
  urls: string[];
  collectionFailed?: boolean;
}

const POPUP_QUIET_WINDOW_MS = 350;
const POPUP_AFTER_ATTEMPT_MS = 50;
const POPUP_MAX_WINDOW_MS = 1_000;
const POPUP_RESTORE_MARGIN_MS = 1_000;
const POPUP_READY_TIMEOUT_MS = 1_000;
const POPUP_READY_POLL_MS = 20;
const POPUP_REPORT_TIMEOUT_MS = POPUP_MAX_WINDOW_MS + POPUP_RESTORE_MARGIN_MS + 500;
const popupClickLocks = new Map<number, Promise<unknown>>();

// Injected into the page's MAIN world, so it must stay self-contained. The
// attempt list lives only in this closure; nothing callable is attached to
// window.open, and the page can at most forge the returned report.
export function runPopupGuardInPage(
  guardId: string,
  quietMs: number,
  afterAttemptMs: number,
  maxMs: number,
  restoreAfterMs: number,
): Promise<{ attempted: number; urls: string[] }> | null {
  const readyAttribute = "data-codex-popup-guard";
  const originalKey = "__codexSidebarPopupGuardOriginalOpen";
  const clickEvent = `codex-popup-guard-clicked-${guardId}`;
  const root = document.documentElement;
  const currentOpen = window.open as typeof window.open & Record<string, unknown>;
  const wrappedOpen = currentOpen[originalKey];
  const originalOpen = typeof wrappedOpen === "function" ? (wrappedOpen as typeof window.open) : currentOpen;
  const attempts: Array<string | null> = [];
  let onAttempt = (): void => undefined;
  const guardedOpen = (url?: string | URL): WindowProxy | null => {
    let safeUrl: string | null = null;
    const rawUrl = url === undefined ? "" : String(url).trim();
    if (rawUrl) {
      try {
        const resolved = new URL(rawUrl, location.href);
        if (resolved.protocol === "http:" || resolved.protocol === "https:") safeUrl = resolved.href;
      } catch {
        safeUrl = null;
      }
    }
    attempts.push(safeUrl);
    onAttempt();
    return null;
  };
  Object.defineProperty(guardedOpen, originalKey, { value: originalOpen });
  try {
    window.open = guardedOpen as typeof window.open;
  } catch {
    return null;
  }
  if (window.open !== guardedOpen) return null;
  root.setAttribute(readyAttribute, guardId);

  const restore = (): void => {
    if (window.open === guardedOpen) window.open = originalOpen;
    if (root.getAttribute(readyAttribute) === guardId) root.removeAttribute(readyAttribute);
  };
  window.setTimeout(restore, restoreAfterMs);
  return new Promise((resolve) => {
    let quietTimeoutId: number | undefined;
    let maxTimeoutId: number | undefined;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(quietTimeoutId);
      window.clearTimeout(maxTimeoutId);
      window.clearTimeout(failsafeTimeoutId);
      root.removeEventListener(clickEvent, onClicked);
      onAttempt = () => undefined;
      resolve({
        attempted: attempts.length,
        urls: attempts.filter((url): url is string => url !== null),
      });
    };
    const onClicked = (): void => {
      root.removeEventListener(clickEvent, onClicked);
      maxTimeoutId = window.setTimeout(finish, maxMs);
      quietTimeoutId = window.setTimeout(finish, attempts.length > 0 ? afterAttemptMs : quietMs);
      onAttempt = () => {
        window.clearTimeout(quietTimeoutId);
        quietTimeoutId = window.setTimeout(finish, afterAttemptMs);
      };
    };
    root.addEventListener(clickEvent, onClicked);
    const failsafeTimeoutId = window.setTimeout(finish, restoreAfterMs);
  });
}

function startPopupGuard(tabId: number, guardId: string): Promise<unknown> {
  return chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: runPopupGuardInPage,
    args: [guardId, POPUP_QUIET_WINDOW_MS, POPUP_AFTER_ATTEMPT_MS, POPUP_MAX_WINDOW_MS, POPUP_MAX_WINDOW_MS + POPUP_RESTORE_MARGIN_MS],
  }).then((results) => results[0]?.result, () => undefined);
}

async function waitForPopupGuardReady(tabId: number, guardId: string, guard: Promise<unknown>): Promise<boolean> {
  let guardSettled = false;
  void guard.then(() => {
    guardSettled = true;
  });
  const deadline = Date.now() + POPUP_READY_TIMEOUT_MS;
  while (!guardSettled) {
    const ready = await sendExecutor<{ ready?: unknown }>(tabId, { action: "POPUP_GUARD_READY", guardId })
      .then((result) => result?.ready === true, () => false);
    if (ready) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, POPUP_READY_POLL_MS));
  }
  return false;
}

function popupReportFrom(value: unknown): PopupGuardReport {
  // A navigation that replaces the document resolves or rejects the injection
  // without a report; that is an ordinary click, not a blocked popup.
  if (value === undefined || value === null) return { attempted: 0, urls: [] };
  const failed = { attempted: 0, urls: [], collectionFailed: true };
  if (typeof value !== "object") return failed;
  const { attempted, urls } = value as { attempted?: unknown; urls?: unknown };
  if (typeof attempted !== "number" || !Number.isSafeInteger(attempted) || attempted < 0) return failed;
  if (!Array.isArray(urls) || urls.length > attempted) return failed;
  const safeUrl = urls.find((url): url is string => typeof url === "string" && isSafeHttpUrl(url));
  return { attempted, urls: safeUrl ? [safeUrl] : [] };
}

async function collectPopupReport(guard: Promise<unknown>): Promise<PopupGuardReport> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timedOut = Symbol("timed out");
  const outcome = await Promise.race([
    guard,
    new Promise<typeof timedOut>((resolve) => {
      timeoutId = setTimeout(() => resolve(timedOut), POPUP_REPORT_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timeoutId);
  if (outcome === timedOut) return { attempted: 0, urls: [], collectionFailed: true };
  return popupReportFrom(outcome);
}

async function withPopupClickLock<T>(tabId: number, run: () => Promise<T>): Promise<T> {
  const previous = popupClickLocks.get(tabId) ?? Promise.resolve();
  const current = previous.then(run);
  const tail = current.catch(() => undefined);
  popupClickLocks.set(tabId, tail);
  try {
    return await current;
  } finally {
    if (popupClickLocks.get(tabId) === tail) popupClickLocks.delete(tabId);
  }
}

async function clickWithPopupGuard(ref: ElementRef, taskTabId?: number): Promise<Record<string, unknown>> {
  if (taskTabId !== undefined && ref.tabId !== taskTabId) {
    throw new Error("The page element does not belong to this task's working tab. Inspect the working tab again.");
  }
  const target = await authorizedTarget(ref.tabId);
  assertRefTarget(ref, target);
  await ensureExecutor(target);
  const existingTabIds = new Set(
    (await chrome.tabs.query({})).flatMap((tab) => (tab.id === undefined ? [] : [tab.id])),
  );
  const guardId = crypto.randomUUID();
  const guard = startPopupGuard(target.tabId, guardId);
  if (!(await waitForPopupGuardReady(target.tabId, guardId, guard))) {
    throw new Error("Browser Control could not prepare this click safely. Inspect the page and try again.");
  }
  let result: Record<string, unknown> = {};
  let clickError: unknown;
  try {
    result = await sendExecutor<Record<string, unknown>>(target.tabId, {
      action: "CLICK",
      snapshotId: ref.snapshotId,
      refId: ref.id,
      popupGuardId: guardId,
    });
  } catch (error) {
    clickError = error;
  }
  const popup = await collectPopupReport(guard);
  if (clickError) throw clickError;
  const createdTabs = (await chrome.tabs.query({})).flatMap((tab) => {
    if (tab.id === undefined || existingTabIds.has(tab.id) || tab.openerTabId !== target.tabId) return [];
    return [{ id: tab.id, url: tab.pendingUrl || tab.url || "", title: tab.title ?? "", active: tab.active === true }];
  });
  const tab = await chrome.tabs.get(target.tabId).catch(() => undefined);
  return {
    ...result,
    url: tab?.url ?? "",
    title: tab?.title ?? "",
    status: tab?.status ?? "unavailable",
    tabUnavailable: tab === undefined,
    popupAttempts: Math.max(popup.attempted, createdTabs.length),
    popupUrls: popup.urls,
    createdTabs,
    popupBlocked: popup.collectionFailed === true || popup.attempted > popup.urls.length,
    popupCollectionFailed: popup.collectionFailed === true,
  };
}

async function activeTarget(tabId?: number): Promise<PageTarget> {
  if (tabId === undefined) throw new Error("This browser task has no working tab.");
  let tab = await chrome.tabs.get(tabId);
  if (!tab?.id) throw new Error("The task's working tab is no longer available.");
  const resolvedTabId = tab.id;
  if (tab.discarded) {
    await chrome.tabs.reload(resolvedTabId);
    tab = await chrome.tabs.get(resolvedTabId);
  }
  const started = Date.now();
  while (!tab.url && Date.now() - started < 2_000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    tab = await chrome.tabs.get(resolvedTabId);
  }
  if (!tab.url) throw new Error("The task's working tab is still loading. Try again shortly.");
  const url = new URL(tab.url);
  const originPattern = originPatternForUrl(url.href);
  return { tabId: resolvedTabId, origin: url.origin, originPattern, title: tab.title ?? "Untitled tab", url: url.href };
}

async function authorizedTarget(tabId?: number): Promise<PageTarget> {
  const target = await activeTarget(tabId);
  const allowed = await chrome.permissions.contains({ origins: [target.originPattern] });
  if (!allowed) throw new PageControlPermissionRequiredError(target.origin, target.originPattern);
  return target;
}

async function sendExecutor<T>(tabId: number, command: Record<string, unknown>): Promise<T> {
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: "CODEX_PAGE_EXECUTOR",
    ...command,
  })) as ExecutorResponse<T>;
  if (!response?.ok) throw new Error(response?.error ?? "The page executor did not respond.");
  return response.data as T;
}

async function ensureExecutor(target: PageTarget): Promise<void> {
  try {
    const ping = await sendExecutor<{ origin: string }>(target.tabId, { action: "PING" });
    if (ping.origin !== target.origin) throw new Error("The page origin changed.");
    return;
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: target.tabId }, files: ["page-executor.js"] });
    const ping = await sendExecutor<{ origin: string }>(target.tabId, { action: "PING" });
    if (ping.origin !== target.origin) throw new Error("The page origin changed while browser control was starting.");
  }
}

export async function setPageTaskIndicator(tabId: number, active: boolean): Promise<boolean> {
  if (active) {
    try {
      const target = await authorizedTarget(tabId);
      await ensureExecutor(target);
    } catch {
      await sendExecutor(tabId, { action: "TASK_INDICATOR", active: false }).catch(() => undefined);
      return false;
    }
  }
  try {
    const result = await sendExecutor<{ active: boolean }>(tabId, { action: "TASK_INDICATOR", active });
    return result.active === active;
  } catch {
    return false;
  }
}

function assertRefTarget(ref: ElementRef, target: PageTarget): void {
  if (ref.tabId !== target.tabId || ref.origin !== target.origin) {
    throw new Error("The page element belongs to a different tab or origin. Inspect the task's working tab again.");
  }
}

async function withRef<T>(ref: ElementRef, action: string, params?: Record<string, unknown>, taskTabId?: number): Promise<T> {
  if (taskTabId !== undefined && ref.tabId !== taskTabId) {
    throw new Error("The page element does not belong to this task's working tab. Inspect the working tab again.");
  }
  const target = await authorizedTarget(ref.tabId);
  assertRefTarget(ref, target);
  await ensureExecutor(target);
  return sendExecutor<T>(target.tabId, {
    action,
    snapshotId: ref.snapshotId,
    refId: ref.id,
    ...params,
  });
}

export async function inspectActivePage(call: PageToolCall, tabId?: number): Promise<unknown> {
  inspectArgumentsSchema.parse(call.arguments);
  const target = await authorizedTarget(tabId);
  await ensureExecutor(target);
  const inspection = await sendExecutor<RawInspection>(target.tabId, { action: "INSPECT" });
  if (inspection.origin !== target.origin) throw new Error("The page origin changed during inspection.");
  return {
    ...inspection,
    tabId: target.tabId,
    elements: inspection.elements.map(({ refId, ...element }) => ({
      ...element,
      ref: { id: refId, snapshotId: inspection.snapshotId, tabId: target.tabId, origin: target.origin },
    })),
  };
}

export async function describePageTarget(call: PageToolCall, refreshExpired = false, taskTabId?: number): Promise<PageTargetDescription> {
  const args = call.tool === "click"
    ? clickArgumentsSchema.parse(call.arguments)
    : call.tool === "fill"
      ? fillArgumentsSchema.parse(call.arguments)
      : call.tool === "keypress"
        ? keypressArgumentsSchema.parse(call.arguments)
        : submitArgumentsSchema.parse(call.arguments);
  return withRef<PageTargetDescription>(args.ref, refreshExpired ? "REVALIDATE" : "DESCRIBE", undefined, taskTabId);
}

export async function executePageTool(call: PageToolCall, taskTabId?: number): Promise<unknown> {
  switch (call.tool) {
    case "inspect":
      return inspectActivePage(call, taskTabId);
    case "click": {
      const args = clickArgumentsSchema.parse(call.arguments);
      return withPopupClickLock(args.ref.tabId, () => clickWithPopupGuard(args.ref, taskTabId));
    }
    case "fill": {
      const args = fillArgumentsSchema.parse(call.arguments);
      return withRef(args.ref, "FILL", { value: args.value, mode: args.mode }, taskTabId);
    }
    case "select": {
      const args = selectArgumentsSchema.parse(call.arguments);
      return withRef(args.ref, "SELECT", { value: args.value }, taskTabId);
    }
    case "check": {
      const args = checkArgumentsSchema.parse(call.arguments);
      return withRef(args.ref, "CHECK", { checked: args.checked }, taskTabId);
    }
    case "drag": {
      const args = dragArgumentsSchema.parse(call.arguments);
      if (taskTabId !== undefined && (args.sourceRef.tabId !== taskTabId || args.targetRef.tabId !== taskTabId)) {
        throw new Error("The drag controls do not belong to this task's working tab. Inspect the working tab again.");
      }
      const target = await authorizedTarget(args.sourceRef.tabId);
      assertRefTarget(args.sourceRef, target);
      assertRefTarget(args.targetRef, target);
      await ensureExecutor(target);
      return sendExecutor(target.tabId, {
        action: "DRAG",
        snapshotId: args.sourceRef.snapshotId,
        sourceRefId: args.sourceRef.id,
        targetRefId: args.targetRef.id,
      });
    }
    case "keypress": {
      const args = keypressArgumentsSchema.parse(call.arguments);
      return withRef(args.ref, "KEYPRESS", { key: args.key }, taskTabId);
    }
    case "scroll": {
      const args = scrollArgumentsSchema.parse(call.arguments);
      if (args.direction === "element") return withRef(elementRefSchema.parse(args.ref), "SCROLL_ELEMENT", undefined, taskTabId);
      const target = await authorizedTarget(taskTabId);
      await ensureExecutor(target);
      return sendExecutor(target.tabId, { action: "SCROLL", direction: args.direction, amount: args.amount });
    }
    case "history": {
      const args = historyArgumentsSchema.parse(call.arguments);
      const target = await authorizedTarget(taskTabId);
      if (args.direction === "back") await chrome.tabs.goBack(target.tabId);
      else await chrome.tabs.goForward(target.tabId);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const tab = await chrome.tabs.get(target.tabId);
      return { tabId: target.tabId, direction: args.direction, navigated: true, url: tab.url ?? "", title: tab.title ?? "", status: tab.status ?? "unknown" };
    }
    case "wait": {
      const args = waitArgumentsSchema.parse(call.arguments);
      const target = await authorizedTarget(taskTabId);
      const started = Date.now();
      while (Date.now() - started < args.timeoutMs) {
        const tab = await chrome.tabs.get(target.tabId);
        if (tab.status === "complete") return { tabId: target.tabId, ready: true, waitedMs: Date.now() - started };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`The page did not finish loading within ${args.timeoutMs} ms.`);
    }
    case "submit": {
      const args = submitArgumentsSchema.parse(call.arguments);
      const result = await withRef<Record<string, unknown>>(args.ref, "SUBMIT", undefined, taskTabId);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const tab = await chrome.tabs.get(args.ref.tabId);
      return { ...result, url: tab.url ?? "", title: tab.title ?? "", status: tab.status ?? "unknown" };
    }
  }
}

export async function currentControlOrigin(tabId: number): Promise<{ tabId: number; origin: string; originPattern: string }> {
  const target = await activeTarget(tabId);
  return { tabId: target.tabId, origin: target.origin, originPattern: target.originPattern };
}
