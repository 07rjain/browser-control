import { z } from "zod";
import chatConfig from "../../bridge/chat-config.json";

export const DEFAULT_CHAT_SYSTEM_PROMPT = chatConfig.systemPrompt;
export const MAX_CHAT_SYSTEM_PROMPT = chatConfig.maxSystemPromptChars;
export const chatSettingsSchema = z.object({
  version: z.literal(1),
  systemPrompt: z.string().min(1).max(MAX_CHAT_SYSTEM_PROMPT).refine((value) => Boolean(value.trim()) && !value.includes("\0")),
}).strict();
export type ChatSettings = z.infer<typeof chatSettingsSchema>;
