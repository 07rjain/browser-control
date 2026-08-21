import { z } from "zod";
import { isSafeHttpUrl } from "../shared/protocol";

export const dynamicToolCallSchema = z.object({
  requestId: z.union([z.string(), z.number()]),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  callId: z.string().min(1),
  namespace: z.literal("tabs"),
  tool: z.enum(["list", "activate", "open", "reload", "group", "ungroup", "close"]),
  arguments: z.unknown(),
}).strict();

export type DynamicToolCall = z.infer<typeof dynamicToolCallSchema>;

const tabIdSchema = z.object({ tabId: z.number().int().positive() }).strict();
const activateSchema = z.object({ tabId: z.number().int().positive(), foreground: z.boolean().optional() }).strict();
const openSchema = z.object({ url: z.string().refine(isSafeHttpUrl, "Only http/https URLs are allowed"), foreground: z.boolean().optional() }).strict();
const tabGroupColorSchema = z.enum(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]);
const groupSchema = z.object({
  tabIds: z.array(z.number().int().positive()).min(1).max(100)
    .refine((tabIds) => new Set(tabIds).size === tabIds.length, "Tab IDs must be unique"),
  title: z.string().trim().min(1).max(80),
  color: tabGroupColorSchema.optional(),
  collapsed: z.boolean().optional(),
}).strict();
const ungroupSchema = z.object({
  tabIds: z.array(z.number().int().positive()).min(1).max(100)
    .refine((tabIds) => new Set(tabIds).size === tabIds.length, "Tab IDs must be unique"),
}).strict();

export interface SafeTabSummary {
  id: number;
  windowId: number;
  active: boolean;
  title: string;
  url: string;
  groupId: number;
}

export function parseToolArguments(call: DynamicToolCall): Record<string, unknown> {
  if (call.tool === "list") return z.object({}).strict().parse(call.arguments ?? {});
  if (call.tool === "open") return openSchema.parse(call.arguments);
  if (call.tool === "activate") return activateSchema.parse(call.arguments);
  if (call.tool === "group") return groupSchema.parse(call.arguments);
  if (call.tool === "ungroup") return ungroupSchema.parse(call.arguments);
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
    groupId: tab.groupId,
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
      if (args.foreground === true) {
        await chrome.windows.update(tab.windowId, { focused: true });
        const updated = await chrome.tabs.update(tabId, { active: true });
        if (!updated) throw new Error("Chrome did not return the activated tab.");
        const summary = summarizeTab(updated);
        if (!summary) throw new Error("Chrome did not return the activated tab.");
        return { ...summary, selectedForTask: true, foregrounded: true };
      }
      const summary = summarizeTab(tab);
      if (!summary) throw new Error("The selected tab is unavailable.");
      return { ...summary, selectedForTask: true, foregrounded: false };
    }
    case "open": {
      const created = await chrome.tabs.create({ url: args.url as string, active: args.foreground === true });
      const summary = summarizeTab(created);
      if (!summary) throw new Error("Chrome did not return the opened tab.");
      return { ...summary, selectedForTask: true, foregrounded: args.foreground === true };
    }
    case "reload": {
      const tabId = args.tabId as number;
      await chrome.tabs.get(tabId);
      await chrome.tabs.reload(tabId);
      return { tabId, reloaded: true };
    }
    case "group": {
      const tabIds = args.tabIds as [number, ...number[]];
      const tabs = await Promise.all(tabIds.map((tabId) => chrome.tabs.get(tabId)));
      const windowIds = new Set(tabs.map((tab) => tab.windowId));
      if (windowIds.size !== 1) throw new Error("Tabs must be in the same browser window to be grouped.");
      if (tabs.some((tab) => tab.pinned)) throw new Error("Pinned tabs must be unpinned before they can be grouped.");
      const windowId = tabs[0].windowId;
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      const group = await chrome.tabGroups.update(groupId, {
        title: args.title as string,
        color: args.color as chrome.tabGroups.Color | undefined,
        collapsed: args.collapsed as boolean | undefined,
      });
      if (!group) throw new Error("Chrome did not return the created tab group.");
      return {
        id: group.id,
        windowId: group.windowId,
        title: group.title ?? "",
        color: group.color,
        collapsed: group.collapsed,
        tabIds,
      };
    }
    case "ungroup": {
      const tabIds = args.tabIds as [number, ...number[]];
      await Promise.all(tabIds.map((tabId) => chrome.tabs.get(tabId)));
      await chrome.tabs.ungroup(tabIds);
      return { tabIds, ungrouped: true };
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
