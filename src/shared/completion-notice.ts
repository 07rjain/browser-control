export const COMPLETION_NOTICE_DURATION_MS = 10_000;

export interface CompletionNotice { message: string; timestamp: number }

export function freshCompletionNotice(value: unknown, now = Date.now()): CompletionNotice | null {
  if (!value || typeof value !== "object") return null;
  const notice = value as Partial<CompletionNotice>;
  if (typeof notice.message !== "string" || !notice.message || typeof notice.timestamp !== "number" || !Number.isFinite(notice.timestamp)) return null;
  const age = now - notice.timestamp;
  return age >= 0 && age < COMPLETION_NOTICE_DURATION_MS ? { message: notice.message, timestamp: notice.timestamp } : null;
}
