import { z } from "zod";

export const FILE_LIMITS = {
  count: 5, imageBytes: 8 * 1024 * 1024, documentBytes: 20 * 1024 * 1024,
  batchBytes: 40 * 1024 * 1024, preparedBytes: 32 * 1024 * 1024,
  chunkBytes: 192 * 1024, visualPages: 20, documentPages: 200,
  fileCharacters: 24_000, turnCharacters: 80_000,
} as const;

export const attachmentKindSchema = z.enum(["text", "image", "pdf"]);
export const attachmentSummarySchema = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(180), kind: attachmentKindSchema,
  bytes: z.number().int().nonnegative().max(FILE_LIMITS.documentBytes),
  truncated: z.boolean(), pageCount: z.number().int().min(1).max(FILE_LIMITS.documentPages).optional(),
  pages: z.array(z.number().int().min(1).max(FILE_LIMITS.documentPages)).max(FILE_LIMITS.visualPages),
  notice: z.string().max(500).optional(), expiresAt: z.number().optional(),
});
export type AttachmentSummary = z.infer<typeof attachmentSummarySchema>;
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;

const owner = z.string().uuid();
const id = z.string().uuid();
export const attachmentOperationSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("capabilities") }),
  z.object({ operation: z.literal("begin"), owner, bytes: z.number().int().min(1).max(FILE_LIMITS.documentBytes),
    mime: z.enum(["image/png", "image/jpeg", "text/plain"]), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.object({ operation: z.literal("chunk"), owner, id, offset: z.number().int().nonnegative(), data: z.string().max(FILE_LIMITS.chunkBytes * 4 / 3) }),
  z.object({ operation: z.literal("finalize"), owner, id }),
  z.object({ operation: z.literal("read"), owner, id, offset: z.number().int().nonnegative() }),
  z.object({ operation: z.literal("abort"), owner }),
  z.object({ operation: z.literal("bundle"), owner, file: attachmentSummarySchema.omit({ id: true, expiresAt: true }),
    assets: z.array(z.object({ id, role: z.enum(["text", "image"]), page: z.number().int().min(1).max(200).optional() })).min(1).max(40) }),
  z.object({ operation: z.literal("preview"), threadId: z.string().min(1).max(500), id, page: z.number().int().min(1).max(200).optional(), offset: z.number().int().nonnegative() }),
]);
export type AttachmentOperation = z.infer<typeof attachmentOperationSchema>;

export interface AttachmentCapabilities {
  version: 1;
}

export function parsePageRange(value: string, count: number): number[] {
  if (!value.trim()) throw new Error("Choose the pages to share, for example 1-5, 8.");
  const pages = new Set<number>();
  for (const token of value.split(",")) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token.trim());
    if (!match) throw new Error("Use page numbers or ranges, for example 1-5, 8.");
    const start = Number(match[1]);
    const end = Number(match[2] ?? start);
    if (start < 1 || end < start || end > count) throw new Error(`Choose pages between 1 and ${count}.`);
    if (end - start >= FILE_LIMITS.visualPages) throw new Error(`Share at most ${FILE_LIMITS.visualPages} visual pages per message.`);
    for (let page = start; page <= end; page++) pages.add(page);
    if (pages.size > FILE_LIMITS.visualPages) throw new Error(`Share at most ${FILE_LIMITS.visualPages} visual pages per message.`);
  }
  return [...pages].sort((a, b) => a - b);
}
