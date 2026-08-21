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

interface PopupGuardState {
  id: string;
  originalOpen: typeof window.open;
  attempts: Array<string | null>;
  timeoutId: number;
}

interface PopupGuardReport {
  attempted: number;
  urls: string[];
  collectionFailed?: boolean;
}

interface PopupGuardWindow extends Window {
  __codexSidebarPopupGuardV1?: PopupGuardState;
}

export function installPopupGuardInPage(guardId: string): void {
  const guardedWindow = window as PopupGuardWindow;
  const previous = guardedWindow.__codexSidebarPopupGuardV1;
  if (previous) {
    window.clearTimeout(previous.timeoutId);
    window.open = previous.originalOpen;
  }

  const originalOpen = window.open;
  const attempts: Array<string | null> = [];
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
    return null;
  };
  window.open = guardedOpen as typeof window.open;

  const timeoutId = window.setTimeout(() => {
    const current = guardedWindow.__codexSidebarPopupGuardV1;
    if (current?.id !== guardId) return;
    window.open = current.originalOpen;
    delete guardedWindow.__codexSidebarPopupGuardV1;
  }, 1_000);
  Object.defineProperty(guardedWindow, "__codexSidebarPopupGuardV1", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: { id: guardId, originalOpen, attempts, timeoutId },
  });
}

export function releasePopupGuardInPage(guardId: string): { attempted: number; urls: string[] } {
  const guardedWindow = window as PopupGuardWindow;
  const current = guardedWindow.__codexSidebarPopupGuardV1;
  if (current?.id !== guardId) return { attempted: 0, urls: [] };
  window.clearTimeout(current.timeoutId);
  window.open = current.originalOpen;
  delete guardedWindow.__codexSidebarPopupGuardV1;
  return {
    attempted: current.attempts.length,
    urls: current.attempts.filter((url): url is string => url !== null),
  };
}

async function installPopupGuard(tabId: number, guardId: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: installPopupGuardInPage,
    args: [guardId],
  });
}

async function releasePopupGuard(tabId: number, guardId: string): Promise<PopupGuardReport> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: releasePopupGuardInPage,
      args: [guardId],
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
      try {
        result = await withRef<Record<string, unknown>>(args.ref, "CLICK", undefined, taskTabId);
      } finally {
        // Keep the MAIN-world guard installed while microtasks, animation
        // callbacks, and short deferred handlers spawned by the click settle.
        await new Promise((resolve) => setTimeout(resolve, 150));
        popup = await releasePopupGuard(args.ref.tabId, guardId);
      }
      const tab = await chrome.tabs.get(args.ref.tabId);
      return {
        ...result,
        url: tab.url ?? "",
        title: tab.title ?? "",
        status: tab.status ?? "unknown",
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
