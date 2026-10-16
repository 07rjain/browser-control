import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { encodeNativeMessage, LengthPrefixedJsonDecoder } from "../bridge/protocol.mjs";
import { streamResponse } from "./probe-responses.mjs";
import { stopProbeProcess } from "./probe-process.mjs";

function nativeClient(home, codexBinary) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../bridge/native-host.mjs", import.meta.url))], {
    env: { ...process.env, BROWSER_CONTROL_TEST_HOME: "1", CODEX_SIDEBAR_HOME: home, CODEX_BIN: codexBinary }, stdio: ["pipe", "pipe", "pipe"],
  });
  const decoder = new LengthPrefixedJsonDecoder();
  const pending = new Map(); const completions = new Map(); const waiting = new Map();
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  function bounded(map, key, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { map.delete(key); reject(new Error(`Chat settings probe timed out: ${label}. ${stderr}`)); }, 12_000);
      map.set(key, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    });
  }
  child.on("error", (error) => { for (const item of [...pending.values(), ...waiting.values()]) item.reject(error); });
  child.on("exit", () => { for (const item of [...pending.values(), ...waiting.values()]) item.reject(new Error(`Native host exited. ${stderr}`)); });
  child.stdout.on("data", (chunk) => {
    for (const message of decoder.push(chunk)) {
      if (message.type === "response") {
        const request = pending.get(message.id); pending.delete(message.id);
        if (message.ok) request?.resolve(message.data); else request?.reject(new Error(message.error));
      }
      if (message.type === "event" && message.event === "chat.turnCompleted") {
        const turn = message.data.turn; completions.set(turn.id, turn);
        waiting.get(turn.id)?.resolve(turn); waiting.delete(turn.id);
      }
    }
  });
  return {
    request(method, params) {
      const id = randomUUID(); const result = bounded(pending, id, method);
      child.stdin.write(encodeNativeMessage({ type: "request", id, method, params }));
      return result;
    },
    finished: (id) => completions.has(id) ? Promise.resolve(completions.get(id)) : bounded(waiting, id, id),
    async close() {
      await stopProbeProcess(child);
    },
  };
}

// Real companion + real Codex protocol; all inference goes to this local fixture.
export async function probeChatSettings(codexBinary) {
  const home = mkdtempSync(join(tmpdir(), "codex-sidebar-smoke-chat-settings-"));
  const bodies = [];
  const provider = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw); bodies.push(body);
      streamResponse(response, { id: `msg_${randomUUID()}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Prompt check complete.", annotations: [] }] }, body.model);
    });
  });
  let client;
  try {
    await new Promise((resolve, reject) => { provider.once("error", reject); provider.listen(0, "127.0.0.1", resolve); });
    writeFileSync(join(home, "config.toml"), `model = "gpt-6.1-sol"\nmodel_provider = "probe"\n[model_providers.probe]\nname = "probe"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`);
    client = nativeClient(home, codexBinary);
    const defaults = await client.request("chat.settingsRead");
    assert.equal(defaults.version, 1);
    assert.match(defaults.systemPrompt, /^You are Browser Control/);
    const custom = "  Answer clearly.\nMAIN_PROMPT_FIRST_CHECK.  ";
    const updated = "  Use concise replies.\nMAIN_PROMPT_UPDATED_CHECK.  ";
    await client.request("chat.settingsWrite", { version: 1, systemPrompt: custom });
    for (const settings of [{ version: 2, systemPrompt: custom }, ...["", "  ", "x".repeat(12001), "bad\0prompt"].map((systemPrompt) => ({ version: 1, systemPrompt }))]) {
      await assert.rejects(client.request("chat.settingsWrite", settings), /non-empty main system prompt/);
    }
    assert.equal((await client.request("chat.settingsRead")).systemPrompt, custom);
    const started = await client.request("chat.start", { model: "gpt-6.1-sol" });
    const send = async (threadId, prompt) => {
      const before = bodies.length;
      const result = await client.request("chat.send", { threadId, clientMessageId: randomUUID(), text: "Reply with Prompt check complete. Do not use tools." });
      assert.equal((await client.finished(result.turnId)).status, "completed");
      assert.equal(bodies.length, before + 1);
      const body = bodies.at(-1);
      const developerText = body.input.filter((item) => item.type === "message" && item.role === "developer").flatMap((item) => item.content.map((part) => part.text));
      assert.ok(developerText.includes(prompt), "Codex must receive the saved prompt verbatim as instructions");
      assert.equal(body.model, "gpt-6.1-sol");
      assert.match(JSON.stringify(body.input), /Do not access local files/);
      return result.turnId;
    };
    const firstTurn = await send(started.threadId, custom);
    const beforeSave = bodies.length;
    await client.request("chat.settingsWrite", { version: 1, systemPrompt: updated });
    assert.equal(bodies.length, beforeSave, "Saving must not start inference");
    await send(started.threadId, custom);
    await client.close(); client = nativeClient(home, codexBinary);
    assert.equal((await client.request("chat.settingsRead")).systemPrompt, updated);
    assert.equal(JSON.parse(readFileSync(join(home, "chat-settings.json"), "utf8")).systemPrompt, updated);
    await client.request("chat.resume", { threadId: started.threadId });
    await send(started.threadId, custom);
    const next = await client.request("chat.start", { model: "gpt-6.1-sol" });
    await send(next.threadId, updated);
    const fork = await client.request("chat.fork", { threadId: started.threadId, lastTurnId: firstTurn });
    await send(fork.threadId, updated);
    await client.request("chat.settingsWrite", defaults);
    const reset = await client.request("chat.start", { model: "gpt-6.1-sol" });
    await send(reset.threadId, defaults.systemPrompt);
    await client.request("data.deleteAll");
    assert.equal(existsSync(join(home, "chat-settings.json")), false);
    assert.deepEqual(await client.request("chat.settingsRead"), defaults);
    return { newChat: true, existingChatPreserved: true, restart: true, fork: true, reset: true, invalidPrompts: true, deleteAll: true, requests: bodies.length };
  } finally {
    await client?.close();
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
    rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}
