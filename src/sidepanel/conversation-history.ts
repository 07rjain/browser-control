import type { ToolStatus } from "./activity";
import type { ChatMessage } from "./chat-state";

export interface ConversationRecord {
  id: string;
  threadId: string | null;
  title: string;
  messages: ChatMessage[];
  toolStatuses: ToolStatus[];
  updatedAt: number;
}

export const MAX_CONVERSATION_HISTORY = 30;

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ChatMessage>;
  return typeof message.id === "string"
    && (message.role === "user" || message.role === "assistant")
    && typeof message.text === "string";
}

function isToolStatus(value: unknown): value is ToolStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<ToolStatus>;
  return typeof status.callId === "string"
    && typeof status.tool === "string"
    && typeof status.status === "string";
}

export function conversationTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.text
    .replace(/\s+/g, " ")
    .trim();
  if (!firstUserMessage) return "New conversation";
  return firstUserMessage.length > 58 ? `${firstUserMessage.slice(0, 57).trimEnd()}…` : firstUserMessage;
}

export function createConversationRecord(
  id: string,
  threadId: string | null,
  messages: ChatMessage[],
  toolStatuses: ToolStatus[],
  updatedAt = Date.now(),
): ConversationRecord {
  const retainedMessages = messages.slice(-100).map((message) => ({
    ...message,
    text: message.text.slice(0, 100_000),
    streaming: false,
  }));
  const messageIds = new Set(retainedMessages.map((message) => message.id));
  return {
    id,
    threadId,
    title: conversationTitle(retainedMessages),
    messages: retainedMessages,
    toolStatuses: toolStatuses
      .filter((status) => Boolean(status.turnId) && messageIds.has(status.turnId as string))
      .slice(-100),
    updatedAt,
  };
}

export function upsertConversation(
  history: ConversationRecord[],
  conversation: ConversationRecord,
): ConversationRecord[] {
  if (conversation.messages.length === 0) {
    return history.filter((item) => item.id !== conversation.id).slice(0, MAX_CONVERSATION_HISTORY);
  }
  return [conversation, ...history.filter((item) => item.id !== conversation.id)]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_CONVERSATION_HISTORY);
}

export function readConversationHistory(value: unknown): ConversationRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<ConversationRecord>;
    if (typeof record.id !== "string" || !Array.isArray(record.messages)) return [];
    const messages = record.messages.filter(isChatMessage);
    if (messages.length === 0) return [];
    return [{
      id: record.id,
      threadId: typeof record.threadId === "string" ? record.threadId : null,
      title: typeof record.title === "string" && record.title.trim()
        ? record.title.slice(0, 80)
        : conversationTitle(messages),
      messages: messages.slice(-100).map((message) => ({ ...message, text: message.text.slice(0, 100_000), streaming: false })),
      toolStatuses: Array.isArray(record.toolStatuses) ? record.toolStatuses.filter(isToolStatus).slice(-100) : [],
      updatedAt: typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
    } satisfies ConversationRecord];
  }).sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_CONVERSATION_HISTORY);
}
