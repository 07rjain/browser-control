import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { encodeNativeMessage, LengthPrefixedJsonDecoder } from "../bridge/protocol.mjs";
import { stopProbeProcess } from "../scripts/probe-process.mjs";

it("accepts one model-owned offer per active turn without starting recording, and rejects malformed, foreign and late calls", async () => {
  const home = mkdtempSync(join(tmpdir(), "codex-sidebar-smoke-offer-"));
  const args = { reason: "Learning the board workflow would help.", description: "Arrange the example board." };
  const base = { threadId: "thread-offer", turnId: "turn-offer", namespace: "skills", tool: "offer_recording" };
  const steps = [
    { name: "inactive", arguments: args },
    { name: "empty", arguments: { ...args, reason: " " }, start: true },
    { name: "long-reason", arguments: { ...args, reason: "x".repeat(301) } },
    { name: "long-description", arguments: { ...args, description: "x".repeat(501) } },
    { name: "invalid-description", arguments: { ...args, description: 123 } },
    { name: "null", arguments: { ...args, reason: "bad\0text" } },
    { name: "extra", arguments: { ...args, path: "/unavailable" } },
    { name: "foreign", arguments: args, threadId: "reviewer-or-foreign" },
    { name: "stale", arguments: args, turnId: "old-turn" },
    { name: "accepted", arguments: JSON.stringify(args) },
    { name: "duplicate", arguments: { ...args, reason: "A duplicate should not replace the first offer." } },
    { name: "late", arguments: args, finish: true },
    { name: "requested", arguments: { reason: "You asked to record a browser skill." }, start: true, turnId: "turn-requested" },
  ];
  const fixture = `import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
const steps = ${JSON.stringify(steps)};
const base = ${JSON.stringify(base)};
const results = []; let next = 0;
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
function callNext() {
  const step = steps[next++];
  if (!step) {
    writeFileSync(process.env.OFFER_RESULTS, JSON.stringify(results));
    send({ method: "warning", params: { message: "Offer fixture finished" } }); return;
  }
  if (step.start) send({ method: "turn/started", params: { threadId: base.threadId, turn: { id: step.turnId || base.turnId } } });
  if (step.finish) send({ method: "turn/completed", params: { threadId: base.threadId, turn: { id: base.turnId, status: "completed" } } });
  send({ id: step.name, method: "item/tool/call", params: { ...base, ...step, callId: step.name } });
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.result && !request.method) { results.push({ id: request.id, success: request.result.success }); callNext(); return; }
  if (request.id === undefined) return;
  let result = {};
  if (request.method === "initialize") result = { userAgent: "fixture/0.162.1" };
  if (request.method === "skills/list") result = { data: [] };
  if (request.method === "thread/start") {
    writeFileSync(process.env.OFFER_TOOLS, JSON.stringify(request.params.dynamicTools));
    result = { thread: { id: base.threadId }, model: "fixture" };
  }
  if (request.method === "turn/start") result = { turn: { id: base.turnId } };
  send({ id: request.id, result });
  if (request.method === "turn/start") callNext();
});
`;
  writeFileSync(join(home, "codex.mjs"), fixture);
  writeFileSync(join(home, "codex.cmd"), '"%~dp0codex.mjs" %*\r\n');
  const host = spawn(process.execPath, [fileURLToPath(new URL("../bridge/native-host.mjs", import.meta.url))], {
    env: { ...process.env, BROWSER_CONTROL_TEST_HOME: "1", CODEX_SIDEBAR_HOME: home, CODEX_BIN: join(home, "codex.cmd"), OFFER_RESULTS: join(home, "results.json"), OFFER_TOOLS: join(home, "tools.json") },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  const decoder = new LengthPrefixedJsonDecoder();
  const events = []; const pending = new Map();
  let stderr = ""; let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  host.stderr.on("data", (chunk) => { stderr += chunk; });
  host.stdout.on("data", (chunk) => {
    for (const message of decoder.push(chunk)) {
      if (message.type === "response") { pending.get(message.id)?.(message); pending.delete(message.id); }
      else if (message.type === "event") {
        events.push(message);
        if (message.event === "bridge.warning" && message.data.message === "Offer fixture finished") finish();
      }
    }
  });
  let timeout;
  const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Offer fixture timed out. ${stderr}`)), 5_000); });
  const request = (method, params) => {
    const id = crypto.randomUUID();
    const reply = new Promise((resolve, reject) => pending.set(id, (message) => message.ok ? resolve(message.data) : reject(new Error(message.error))));
    host.stdin.write(encodeNativeMessage({ type: "request", id, method, params }));
    return Promise.race([reply, deadline]);
  };
  try {
    await request("chat.start", {});
    await request("chat.send", { threadId: base.threadId, clientMessageId: crypto.randomUUID(), text: "Arrange the board" });
    await Promise.race([done, deadline]);
    expect(events.filter((event) => event.event === "skill.recordingOffered")).toEqual([
      { type: "event", event: "skill.recordingOffered", data: { threadId: base.threadId, turnId: base.turnId, callId: "accepted", ...args } },
      { type: "event", event: "skill.recordingOffered", data: { threadId: base.threadId, turnId: "turn-requested", callId: "requested", reason: "You asked to record a browser skill.", description: "" } },
    ]);
    const replies = JSON.parse(readFileSync(join(home, "results.json"), "utf8"));
    expect(replies.filter((reply) => reply.success).map((reply) => reply.id)).toEqual(["accepted", "duplicate", "requested"]);
    expect(replies.filter((reply) => !reply.success).map((reply) => reply.id)).toEqual(["inactive", "empty", "long-reason", "long-description", "invalid-description", "null", "extra", "foreign", "stale", "late"]);
    expect(events.some((event) => ["tool.request", "recording.status"].includes(event.event))).toBe(false);
    expect(existsSync(join(home, "skills"))).toBe(false);
    const tools = JSON.parse(readFileSync(join(home, "tools.json"), "utf8"));
    expect(tools.find((tool) => tool.name === "skills").tools.find((tool) => tool.name === "offer_recording").inputSchema).toMatchObject({
      required: ["reason"], additionalProperties: false,
      properties: { reason: { maxLength: 300 }, description: { maxLength: 500 } },
    });
  } finally {
    clearTimeout(timeout);
    await stopProbeProcess(host);
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 10_000);
