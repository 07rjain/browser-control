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

type PopupGuardControl = (
  action: "wait" | "release" | "replace",
  requestedGuardId: string,
  timing?: { quietMs: number; afterAttemptMs: number; maxMs: number },
) => { attempted: number; urls: string[] } | Promise<{ attempted: number; urls: string[] }> | null;

const POPUP_QUIET_WINDOW_MS = 350;
const POPUP_AFTER_ATTEMPT_MS = 50;
const POPUP_MAX_WINDOW_MS = 1_000;
const POPUP_RESTORE_MARGIN_MS = 1_000;

export function installPopupGuardInPage(guardId: string, restoreAfterMs = 2_000): void {
  const controlPrefix = "__codexSidebarPopupGuardControlV3_";
  const previousOpen = window.open as unknown as Record<string, unknown>;
  const previousKey = Object.getOwnPropertyNames(window.open).find((key) => key.startsWith(controlPrefix));
  const previousControl = previousKey ? previousOpen[previousKey] : undefined;
  if (typeof previousControl === "function") {
    previousControl("replace", previousKey?.slice(controlPrefix.length) ?? "");
  }

  const originalOpen = window.open;
  const attempts: Array<string | null> = [];
  let timeoutId = 0;
  let notifyAttempt: (() => void) | undefined;
  let finishPendingWait: (() => void) | undefined;
  const report = () => ({
    attempted: attempts.length,
    urls: attempts.filter((url): url is string => url !== null),
  });
  const control: PopupGuardControl = (action, requestedGuardId, timing) => {
    if (action !== "replace" && requestedGuardId !== guardId) return null;
    if (action === "wait") {
      if (!timing) return null;
      return new Promise((resolve) => {
        let afterAttemptTimeoutId: number | undefined;
        let quietTimeoutId = 0;
        const maxTimeoutId = window.setTimeout(() => finish(), timing.maxMs);
        const finish = () => {
          window.clearTimeout(quietTimeoutId);
          window.clearTimeout(maxTimeoutId);
          if (afterAttemptTimeoutId !== undefined) window.clearTimeout(afterAttemptTimeoutId);
          notifyAttempt = undefined;
          finishPendingWait = undefined;
          resolve(report());
        };
        notifyAttempt = () => {
          window.clearTimeout(quietTimeoutId);
          if (afterAttemptTimeoutId !== undefined) window.clearTimeout(afterAttemptTimeoutId);
          afterAttemptTimeoutId = window.setTimeout(finish, timing.afterAttemptMs);
        };
        finishPendingWait = finish;
        quietTimeoutId = window.setTimeout(
          finish,
          attempts.length > 0 ? timing.afterAttemptMs : timing.quietMs,
        );
      });
    }
    const currentReport = report();
    if (action === "release" || action === "replace") {
      finishPendingWait?.();
      window.clearTimeout(timeoutId);
      if (window.open === guardedOpen) window.open = originalOpen;
    }
    return currentReport;
  };
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
    notifyAttempt?.();
    return null;
  };
  Object.defineProperty(guardedOpen, `${controlPrefix}${guardId}`, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: control,
  });
  window.open = guardedOpen as typeof window.open;
  // The closure owns originalOpen; the longer page timer is only a
  // service-worker interruption failsafe.
  timeoutId = window.setTimeout(() => control("release", guardId), restoreAfterMs);
}

export async function waitForPopupGuardQuietInPage(
  guardId: string,
  quietMs: number,
  afterAttemptMs: number,
  maxMs: number,
): Promise<{ attempted: number; urls: string[] } | null> {
  const key = `__codexSidebarPopupGuardControlV3_${guardId}`;
  const control = (window.open as unknown as Record<string, unknown>)[key];
  if (typeof control !== "function") return null;
  return (control as PopupGuardControl)("wait", guardId, { quietMs, afterAttemptMs, maxMs });
}

export function releasePopupGuardInPage(guardId: string): { attempted: number; urls: string[] } | null {
  const key = `__codexSidebarPopupGuardControlV3_${guardId}`;
  const control = (window.open as unknown as Record<string, unknown>)[key];
  if (typeof control !== "function") return null;
  return (control as PopupGuardControl)("release", guardId) as { attempted: number; urls: string[] } | null;
}

async function installPopupGuard(tabId: number, guardId: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: installPopupGuardInPage,
    args: [guardId, POPUP_MAX_WINDOW_MS + POPUP_RESTORE_MARGIN_MS],
  });
}

async function waitForPopupGuardQuiet(tabId: number, guardId: string): Promise<PopupGuardReport> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: waitForPopupGuardQuietInPage,
      args: [guardId, POPUP_QUIET_WINDOW_MS, POPUP_AFTER_ATTEMPT_MS, POPUP_MAX_WINDOW_MS],
    });
    return results[0]?.result ?? { attempted: 0, urls: [], collectionFailed: true };
  } catch {
    return { attempted: 0, urls: [], collectionFailed: true };
  }
}

async function activeTarget(tabId?: number): Promise<PageTarget> {
  let tab = tabId === undefined
    ? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    : await chrome.tabs.get(tabId);
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
      if (taskTabId !== undefined && args.ref.tabId !== taskTabId) {
        throw new Error("The page element does not belong to this task's working tab. Inspect the working tab again.");
      }
      const guardId = crypto.randomUUID();
      await installPopupGuard(args.ref.tabId, guardId);
      let result: Record<string, unknown>;
      let popup: PopupGuardReport;
      let clickError: unknown;
      try {
        result = await withRef<Record<string, unknown>>(args.ref, "CLICK", undefined, taskTabId);
      } catch (error) {
        clickError = error;
        result = {
          clicked: false,
          actionError: error instanceof Error ? error.message : "The page click failed.",
        };
      } finally {
        popup = await waitForPopupGuardQuiet(args.ref.tabId, guardId);
      }
      if (clickError && popup.attempted === 0 && !popup.collectionFailed) throw clickError;
      const tab = await chrome.tabs.get(args.ref.tabId).catch(() => undefined);
      return {
        ...result,
        url: tab?.url ?? "",
        title: tab?.title ?? "",
        status: tab?.status ?? "unavailable",
        tabUnavailable: tab === undefined,
        popupAttempts: popup.attempted,
        popupUrls: popup.urls,
        popupBlocked: popup.collectionFailed === true || popup.attempted > popup.urls.length,
        popupCollectionFailed: popup.collectionFailed === true,
      };
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

export async function currentControlOrigin(tabId?: number): Promise<{ tabId: number; origin: string; originPattern: string }> {
  const target = await activeTarget(tabId);
  return { tabId: target.tabId, origin: target.origin, originPattern: target.originPattern };
}
