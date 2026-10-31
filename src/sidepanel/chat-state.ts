import type { MemoryProposal } from "../shared/memory";
import type { AttachmentSummary } from "../shared/attachments";
import type { SkillRecordingOffer } from "../shared/skill-offer";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  failed?: boolean;
  recordingOffer?: SkillRecordingOffer;
  attachments?: AttachmentSummary[];
  memoryProposals?: MemoryProposal[];
}

export function settleCanceledMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.flatMap((message) => {
    if (message.role === "assistant" && message.streaming && message.text.trim().length === 0 && !message.recordingOffer) return [];
    return [{ ...message, streaming: false }];
  });
}
