import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { APP_SERVER_ARGS } from "../bridge/codex-launch.mjs";
import { CODEX_THREAD_RESTRICTIONS, JsonLineDecoder } from "../bridge/protocol.mjs";
import { streamResponse } from "./probe-responses.mjs";
import { createApprovalReviewer, REVIEW_MODEL } from "../bridge/approval-reviewer.mjs";


export async function probeReviewerConcurrency(codexBinary = "codex") {
  const home = mkdtempSync(join(tmpdir(), "browser-control-reviewer-probe-"));
  const workspace = join(home, "workspace"); mkdirSync(workspace);
  const bodies = [];
  let parentCalled = false;
  const provider = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw); bodies.push(body);
      const review = body.text?.format?.type === "json_schema";
      if (!review && !parentCalled) {
        parentCalled = true;
        streamResponse(response, { id: "fc_parent", type: "function_call", namespace: "tabs", name: "list", call_id: "call_parent", arguments: "{}" }, body.model);
      } else {
        const text = review ? JSON.stringify({ decision: "approve", risk: "low", matchesUserRequest: true, missingContext: false, reasonCode: "requested_benign_search", reason: "Matches the public search request." }) : "Parent complete.";
        streamResponse(response, { id: `msg_${randomUUID()}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }, body.model);
      }
    });
  });
  await new Promise((resolve, reject) => { provider.once("error", reject); provider.listen(0, "127.0.0.1", resolve); });
  writeFileSync(join(home, "config.toml"), `model = "gpt-6.1-sol"\nmodel_provider = "probe"\n[model_providers.probe]\nname = "probe"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`);
  const child = spawn(codexBinary, [...APP_SERVER_ARGS], { env: { ...process.env, CODEX_HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map(); const decoder = new JsonLineDecoder(); let next = 1;
  let parentTool; let resolveTool;
  const toolReady = new Promise((resolve) => { resolveTool = resolve; });
  let resolveParent; const parentFinished = new Promise((resolve) => { resolveParent = resolve; });
  const write = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Probe timed out: ${method}`)); }, 10_000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    write({ id, method, params });
  });
  const reviewer = createApprovalReviewer({ request, workspace });
  const reviewNotifications = [];
  const mainNotifications = [];
  child.stdout.on("data", (chunk) => {
    for (const message of decoder.push(chunk)) {
      if (message.id !== undefined && !message.method) {
        const waiter = pending.get(message.id); pending.delete(message.id);
        if (message.error) waiter?.reject(new Error(JSON.stringify(message.error))); else waiter?.resolve(message.result);
        continue;
      }
      if (reviewer.handle(message)) { reviewNotifications.push(message.method); continue; }
      if (message.method === "item/tool/call") { parentTool = message; resolveTool(); }
      else { mainNotifications.push(message); if (message.method === "turn/completed") resolveParent(message); }
    }
  });
  const deadline = (promise) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Parent tool not ready. Events: ${mainNotifications.map((m) => m.method).join(", ")}`)), 12_000); promise.then((value) => { clearTimeout(timer); resolve(value); }, reject); });
  try {
    const info = await request("initialize", { clientInfo: { name: "browser-control-reviewer-probe", version: "0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
    write({ method: "initialized", params: {} });
    const started = await request("thread/start", { cwd: workspace, runtimeWorkspaceRoots: [workspace], ...CODEX_THREAD_RESTRICTIONS, ephemeral: true, model: "gpt-6.1-sol", approvalPolicy: "never", sandbox: "read-only", baseInstructions: "Use tabs.list once.", dynamicTools: [{ type: "namespace", name: "tabs", description: "Probe only", tools: [{ type: "function", name: "list", description: "List test tabs", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] }] });
    const parent = await request("turn/start", { threadId: started.thread.id, input: [{ type: "text", text: "List test tabs.", text_elements: [] }] });
    await deadline(toolReady);
    const reviewModels = [REVIEW_MODEL, "gpt-6.1-sol"];
    const customPrompt = "Review only explicit benign search actions. Ask the user for everything else. CUSTOM_REVIEWER_PROMPT_PROBE.";
    for (const model of reviewModels) {
      const result = await reviewer.review({ reviewId: randomUUID(), parentThreadId: started.thread.id, parentTurnId: parent.turn.id, model, systemPrompt: customPrompt, evidence: { policyVersion: 1, category: "search", userInstruction: "Search for browser control", action: { namespace: "page", tool: "submit", arguments: {} }, page: { tabId: 1, origin: "https://example.com" }, untrustedTarget: { label: "Search", value: "browser control" } } });
      if (result.decision !== "approve") throw new Error(`Concurrent review failed: ${JSON.stringify(result)}`);
      const body = bodies.filter((entry) => entry.text?.format?.type === "json_schema").at(-1);
      if (!body || body.model !== model || (body.tools ?? []).length || !JSON.stringify(body).includes(customPrompt)) throw new Error("Reviewer model/prompt/structured-output/tool isolation failed.");
      if (mainNotifications.some((m) => m.method === "turn/completed")) throw new Error("Review completed the parent turn before its tool response.");
    }
    write({ id: parentTool.id, result: { success: true, contentItems: [{ type: "inputText", text: "Probe tool result; no browser action executed." }] } });
    const finished = await deadline(parentFinished);
    if (finished.params.turn.status !== "completed") throw new Error("Parent did not complete.");
    if (!reviewNotifications.includes("turn/completed") || bodies.filter((body) => body.model !== REVIEW_MODEL && body.model !== "gpt-6.1-sol").length) throw new Error("Model or notification routing changed.");
    const countRollouts = (path) => { try { return readdirSync(path, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? countRollouts(join(path, entry.name)) : entry.name.endsWith(".jsonl") ? 1 : 0), 0); } catch { return 0; } };
    if (countRollouts(join(home, "sessions"))) throw new Error("Ephemeral reviews wrote a rollout.");
    return { version: info.userAgent, structuredOutput: true, concurrent: true, tools: [], ephemeral: true, models: reviewModels, customPrompt: true };
  } finally {
    reviewer.close();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
      const force = setTimeout(() => child.kill("SIGKILL"), 1000);
      child.kill("SIGTERM");
      await exited;
      clearTimeout(force);
    }
    for (const waiter of pending.values()) waiter.reject(new Error("Probe finished.")); pending.clear();
    await new Promise((resolve) => provider.close(resolve));
    rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}
