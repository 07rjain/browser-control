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

export function groupToolStatuses(statuses: ToolStatus[]): Map<string, ToolStatus[]> {
  const groups = new Map<string, ToolStatus[]>();
  for (const status of statuses) {
    if (!status.turnId) continue;
    const group = groups.get(status.turnId) ?? [];
    group.push(status);
    groups.set(status.turnId, group);
  }
  return groups;
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
  const latestByCall = new Map<string, ToolStatus>();
  for (const status of statuses) latestByCall.set(status.callId, status);
  return {
    actionCount: latestByCall.size,
    failed: [...latestByCall.values()].some((status) => ["failed", "rejected", "canceled", "stale"].includes(status.status)),
  };
}
