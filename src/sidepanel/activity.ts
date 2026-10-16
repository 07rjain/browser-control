import type { ReviewActivity } from "../shared/auto-review";
import type { BrowserPermissionMode } from "../shared/page-tools";

export interface ToolStatus {
  callId: string;
  namespace?: string;
  tool: string;
  status: string;
  threadId?: string;
  turnId?: string;
  timestamp?: number;
  origin?: string;
  error?: string;
  permissionMode?: BrowserPermissionMode;
  confirmationBypassed?: boolean;
  review?: ReviewActivity;
  target?: {
    label?: string;
    title?: string;
    url?: string;
    form?: {
      action: string;
      method: string;
      fields: Array<{ name: string; value: string; sensitive: boolean }>;
    } | null;
  };
}

export function latestToolStatuses(statuses: ToolStatus[]): ToolStatus[] {
  const calls = new Map<string, ToolStatus>();
  for (const status of statuses) {
    const key = JSON.stringify([status.threadId, status.turnId, status.callId]);
    calls.set(key, { ...calls.get(key), ...status });
  }
  return [...calls.values()];
}

export function groupToolStatuses(statuses: ToolStatus[]): Map<string, ToolStatus[]> {
  const groups = new Map<string, ToolStatus[]>();
  for (const status of latestToolStatuses(statuses)) {
    if (!status.turnId) continue;
    const group = groups.get(status.turnId) ?? [];
    group.push(status);
    groups.set(status.turnId, group);
  }
  return groups;
}

export function hasBrowserActivityForTurn(statuses: ToolStatus[], turnId: string | null): boolean {
  return turnId !== null && statuses.some((status) => status.turnId === turnId && status.namespace !== "skills");
}

export function activityStepLabel(status: ToolStatus): string {
  if (status.namespace === "skills") return `Skill · ${status.tool}`;
  return `Browser · ${status.namespace ? `${status.namespace}.` : ""}${status.tool}`;
}

export function visibleActivityFormFields(status: ToolStatus): Array<{ name: string; value: string }> {
  return (status.target?.form?.fields ?? [])
    .filter((field) => !field.sensitive)
    .map(({ name, value }) => ({ name, value }));
}

export function summarizeToolStatuses(statuses: ToolStatus[]): {
  actionCount: number;
  failed: boolean;
} {
  const calls = latestToolStatuses(statuses);
  return {
    actionCount: calls.filter((status) => status.namespace !== "skills").length,
    failed: calls.some((status) => ["failed", "rejected", "canceled", "stale"].includes(status.status)),
  };
}
