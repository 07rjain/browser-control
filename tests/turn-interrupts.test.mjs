import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createTurnInterrupts } from "../bridge/turn-interrupts.mjs";
import { createChatInputService } from "../bridge/chat-input.mjs";
import { createUploadStore } from "../bridge/uploads.mjs";

let root;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

it("coalesces accepted-send cancellation and Stop while a tool is pending", async () => {
  root = mkdtempSync(join(tmpdir(), "stop-turn-"));
  let finishInterrupt;
  let running = true;
  const rpc = vi.fn(() => {
    if (!running) return Promise.reject(new Error("no active turn to interrupt"));
    running = false;
    return new Promise(resolve => { finishInterrupt = resolve; });
  });
  const turns = createTurnInterrupts(rpc);
  turns.started("thread", "turn");
  const inputs = createChatInputService(join(root, "sends"), createUploadStore(join(root, "uploads")), {
    assertRestricted: () => {}, startTurn: async () => ({ turn: { id: "turn" } }), interrupt: turns.stop,
  });
  const params = { threadId: "thread", clientMessageId: randomUUID(), userText: "Fill five disposable customers" };
  await inputs.send(params);
  const cancel = inputs.cancel(params);
  const stop = turns.stop("thread", "turn");
  expect(turns.blocked("thread", "turn")).toBe(true);
  await Promise.resolve();
  expect(rpc).toHaveBeenCalledTimes(1);
  turns.completed("thread", "turn");
  finishInterrupt({});
  await expect(cancel).resolves.toEqual({ canceled: true });
  await expect(stop).resolves.toMatchObject({ stopped: true });
  await turns.stop("thread", "turn");
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(turns.blocked("thread", "new-turn")).toBe(false);
});

it("treats completion racing Stop as success without retargeting a newer turn", async () => {
  const rpc = vi.fn(async () => { throw new Error("no active turn to interrupt"); });
  const turns = createTurnInterrupts(rpc);
  turns.started("thread", "old");
  turns.started("thread", "new");
  await expect(turns.stop("thread", "old")).resolves.toMatchObject({ stopped: true });
  expect(rpc.mock.calls).toEqual([["thread", "old"]]);
  expect(turns.blocked("thread", "new")).toBe(false);
  turns.completed("thread", "new");
  await turns.stop("thread", "new");
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("propagates real failures and allows retry, preserving the tool barrier", async () => {
  const rpc = vi.fn().mockRejectedValueOnce(new Error("App Server disconnected")).mockResolvedValue({});
  const turns = createTurnInterrupts(rpc);
  turns.started("thread", "turn");
  await expect(turns.stop("thread", "turn")).rejects.toThrow(/disconnected/);
  expect(turns.blocked("thread", "turn")).toBe(true);
  await expect(turns.stop("thread", "turn")).resolves.toMatchObject({ stopped: true });
  expect(rpc).toHaveBeenCalledTimes(2);
  await expect(turns.stop("thread", undefined)).rejects.toThrow(/exact/);
});

it("does not hide unknown-turn errors and expires old tombstones", async () => {
  let clock = 0;
  const rpc = vi.fn(async () => { throw new Error("no active turn to interrupt"); });
  const turns = createTurnInterrupts(rpc, { now: () => clock, ttl: 100 });
  await expect(turns.stop("thread", "unknown")).rejects.toThrow(/no active/);
  turns.completed("thread", "old");
  // A delayed turn/start response must not resurrect a completed turn.
  turns.started("thread", "old");
  expect(turns.blocked("thread", "old")).toBe(true);
  clock = 101;
  turns.started("thread", "new");
  expect(turns.blocked("thread", "old")).toBe(false);
  turns.clear();
  expect(turns.blocked("thread", "unknown")).toBe(false);
});
