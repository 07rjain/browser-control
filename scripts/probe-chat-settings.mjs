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
  const pending = new Map(); const completions = new Map(); const waiting = new Map(); const events = [];
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
      if (message.type === "event") events.push(message);
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
    events,
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
  let offerRecording = false;
  let offerMemory = false;
  const offerCallId = "call-teaching-probe";
  const offer = { reason: "You asked to record a browser skill." };
  const provider = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw); bodies.push(body);
      if (offerMemory && !body.input.some((item) => item.type === "function_call_output" && item.call_id === "call-memory-probe")) {
        streamResponse(response, { id: "fc_memory_probe", type: "function_call", namespace: "memory", name: "propose_change", call_id: "call-memory-probe", arguments: JSON.stringify({ operation: "add", kind: "fact", text: "Favorite animal: otter", evidence: "favorite animal is an otter" }) }, body.model);
        return;
      }
      if (offerRecording && !body.input.some((item) => item.type === "function_call_output" && item.call_id === offerCallId)) {
        streamResponse(response, { id: "fc_teaching_probe", type: "function_call", namespace: "skills", name: "offer_recording", call_id: offerCallId, arguments: JSON.stringify(offer) }, body.model);
        return;
      }
      streamResponse(response, { id: `msg_${randomUUID()}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Prompt check complete.", annotations: [] }] }, body.model);
    });
  });
  let client;
  try {
    await new Promise((resolve, reject) => { provider.once("error", reject); provider.listen(0, "127.0.0.1", resolve); });
    writeFileSync(join(home, "config.toml"), `model = "gpt-6.1-sol"\nmodel_provider = "probe"\n[model_providers.probe]\nname = "probe"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\nwire_api = "responses"\nsupports_websockets = false\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`);
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
      const userText = "Reply with Prompt check complete. Do not use tools.";
      const result = await client.request("chat.send", {
        threadId, clientMessageId: randomUUID(), userText,
        text: `${userText}\nLEGACY_FALLBACK_MUST_NOT_DUPLICATE_CONTEXT`,
        pageContext: { title: "Probe page", url: "https://example.com/", selectedText: "", readableText: "STRUCTURED_PAGE_PROBE" },
      });
      assert.equal((await client.finished(result.turnId)).status, "completed");
      assert.equal(bodies.length, before + 1);
      const body = bodies.at(-1);
      const latestUserInput = body.input.filter((item) => item.type === "message" && item.role === "user").at(-1);
      const userParts = latestUserInput.content.map((part) => part.text).join("\n");
      assert.ok(userParts.includes(userText), "The raw user intent must reach Codex");
      assert.equal(userParts.split("STRUCTURED_PAGE_PROBE").length - 1, 1, "Current companions must include the structured page exactly once");
      assert.ok(!userParts.includes("LEGACY_FALLBACK_MUST_NOT_DUPLICATE_CONTEXT"), "Current companions must ignore the compatibility text copy");
      const developerText = body.input.filter((item) => item.type === "message" && item.role === "developer").flatMap((item) => item.content.map((part) => part.text));
      assert.ok(developerText.includes(prompt), "Codex must receive the saved prompt verbatim as instructions");
      assert.equal(body.model, "gpt-6.1-sol");
      assert.match(JSON.stringify(body.input), /Do not access local files/);
      assert.match(developerText.join("\n"), /When the user explicitly asks to create, teach, or record a browser skill/);
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
    offerRecording = true;
    const beforeOffer = bodies.length;
    const offeredTurn = await client.request("chat.send", { threadId: reset.threadId, clientMessageId: randomUUID(), text: "Help me record a skill" });
    assert.equal((await client.finished(offeredTurn.turnId)).status, "completed");
    assert.equal(bodies.length, beforeOffer + 2, "Codex must receive the dynamic tool result and finish its response");
    const offers = client.events.filter((event) => event.event === "skill.recordingOffered");
    assert.equal(offers.length, 1);
    assert.deepEqual(offers[0].data, { threadId: reset.threadId, turnId: offeredTurn.turnId, callId: offerCallId, ...offer, description: "" });
    const result = bodies.at(-1).input.find((item) => item.type === "function_call_output" && item.call_id === offerCallId);
    assert.match(JSON.stringify(result), /Record skill button/);
    offerRecording = false;
    let memory = await client.request("memory.read");
    memory = await client.request("memory.write", { operation: "settings", identity: memory.identity, revision: memory.revision, enabled: true });
    await client.request("memory.write", { operation: "add", identity: memory.identity, revision: memory.revision, kind: "preference", text: "Prefer concise answers", pinned: true, expiresAt: null });
    const memoryChat = await client.request("chat.start", { model: "gpt-6.1-sol", memoryVersion: 1, memoryEnabled: true });
    offerMemory = true;
    const memoryTurn = await client.request("chat.send", { threadId: memoryChat.threadId, memoryVersion: 1, clientMessageId: randomUUID(), userText: "Remember my favorite animal is an otter" });
    assert.equal((await client.finished(memoryTurn.turnId)).status, "completed");
    const proposal = client.events.find((event) => event.event === "memory.proposed")?.data;
    assert.ok(proposal, "A real Codex dynamic call must reach the host memory tool");
    assert.match(JSON.stringify(bodies.at(-1).input), /Prefer concise answers/);
    assert.match(JSON.stringify(bodies.at(-1).input.find((item) => item.type === "function_call_output" && item.call_id === "call-memory-probe")), /saved.*false/);
    assert.equal((await client.request("memory.read")).records.length, 1);
    await client.request("memory.decide", { id: proposal.id, threadId: memoryChat.threadId, approved: true });
    assert.equal((await client.request("memory.read")).records.length, 2);
    offerMemory = false;
    const disabledChat = await client.request("chat.start", { model: "gpt-6.1-sol", memoryVersion: 1, memoryEnabled: true });
    const beforeDisable = await client.request("memory.read");
    await client.request("memory.write", { operation: "settings", identity: beforeDisable.identity, revision: beforeDisable.revision, enabled: false });
    const disabledTurn = await client.request("chat.send", { threadId: disabledChat.threadId, memoryVersion: 1, clientMessageId: randomUUID(), userText: "Reply exactly: memory disabled." });
    assert.equal((await client.finished(disabledTurn.turnId)).status, "completed");
    assert.doesNotMatch(JSON.stringify(bodies.at(-1).input), /Prefer concise answers/);
    await client.request("data.deleteAll");
    assert.equal(existsSync(join(home, "chat-settings.json")), false);
    assert.equal(existsSync(join(home, "memory.json")), false);
    assert.deepEqual(await client.request("chat.settingsRead"), defaults);
    return { newChat: true, existingChatPreserved: true, restart: true, fork: true, reset: true, invalidPrompts: true, deleteAll: true, modelRecordingOffer: true, memoryProtocol: true, requests: bodies.length };
  } finally {
    await client?.close();
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
    rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}
