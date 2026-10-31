import { z } from "zod";

const memoryText = z.string().min(1).max(500).refine((value) => Boolean(value.trim()) && !value.includes("\0"));
export const memoryRecordSchema = z.object({
  id: z.string().uuid(), kind: z.enum(["preference", "fact"]), text: memoryText, pinned: z.boolean(),
  createdAt: z.number().nonnegative().max(8_640_000_000_000_000), updatedAt: z.number().nonnegative().max(8_640_000_000_000_000), expiresAt: z.number().nonnegative().max(8_640_000_000_000_000).nullable(),
  source: z.object({ type: z.enum(["manual", "user-message"]), threadId: z.string().max(500).optional(), messageId: z.string().max(500).optional(), evidence: z.string().max(500).optional() }),
});
export const memoryStateSchema = z.object({ version: z.literal(1), identity: z.string().uuid().nullable(), revision: z.number().int().nonnegative(), enabled: z.boolean(), records: z.array(memoryRecordSchema).max(200) });
const version = { identity: z.string().uuid().nullable(), revision: z.number().int().nonnegative() };
const recordFields = { kind: z.enum(["preference", "fact"]), text: memoryText, pinned: z.boolean(), expiresAt: z.number().nonnegative().max(8_640_000_000_000_000).nullable() };
export const memoryWriteSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("settings"), ...version, enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal("add"), ...version, ...recordFields }).strict(),
  z.object({ operation: z.literal("replace"), ...version, ...recordFields, recordId: z.string().uuid() }).strict(),
  z.object({ operation: z.literal("delete"), ...version, recordId: z.string().uuid() }).strict(),
  z.object({ operation: z.literal("clear"), ...version }).strict(),
]);
export type MemoryState = z.infer<typeof memoryStateSchema>;
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;
export type MemoryWrite = z.infer<typeof memoryWriteSchema>;
