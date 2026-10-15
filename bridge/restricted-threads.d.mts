export const LEGACY_THREAD_ERROR: string;

export interface RestrictedThreadRegistry {
  has(threadId: unknown): boolean;
  add(threadId: string): void;
  assertRestricted(threadId: unknown): void;
}

export function createRestrictedThreadRegistry(filePath: string): RestrictedThreadRegistry;
