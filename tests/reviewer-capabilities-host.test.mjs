import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { encodeNativeMessage, LengthPrefixedJsonDecoder } from "../bridge/protocol.mjs";
import { stopProbeProcess } from "../scripts/probe-process.mjs";

it.each([
  ["0.162.1", true], ["0.164.0", true], ["0.165.0", true], ["0.161.0", false], ["0.166.0", false], ["unknown", false],
])("reports reviewer compatibility for CLI %s without inference and preserves action binding", async (version, available) => {
  const home = mkdtempSync(join(tmpdir(), "codex-sidebar-smoke-review-capability-"));
  writeFileSync(join(home, "codex.mjs"), `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result = {};
  if (message.method === "initialize") result = { userAgent: "fixture/${version}" };
  if (message.method === "skills/list") result = { data: [] };
  if (message.method === "thread/start") result = { thread: { id: "parent" }, model: "fixture" };
  if (message.method === "turn/start") throw new Error("Capability checking must not start inference");
  process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");
});`);
  writeFileSync(join(home, "codex.cmd"), '"%~dp0codex.mjs" %*\r\n');
  const child = spawn(process.execPath, [fileURLToPath(new URL("../bridge/native-host.mjs", import.meta.url))], {
    env: { ...process.env, BROWSER_CONTROL_TEST_HOME: "1", CODEX_SIDEBAR_HOME: home, CODEX_BIN: join(home, "codex.cmd") }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  const decoder = new LengthPrefixedJsonDecoder(), pending = new Map();
  child.stdout.on("data", chunk => { for (const message of decoder.push(chunk)) if (message.type === "response") { pending.get(message.id)?.(message); pending.delete(message.id); } });
  function request(method, params) {
    return new Promise((done, fail) => {
      const id = randomUUID(); const timer = setTimeout(() => fail(new Error(`Timed out: ${method}`)), 4000);
      pending.set(id, message => { clearTimeout(timer); if (message.ok) done(message.data); else fail(new Error(message.error)); });
      child.stdin.write(encodeNativeMessage({ type: "request", id, method, params }));
    });
  }
  try {
    const capability = await request("approval.capabilities");
    expect(capability.available).toBe(available);
    if (!available) expect(capability.reason).toContain(version);
    await request("chat.start", {});
    await expect(request("approval.reviewConfigured", { configurationVersion: 2, systemPrompt: "Review this action.", parentThreadId: "parent", parentTurnId: "turn", parentCallId: "not-pending" })).rejects.toThrow(available ? /no longer pending/ : /unavailable/);
  } finally {
    await stopProbeProcess(child);
    rmSync(home, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
});
