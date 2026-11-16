// Exact-turn cancellation is shared by pending-send cancellation and Stop.
// In particular, older side panels can call both paths for the same turn.
export function createTurnInterrupts(interrupt, { now = Date.now, ttl = 10 * 60_000 } = {}) {
  const turns = new Map();
  const key = (threadId, turnId) => JSON.stringify([threadId, turnId]);
  function entry(threadId, turnId) {
    if (typeof threadId !== "string" || !threadId || typeof turnId !== "string" || !turnId) throw new Error("Stop requires an exact conversation and turn.");
    for (const [id, value] of turns) if (!value.pending && now() - value.updatedAt > ttl) turns.delete(id);
    const id = key(threadId, turnId);
    if (!turns.has(id)) turns.set(id, { updatedAt: now() });
    return turns.get(id);
  }
  return {
    started(threadId, turnId) { entry(threadId, turnId).known = true; },
    completed(threadId, turnId) {
      if (!turnId) return;
      Object.assign(entry(threadId, turnId), { known: true, completed: true, updatedAt: now() });
    },
    blocked(threadId, turnId) {
      const value = turns.get(key(threadId, turnId));
      return Boolean(value && (value.stopping || value.stopped || value.completed));
    },
    async stop(threadId, turnId) {
      const value = entry(threadId, turnId);
      if (value.pending) return value.pending;
      if (value.stopped || value.completed) return { stopped: true, alreadyFinished: true };
      value.stopping = true; // Reject late tools before issuing the interrupt.
      value.updatedAt = now();
      value.pending = Promise.resolve().then(() => interrupt(threadId, turnId)).then(() => {
        value.stopped = true;
        return { stopped: true };
      }, (error) => {
        // Codex can finish between the click and the RPC. Only an exact,
        // observed turn's no-active-turn response is a benign completion race.
        if (value.known && /\bno active turn to interrupt\b/i.test(error.message)) {
          value.stopped = true;
          return { stopped: true, alreadyFinished: true };
        }
        throw error;
      }).finally(() => { value.pending = null; value.updatedAt = now(); });
      return value.pending;
    },
    clear() { turns.clear(); },
  };
}
