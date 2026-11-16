import { z } from "zod";

export const EXTENSION_UPDATE_KEY = "browserControlPendingUpdate";
export const SIDEBAR_LIFETIME_PORT = "browser-control-sidebar";
export const extensionVersionSchema = z.string().regex(/^\d+(?:\.\d+){0,3}$/);

export const extensionUpdateStateSchema = z.object({
  currentVersion: z.string(),
  availableVersion: extensionVersionSchema.nullable(),
  storeManaged: z.boolean(),
});
export type ExtensionUpdateState = z.infer<typeof extensionUpdateStateSchema>;

export const extensionUpdateCheckSchema = extensionUpdateStateSchema.extend({
  status: z.enum(["no_update", "throttled", "update_available", "unsupported"]),
});
export type ExtensionUpdateCheck = z.infer<typeof extensionUpdateCheckSchema>;

export function isNewerExtensionVersion(candidate: string, current: string): boolean {
  if (!extensionVersionSchema.safeParse(candidate).success || !extensionVersionSchema.safeParse(current).success) return false;
  const left = candidate.split(".").map(Number);
  const right = current.split(".").map(Number);
  for (let index = 0; index < 4; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}
