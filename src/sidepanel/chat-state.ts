import type { AttachmentSummary } from "../shared/attachments";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  failed?: boolean;
  attachments?: AttachmentSummary[];
}

export function settleCanceledMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.flatMap((message) => {
    if (message.role === "assistant" && message.streaming && message.text.trim().length === 0) return [];
    return [{ ...message, streaming: false }];
  });
}
