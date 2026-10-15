import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

export const LEGACY_THREAD_ERROR =
  "This chat was created before Browser Control limited Codex's built-in tools, so it can no longer be continued.";

const MAX_RESTRICTED_THREADS = 2_000;

// Codex keeps a thread's original tool set when it is resumed, so only threads
// this companion started or forked under CODEX_THREAD_RESTRICTIONS may continue.
export function createRestrictedThreadRegistry(filePath) {
  const read = () => {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8"));
      return Array.isArray(parsed?.threadIds) ? parsed.threadIds.filter((id) => typeof id === "string") : [];
    } catch {
      return [];
    }
  };
  const has = (threadId) => typeof threadId === "string" && threadId.length > 0 && read().includes(threadId);
  return {
    has,
    add(threadId) {
      if (typeof threadId !== "string" || threadId.length === 0) throw new Error("Codex returned an invalid thread ID.");
      const threadIds = [...read().filter((id) => id !== threadId), threadId].slice(-MAX_RESTRICTED_THREADS);
      const temporaryPath = `${filePath}.tmp`;
      rmSync(temporaryPath, { force: true });
      writeFileSync(temporaryPath, JSON.stringify({ version: 1, threadIds }), { mode: 0o600 });
      renameSync(temporaryPath, filePath);
    },
    assertRestricted(threadId) {
      if (!has(threadId)) throw new Error(LEGACY_THREAD_ERROR);
    },
  };
}
