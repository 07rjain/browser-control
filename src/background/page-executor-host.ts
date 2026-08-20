import {
  checkArgumentsSchema,
  clickArgumentsSchema,
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

async function activeTarget(): Promise<PageTarget> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active browser tab is available.");
  const url = new URL(tab.url);
  const originPattern = originPatternForUrl(url.href);
  return { tabId: tab.id, origin: url.origin, originPattern, title: tab.title ?? "Untitled tab", url: url.href };
}

async function authorizedTarget(): Promise<PageTarget> {
  const target = await activeTarget();
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
    throw new Error("The page element belongs to a different tab or origin. Inspect the active page again.");
  }
}

async function withRef<T>(ref: ElementRef, action: string, params?: Record<string, unknown>): Promise<T> {
  const target = await authorizedTarget();
  assertRefTarget(ref, target);
  await ensureExecutor(target);
  return sendExecutor<T>(target.tabId, {
    action,
    snapshotId: ref.snapshotId,
    refId: ref.id,
    ...params,
  });
}

export async function inspectActivePage(call: PageToolCall): Promise<unknown> {
  inspectArgumentsSchema.parse(call.arguments);
  const target = await authorizedTarget();
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

export async function describePageTarget(call: PageToolCall): Promise<PageTargetDescription> {
  const args = call.tool === "click"
    ? clickArgumentsSchema.parse(call.arguments)
    : call.tool === "keypress"
      ? keypressArgumentsSchema.parse(call.arguments)
      : submitArgumentsSchema.parse(call.arguments);
  return withRef<PageTargetDescription>(args.ref, "DESCRIBE");
}

export async function executePageTool(call: PageToolCall): Promise<unknown> {
  switch (call.tool) {
    case "inspect":
      return inspectActivePage(call);
    case "click": {
      const args = clickArgumentsSchema.parse(call.arguments);
      const result = await withRef<Record<string, unknown>>(args.ref, "CLICK");
      await new Promise((resolve) => setTimeout(resolve, 150));
      const tab = await chrome.tabs.get(args.ref.tabId);
      return { ...result, url: tab.url ?? "", title: tab.title ?? "", status: tab.status ?? "unknown" };
    }
    case "fill": {
      const args = fillArgumentsSchema.parse(call.arguments);
      return withRef(args.ref, "FILL", { value: args.value, mode: args.mode });
    }
    case "select": {
      const args = selectArgumentsSchema.parse(call.arguments);
      return withRef(args.ref, "SELECT", { value: args.value });
    }
    case "check": {
      const args = checkArgumentsSchema.parse(call.arguments);
      return withRef(args.ref, "CHECK", { checked: args.checked });
    }
    case "keypress": {
      const args = keypressArgumentsSchema.parse(call.arguments);
      return withRef(args.ref, "KEYPRESS", { key: args.key });
    }
    case "scroll": {
      const args = scrollArgumentsSchema.parse(call.arguments);
      if (args.direction === "element") return withRef(elementRefSchema.parse(args.ref), "SCROLL_ELEMENT");
      const target = await authorizedTarget();
      await ensureExecutor(target);
      return sendExecutor(target.tabId, { action: "SCROLL", direction: args.direction, amount: args.amount });
    }
    case "history": {
      const args = historyArgumentsSchema.parse(call.arguments);
      const target = await authorizedTarget();
      if (args.direction === "back") await chrome.tabs.goBack(target.tabId);
      else await chrome.tabs.goForward(target.tabId);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const tab = await chrome.tabs.get(target.tabId);
      return { tabId: target.tabId, direction: args.direction, navigated: true, url: tab.url ?? "", title: tab.title ?? "", status: tab.status ?? "unknown" };
    }
    case "wait": {
      const args = waitArgumentsSchema.parse(call.arguments);
      const target = await authorizedTarget();
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
      const result = await withRef<Record<string, unknown>>(args.ref, "SUBMIT");
      await new Promise((resolve) => setTimeout(resolve, 150));
      const tab = await chrome.tabs.get(args.ref.tabId);
      return { ...result, url: tab.url ?? "", title: tab.title ?? "", status: tab.status ?? "unknown" };
    }
  }
}

export async function currentControlOrigin(): Promise<{ tabId: number; origin: string; originPattern: string }> {
  const target = await activeTarget();
  return { tabId: target.tabId, origin: target.origin, originPattern: target.originPattern };
}
