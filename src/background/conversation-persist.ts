import {
  mergeSidebarState,
  messageTextSize,
  readStoredSidebarState,
  SIDEBAR_STATE_STORAGE_KEY,
  type ConversationSnapshot,
} from "../shared/conversation-state";

let epoch = 0;
let clearedAt = 0;
let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task, task);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; message?: unknown };
  const name = typeof record.name === "string" ? record.name : "";
  const message = typeof record.message === "string" ? record.message : "";
  return name === "QuotaExceededError" || /quota/i.test(message);
}

function withoutDuplicateTranscript(state: ConversationSnapshot): ConversationSnapshot | null {
  const current = state.conversationHistory.find((item) => item.id === state.currentConversationId);
  if (!current || state.messages.length === 0) return null;
  if (messageTextSize(current.messages) < messageTextSize(state.messages)) return null;
  return { ...state, messages: [] };
}

async function writeState(state: ConversationSnapshot, capturedEpoch: number, savedAt: number): Promise<void> {
  let candidate = state;
  let droppedDuplicate = false;
  for (;;) {
    if (capturedEpoch !== epoch || savedAt <= clearedAt) return;
    try {
      await chrome.storage.local.set({ [SIDEBAR_STATE_STORAGE_KEY]: candidate });
      return;
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      if (!droppedDuplicate) {
        const smaller = withoutDuplicateTranscript(candidate);
        if (smaller) {
          droppedDuplicate = true;
          candidate = smaller;
          continue;
        }
      }
      if (candidate.conversationHistory.length <= 1) {
        throw new Error("This conversation could not be saved because browser storage is full.");
      }
      const keep = Math.max(1, Math.floor(candidate.conversationHistory.length / 2));
      candidate = { ...candidate, conversationHistory: candidate.conversationHistory.slice(0, keep) };
    }
  }
}

async function writeMerged(snapshot: ConversationSnapshot, capturedEpoch: number): Promise<void> {
  if (capturedEpoch !== epoch || snapshot.savedAt <= clearedAt) return;
  const stored = await chrome.storage.local.get(SIDEBAR_STATE_STORAGE_KEY);
  if (capturedEpoch !== epoch || snapshot.savedAt <= clearedAt) return;
  const merged = mergeSidebarState(readStoredSidebarState(stored[SIDEBAR_STATE_STORAGE_KEY]), snapshot);
  await writeState(merged, capturedEpoch, snapshot.savedAt);
}

export function saveConversationSnapshot(snapshot: ConversationSnapshot): Promise<{ saved: boolean }> {
  const capturedEpoch = epoch;
  const discardedBefore = clearedAt;
  return enqueue(() => writeMerged(snapshot, capturedEpoch))
    .then(() => ({ saved: capturedEpoch === epoch && snapshot.savedAt > discardedBefore }));
}

export function clearConversationStore(): Promise<{ cleared: true }> {
  epoch += 1;
  clearedAt = Date.now();
  const capturedEpoch = epoch;
  return enqueue(async () => {
    if (capturedEpoch !== epoch) return;
    await chrome.storage.local.remove(SIDEBAR_STATE_STORAGE_KEY);
  }).then(() => ({ cleared: true }));
}
