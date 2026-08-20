import { z } from "zod";
import { isSafeHttpUrl } from "../shared/protocol";

export const dynamicToolCallSchema = z.object({
  requestId: z.union([z.string(), z.number()]),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  callId: z.string().min(1),
  namespace: z.literal("tabs"),
  tool: z.enum(["list", "activate", "open", "reload", "close"]),
  arguments: z.unknown(),
});

export type DynamicToolCall = z.infer<typeof dynamicToolCallSchema>;

const tabIdSchema = z.object({ tabId: z.number().int().positive() });
const openSchema = z.object({ url: z.string().refine(isSafeHttpUrl, "Only http/https URLs are allowed") });

export interface SafeTabSummary {
  id: number;
  windowId: number;
  active: boolean;
  title: string;
  url: string;
}

export function parseToolArguments(call: DynamicToolCall): Record<string, unknown> {
  if (call.tool === "list") return z.object({}).parse(call.arguments ?? {});
  if (call.tool === "open") return openSchema.parse(call.arguments);
  return tabIdSchema.parse(call.arguments);
}

export function summarizeTab(tab: chrome.tabs.Tab): SafeTabSummary | null {
  if (tab.id === undefined) return null;
  return {
    id: tab.id,
    windowId: tab.windowId,
    active: tab.active,
    title: tab.title ?? "Untitled tab",
    url: tab.url ?? "",
  };
}

export async function executeTabTool(call: DynamicToolCall): Promise<unknown> {
  const args = parseToolArguments(call);

  switch (call.tool) {
    case "list": {
      const tabs = await chrome.tabs.query({});
      return tabs.map(summarizeTab).filter((tab): tab is SafeTabSummary => tab !== null);
    }
    case "activate": {
      const tabId = args.tabId as number;
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      const updated = await chrome.tabs.update(tabId, { active: true });
      if (!updated) throw new Error("Chrome did not return the activated tab.");
      return summarizeTab(updated);
    }
    case "open": {
      const created = await chrome.tabs.create({ url: args.url as string, active: true });
      return summarizeTab(created);
    }
    case "reload": {
      const tabId = args.tabId as number;
      await chrome.tabs.get(tabId);
      await chrome.tabs.reload(tabId);
      return { tabId, reloaded: true };
    }
    case "close": {
      const tabId = args.tabId as number;
      await chrome.tabs.get(tabId);
      await chrome.tabs.remove(tabId);
      return { tabId, closed: true };
    }
  }
}

export async function describeCloseTarget(call: DynamicToolCall): Promise<SafeTabSummary> {
  const args = parseToolArguments(call);
  const tab = await chrome.tabs.get(args.tabId as number);
  const summary = summarizeTab(tab);
  if (!summary) throw new Error("The requested tab no longer exists.");
  return summary;
}
