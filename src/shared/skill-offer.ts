import { z } from "zod";

const offerFields = {
  reason: z.string().trim().min(1).max(300).refine((value) => !value.includes("\0")),
  description: z.string().trim().max(500).refine((value) => !value.includes("\0")),
};

export const skillRecordingOfferSchema = z.object({
  ...offerFields,
  state: z.enum(["pending", "offered", "dismissed", "opened"]),
}).strict();

export const skillRecordingOfferEventSchema = z.object({
  ...offerFields,
  threadId: z.string().min(1).max(500),
  turnId: z.string().min(1).max(500),
  callId: z.string().min(1).max(500),
}).strict();

export type SkillRecordingOffer = z.infer<typeof skillRecordingOfferSchema>;
