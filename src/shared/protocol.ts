import { z } from "zod";

export const pageAttachmentSchema = z.object({
  title: z.string().max(500),
  url: z.string().url(),
  origin: z.string().max(500),
  selectedText: z.string().max(8_000),
  readableText: z.string().max(24_000),
  characterCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

export type PageAttachment = z.infer<typeof pageAttachmentSchema>;

export const accountSchema = z
  .object({
    type: z.literal("chatgpt"),
    email: z.string().email().nullable(),
    planType: z.string().nullable(),
  })
  .nullable();

const requestBase = z.object({ requestId: z.string().uuid() });

export const uiRequestSchema = z.discriminatedUnion("type", [
  requestBase.extend({ type: z.literal("BRIDGE_STATUS") }),
  requestBase.extend({ type: z.literal("ACCOUNT_READ") }),
  requestBase.extend({ type: z.literal("AUTH_LOGIN") }),
  requestBase.extend({ type: z.literal("AUTH_CANCEL"), loginId: z.string().min(1) }),
  requestBase.extend({ type: z.literal("AUTH_LOGOUT") }),
  requestBase.extend({ type: z.literal("CHAT_START") }),
  requestBase.extend({ type: z.literal("CHAT_RESUME"), threadId: z.string().min(1) }),
  requestBase.extend({
    type: z.literal("CHAT_SEND"),
    threadId: z.string().min(1),
    text: z.string().trim().min(1).max(80_000),
    clientMessageId: z.string().uuid(),
  }),
  requestBase.extend({
    type: z.literal("CHAT_INTERRUPT"),
    threadId: z.string().min(1),
    turnId: z.string().min(1),
  }),
  requestBase.extend({ type: z.literal("PAGE_ATTACH") }),
  requestBase.extend({
    type: z.literal("OPEN_EXTERNAL"),
    url: z.string().url(),
  }),
  requestBase.extend({
    type: z.literal("TOOL_DECISION"),
    callId: z.string().min(1),
    approved: z.boolean(),
  }),
]);

export type UiRequest = z.infer<typeof uiRequestSchema>;

export type UiResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; code?: string; details?: unknown };

export const nativeEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("response"),
    id: z.string().min(1),
    ok: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal("event"),
    event: z.string().min(1),
    data: z.unknown().optional(),
  }),
]);

export type NativeEnvelope = z.infer<typeof nativeEnvelopeSchema>;

export interface SidebarEvent {
  source: "codex-sidebar-background";
  event: string;
  data?: unknown;
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
