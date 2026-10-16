import { z } from "zod";
import reviewerConfig from "../../bridge/reviewer-config.json";

export const AUTO_REVIEW_SETTINGS_KEY = "codexSidebarAutoReview";
export const AUTO_REVIEW_POLICY_VERSION = 1;
export const REVIEW_TIMEOUT_MS = 10_000;
export const REVIEW_MAX_INPUT = 8_000;
export const REVIEW_MODEL = reviewerConfig.defaultModel;
export const DEFAULT_REVIEW_SYSTEM_PROMPT = reviewerConfig.systemPrompt;
export const REQUIRED_REVIEW_INSTRUCTIONS = reviewerConfig.requiredInstructions;
export const MAX_REVIEW_SYSTEM_PROMPT = reviewerConfig.maxSystemPromptChars;
export const reviewModelSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/);
export const autoReviewSettingsSchema = z.object({
  version: z.literal(2),
  enabled: z.boolean(),
  model: reviewModelSchema,
  systemPrompt: z.string().min(1).max(MAX_REVIEW_SYSTEM_PROMPT).refine((value) => value.trim().length > 0 && !value.includes("\0"), "Enter a reviewer system prompt."),
}).strict();
export type AutoReviewSettings = z.infer<typeof autoReviewSettingsSchema>;
export const DEFAULT_AUTO_REVIEW: AutoReviewSettings = { version: 2, enabled: false, model: REVIEW_MODEL, systemPrompt: DEFAULT_REVIEW_SYSTEM_PROMPT };
export function readAutoReviewSettings(value: unknown): AutoReviewSettings {
  const current = autoReviewSettingsSchema.safeParse(value);
  if (current.success) return current.data;
  const legacy = z.object({ version: z.literal(1), enabled: z.boolean(), model: z.literal(REVIEW_MODEL) }).strict().safeParse(value);
  return legacy.success ? { ...DEFAULT_AUTO_REVIEW, enabled: legacy.data.enabled, model: legacy.data.model } : { ...DEFAULT_AUTO_REVIEW };
}
export const reviewCapabilitiesSchema = z.object({
  version: z.literal(2), available: z.boolean(), configurableModel: z.literal(true), editableSystemPrompt: z.literal(true), reason: z.string().optional(),
});
export const REVIEW_REASON_CODES = ["requested_benign_search", "requested_preference", "requested_draft", "requested_private_record", "requires_human", "unclear_intent", "missing_context", "unsafe", "unavailable", "timeout", "canceled", "invalid_result", "busy", "budget", "recovered"] as const;
export const reviewVerdictSchema = z.object({
  decision: z.enum(["approve", "ask_user"]), risk: z.enum(["low", "medium", "high", "critical", "unknown"]),
  matchesUserRequest: z.boolean(), missingContext: z.boolean(), reasonCode: z.enum(REVIEW_REASON_CODES), reason: z.string().min(1).max(240),
}).strict();
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;
export interface ReviewEvidence {
  policyVersion: 1; category: "search" | "preference" | "draft" | "private_record";
  userInstruction: string;
  action: { namespace: "page"; tool: string; arguments: unknown };
  page: { tabId: number; origin: string };
  untrustedTarget: unknown;
}
export interface ReviewActivity {
  model: string; status: "reviewing" | "approved" | "ask_user"; reason: string;
  source?: "reviewer" | "user";
}
export const expectedReviewReason = { search: "requested_benign_search", preference: "requested_preference", draft: "requested_draft", private_record: "requested_private_record" } as const;
export function verdictApproves(verdict: ReviewVerdict, category: ReviewEvidence["category"]): boolean {
  return verdict.decision === "approve" && verdict.risk === "low" && verdict.matchesUserRequest && !verdict.missingContext && verdict.reasonCode === expectedReviewReason[category];
}
