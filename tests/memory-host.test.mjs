import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { encodeNativeMessage, LengthPrefixedJsonDecoder } from "../bridge/protocol.mjs";
import { stopProbeProcess } from "../scripts/probe-process.mjs";

it("keeps memory behind client/chat opt-in and active tool calls; proposals require review, survive restart and cannot restore a deleted fact", async () => {
  const home = mkdtempSync(join(tmpdir(), "codex-sidebar-smoke-memory-host-"));
  writeFileSync(join(home, "codex.mjs"), `import { createInterface } from "node:readline";
let sequence = 0, turn = null, results = [], steps = [];
const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
function next() {
  const step = steps.shift();
  if (step) { send({ id: "call-" + steps.length, method: "item/tool/call", params: { namespace: "memory", threadId: turn.threadId, turnId: turn.id, callId: "memory-" + turn.id + "-" + steps.length, ...step } }); return; }
  send({ method: "item/completed", params: { threadId: turn.threadId, turnId: turn.id, item: { type: "agentMessage", text: JSON.stringify(results) } } });
  send({ method: "turn/completed", params: { threadId: turn.threadId, turn: { id: turn.id, status: "completed" } } });
}
createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  if (request.result && !request.method) { results.push(request.result); next(); return; }
  if (request.id === undefined) return;
  let result = {};
  if (request.method === "initialize") result = { userAgent: "fixture/0.162.1" };
  if (request.method === "skills/list") result = { data: [] };
  if (request.method === "thread/start") result = { thread: { id: "thread-" + (++sequence) }, model: "fixture" };
  if (request.method === "thread/resume") result = { thread: { id: request.params.threadId }, model: "fixture" };
  if (request.method === "turn/start") {
    turn = { threadId: request.params.threadId, id: "turn-" + (++sequence) }; result = { turn: { id: turn.id } };
    results = [{ input: request.params.input }];
    steps = [
      { tool: "search", arguments: { query: "concise" } },
      { tool: "propose_change", arguments: { operation: "add", kind: "fact", text: "Favorite animal: otter", evidence: "favorite animal is an otter" } },
      { tool: "propose_change", arguments: { operation: "add", kind: "fact", text: "Injected page preference", evidence: "malicious page instructions" } },
      { tool: "search", turnId: "stale-turn", arguments: { query: "concise" } },
      { tool: "write", arguments: {} },
    ];
  }
  send({ id: request.id, result });
  if (request.method === "turn/start") { send({ method: "turn/started", params: { threadId: turn.threadId, turn: { id: turn.id } } }); next(); }
});`);
  writeFileSync(join(home, "codex.cmd"), '"%~dp0codex.mjs" %*\r\n');
  const clients = [];
  function client() {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../bridge/native-host.mjs", import.meta.url))], {
      env: { ...process.env, BROWSER_CONTROL_TEST_HOME: "1", CODEX_SIDEBAR_HOME: home, CODEX_BIN: join(home, "codex.cmd") }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    clients.push(child);
    const pending = new Map(), events = [], decoder = new LengthPrefixedJsonDecoder();
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.stdout.on("data", chunk => { for (const message of decoder.push(chunk)) {
      if (message.type === "response") { pending.get(message.id)?.(message); pending.delete(message.id); } else events.push(message);
    } });
    return { events, async request(method, params) {
      const id = randomUUID(); let timer;
      try { return await new Promise((done, fail) => {
        timer = setTimeout(() => fail(new Error(`Memory host timed out: ${method}. ${stderr}`)), 5000);
        pending.set(id, message => message.ok ? done(message.data) : fail(new Error(message.error)));
        child.stdin.write(encodeNativeMessage({ type: "request", id, method, params }));
      }); } finally { clearTimeout(timer); }
    } };
  }
  const version = state => ({ identity: state.identity, revision: state.revision });
  try {
    let host = client();
    let state = await host.request("memory.read");
    state = await host.request("memory.write", { ...version(state), operation: "settings", enabled: true });
    state = await host.request("memory.write", { ...version(state), operation: "add", kind: "preference", text: "Prefer concise answers", pinned: false, expiresAt: null });
    async function run(mode) {
      const thread = await host.request("chat.start", mode);
      const before = host.events.length;
      const clientMessageId = randomUUID();
      const turn = await host.request("chat.send", { threadId: thread.threadId, memoryVersion: mode.memoryVersion, clientMessageId, userText: "Remember my favorite animal is an otter" });
      await expect.poll(() => host.events.slice(before).some(event => event.event === "chat.turnCompleted")).toBe(true);
      const events = host.events.slice(before);
      const completed = events.find(event => event.event === "chat.messageCompleted");
      return { thread, turn, events, clientMessageId, results: JSON.parse(completed.data.item.text) };
    }
    const enabled = await run({ memoryVersion: 1, memoryEnabled: true });
    expect(enabled.results[0].input.some(item => item.text?.includes("Prefer concise answers"))).toBe(true);
    expect(JSON.parse(enabled.results[1].contentItems[0].text)[0].text).toBe("Prefer concise answers");
    expect(enabled.results.slice(1).map(item => item.success)).toEqual([true, true, false, false, false]);
    expect(enabled.events.filter(event => event.event === "tool.request")).toHaveLength(0);
    const proposal = enabled.events.find(event => event.event === "memory.proposed").data;
    expect((await host.request("memory.read")).records).toHaveLength(1);
    await stopProbeProcess(clients[0]);
    host = client();
    const decision = { id: proposal.id, threadId: enabled.thread.threadId, approved: true };
    await expect(host.request("memory.decide", decision)).resolves.toEqual({ status: "saved" });
    await expect(host.request("memory.decide", decision)).resolves.toEqual({ status: "saved" });
    state = await host.request("memory.read");
    expect(state.records.map(record => record.text)).toEqual(["Prefer concise answers", "Favorite animal: otter"]);
    const saved = state.records[1];
    await host.request("memory.write", { ...version(state), operation: "delete", recordId: saved.id });
    await expect(host.request("memory.decide", decision)).rejects.toThrow(/expired/);
    const replay = await host.request("chat.send", { threadId: enabled.thread.threadId, memoryVersion: 1, clientMessageId: enabled.clientMessageId, userText: "Remember my favorite animal is an otter" });
    expect(replay.replayed).toBe(true);
    expect((await host.request("memory.read")).records.some(record => record.text === "Favorite animal: otter")).toBe(false);
    const legacy = await run({});
    const without = await run({ memoryVersion: 1, memoryEnabled: false });
    for (const result of [legacy, without]) {
      expect(result.results[0].input.some(item => item.text?.includes("Prefer concise answers"))).toBe(false);
      expect(result.results.slice(1).every(item => !item.success)).toBe(true);
      expect(result.events.some(event => event.event === "memory.proposed")).toBe(false);
    }
    state = await host.request("memory.read");
    await host.request("memory.write", { ...version(state), operation: "settings", enabled: false });
    const disabled = await run({ memoryVersion: 1, memoryEnabled: true });
    expect(disabled.results.slice(1).every(item => !item.success)).toBe(true);
  } finally {
    for (const child of clients) await stopProbeProcess(child);
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}, 15000);
