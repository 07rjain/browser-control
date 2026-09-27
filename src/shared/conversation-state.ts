import { z } from "zod";

export const SIDEBAR_STATE_STORAGE_KEY = "codexSidebarState";
export const MAX_STORED_CONVERSATIONS = 30;

const storedMessageSchema = z.object({
  id: z.string().min(1).max(500),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(100_000),
  streaming: z.boolean().optional(),
  failed: z.boolean().optional(),
});

const storedConversationSchema = z.object({
  id: z.string().min(1).max(200),
  threadId: z.string().min(1).max(500).nullable(),
  title: z.string().max(120),
  messages: z.array(storedMessageSchema).max(100),
  toolStatuses: z.array(z.unknown()).max(100),
  updatedAt: z.number(),
});

export const conversationSnapshotSchema = z.object({
  savedAt: z.number(),
  threadId: z.string().min(1).max(500).nullable(),
  currentConversationId: z.string().min(1).max(200),
  messages: z.array(storedMessageSchema).max(100),
  theme: z.enum(["system", "light", "dark"]),
  selectedModel: z.string().max(200),
  completionSoundEnabled: z.boolean(),
  conversationHistory: z.array(storedConversationSchema).max(MAX_STORED_CONVERSATIONS),
});

export type StoredChatMessage = z.infer<typeof storedMessageSchema>;
export type StoredConversation = z.infer<typeof storedConversationSchema>;
export type ConversationSnapshot = z.infer<typeof conversationSnapshotSchema>;

export function messageTextSize(messages: Array<{ text: string }>): number {
  return messages.reduce((sum, message) => sum + message.text.length, 0);
}

function preferConversation(existing: StoredConversation, incoming: StoredConversation): StoredConversation {
  const existingSize = messageTextSize(existing.messages);
  const incomingSize = messageTextSize(incoming.messages);
  if (incomingSize > existingSize) return incoming;
  if (incomingSize < existingSize) return existing;
  const newer = incoming.updatedAt >= existing.updatedAt ? incoming : existing;
  const older = newer === incoming ? existing : incoming;
  if (newer.toolStatuses.length === 0 && older.toolStatuses.length > 0) {
    return { ...newer, toolStatuses: older.toolStatuses };
  }
  return newer;
}

export function mergeConversationHistory(
  stored: StoredConversation[],
  incoming: StoredConversation[],
): StoredConversation[] {
  const byId = new Map<string, StoredConversation>();
  for (const record of stored) {
    if (record.messages.length === 0) continue;
    byId.set(record.id, record);
  }
  for (const record of incoming) {
    if (record.messages.length === 0) continue;
    const existing = byId.get(record.id);
    byId.set(record.id, existing ? preferConversation(existing, record) : record);
  }
  return [...byId.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_STORED_CONVERSATIONS);
}

function readMessages(value: unknown): StoredChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = storedMessageSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }).slice(-100);
}

function readHistory(value: unknown): StoredConversation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = storedConversationSchema.safeParse(item);
    return parsed.success && parsed.data.messages.length > 0 ? [parsed.data] : [];
  }).slice(0, MAX_STORED_CONVERSATIONS);
}

export function readStoredSidebarState(value: unknown): ConversationSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ConversationSnapshot>;
  const messages = readMessages(record.messages);
  const conversationHistory = readHistory(record.conversationHistory);
  const currentConversationId = typeof record.currentConversationId === "string"
    ? record.currentConversationId.slice(0, 200)
    : "";
  if (messages.length === 0 && conversationHistory.length === 0 && currentConversationId.length === 0) return null;
  const theme = record.theme === "light" || record.theme === "dark" || record.theme === "system"
    ? record.theme
    : "system";
  return {
    savedAt: typeof record.savedAt === "number" && Number.isFinite(record.savedAt) ? record.savedAt : 0,
    threadId: typeof record.threadId === "string" && record.threadId.length > 0 ? record.threadId.slice(0, 500) : null,
    currentConversationId,
    messages,
    theme,
    selectedModel: typeof record.selectedModel === "string" ? record.selectedModel.slice(0, 200) : "",
    completionSoundEnabled: record.completionSoundEnabled === true,
    conversationHistory,
  };
}

export function mergeSidebarState(
  stored: ConversationSnapshot | null,
  incoming: ConversationSnapshot,
): ConversationSnapshot {
  const conversationHistory = mergeConversationHistory(
    stored?.conversationHistory ?? [],
    incoming.conversationHistory,
  );
  const storedMessages = stored?.messages ?? [];
  const storedId = stored?.currentConversationId ?? "";
  const startedNewChat = incoming.messages.length === 0
    && storedId.length > 0
    && incoming.currentConversationId !== storedId
    && incoming.conversationHistory.some((item) => item.id === storedId);
  const keepStoredTranscript = !startedNewChat
    && messageTextSize(storedMessages) > messageTextSize(incoming.messages)
    && (storedId === incoming.currentConversationId || incoming.messages.length === 0);

  return {
    savedAt: Math.max(stored?.savedAt ?? 0, incoming.savedAt),
    threadId: keepStoredTranscript ? stored?.threadId ?? null : incoming.threadId,
    currentConversationId: keepStoredTranscript ? storedId : incoming.currentConversationId,
    messages: keepStoredTranscript ? storedMessages : incoming.messages,
    theme: incoming.theme,
    selectedModel: incoming.selectedModel,
    completionSoundEnabled: incoming.completionSoundEnabled,
    conversationHistory,
  };
}
