import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_SERVER_ARGS } from "../bridge/codex-launch.mjs";
import { CODEX_THREAD_RESTRICTIONS, JsonLineDecoder } from "../bridge/protocol.mjs";

// Built-in tools Codex may still offer once CODEX_THREAD_RESTRICTIONS apply.
// request_user_input server requests are rejected by the native host, and
// apply_patch has no thread-level switch; the read-only sandbox blocks its writes.
const ALLOWED_BUILT_IN_TOOLS = new Set(["request_user_input", "apply_patch"]);
// A thread created before the restrictions keeps the multi-agent tool it was
// created with, directly or through tool_search; no override clears it.
const ALLOWED_LEGACY_RESUME_TOOLS = new Set([...ALLOWED_BUILT_IN_TOOLS, "tool_search", "multi_agent_v1"]);
const DYNAMIC_NAMESPACE = "tabs";
const PROBE_MODELS = ["gpt-5.5", "probe-unknown-model"];

function toolNames(body) {
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  return tools.map((tool) => tool.name ?? tool.type ?? "unnamed");
}

async function withFakeProvider(run) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        requests.push(JSON.parse(body));
      } catch {
        requests.push(null);
      }
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "probe provider", type: "invalid_request_error" } }));
    });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  try {
    return await run(server.address().port, requests);
  } finally {
    server.close();
  }
}

function startAppServer(codexBinary, home, args) {
  const child = spawn(codexBinary, args, {
    env: { ...process.env, CODEX_HOME: home },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const decoder = new JsonLineDecoder();
  const pending = new Map();
  const turnWaiters = [];
  let nextId = 1;
  child.stdout.on("data", (chunk) => {
    for (const message of decoder.push(chunk)) {
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      } else if (message.method === "turn/completed" || message.method === "error") {
        turnWaiters.shift()?.();
      }
    }
  });
  const request = (method, params) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++;
    const timeout = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`Timed out: ${method}`));
    }, 15_000);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      if (message.error) rejectRequest(new Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolveRequest(message.result);
    });
    child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
  });
  const notify = (method, params) => child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  const turnFinished = () => new Promise((resolveTurn) => {
    const timeout = setTimeout(resolveTurn, 15_000);
    turnWaiters.push(() => {
      clearTimeout(timeout);
      resolveTurn();
    });
  });
  return { child, request, notify, turnFinished };
}

async function capturedTools(codexBinary, model, { resumeUnrestricted }) {
  return withFakeProvider(async (port, requests) => {
    const home = mkdtempSync(join(tmpdir(), "codex-tool-probe-"));
    const workspace = join(home, "workspace");
    mkdirSync(workspace);
    writeFileSync(join(home, "config.toml"), [
      `model = "${model}"`,
      `model_provider = "probe"`,
      `[model_providers.probe]`,
      `name = "probe"`,
      `base_url = "http://127.0.0.1:${port}/v1"`,
      `wire_api = "responses"`,
      `requires_openai_auth = false`,
      `request_max_retries = 0`,
      `stream_max_retries = 0`,
      "",
    ].join("\n"));
    const servers = [];
    const connect = async (args = APP_SERVER_ARGS) => {
      const server = startAppServer(codexBinary, home, [...args]);
      servers.push(server);
      await server.request("initialize", {
        clientInfo: { name: "browser-control-probe", title: "Browser Control probe", version: "0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      server.notify("initialized", {});
      return server;
    };
    try {
      const dynamicTools = [{
        type: "namespace",
        name: DYNAMIC_NAMESPACE,
        description: "Browser tabs",
        tools: [{
          type: "function",
          name: "open",
          description: "Open a tab",
          inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
        }],
      }];
      const base = {
        cwd: workspace,
        runtimeWorkspaceRoots: [workspace],
        approvalPolicy: "never",
        sandbox: "read-only",
        baseInstructions: "probe",
        developerInstructions: "probe",
      };
      const restricted = { ...base, ...CODEX_THREAD_RESTRICTIONS };
      const runTurn = async (server, threadId) => {
        const finished = server.turnFinished();
        await server.request("turn/start", {
          threadId,
          input: [{ type: "text", text: "probe", text_elements: [] }],
          approvalPolicy: "never",
        });
        await finished;
      };
      let threadId;
      let server;
      if (resumeUnrestricted) {
        // A chat created by an unrestricted companion, reopened after the
        // restricted companion starts its app-server.
        server = await connect(["app-server", "--stdio"]);
        const started = await server.request("thread/start", { ...base, ephemeral: false, historyMode: "legacy", dynamicTools });
        threadId = started.thread.id;
        await runTurn(server, threadId);
        server.child.kill("SIGTERM");
        await new Promise((resolveExit) => server.child.once("exit", resolveExit));
        requests.length = 0;
        server = await connect();
        await server.request("thread/resume", { threadId, ...restricted, excludeTurns: true, dynamicTools });
      } else {
        server = await connect();
        const started = await server.request("thread/start", { ...restricted, ephemeral: true, dynamicTools });
        threadId = started.thread.id;
      }
      await runTurn(server, threadId);
      const bodies = requests.filter((body) => body && Array.isArray(body.tools));
      if (bodies.length === 0) throw new Error(`Codex sent no model request for ${model}.`);
      return [...new Set(bodies.flatMap(toolNames))];
    } finally {
      for (const server of servers) server.child.kill("SIGTERM");
      rmSync(home, { recursive: true, force: true });
    }
  });
}

export async function probeCodexTools(codexBinary) {
  const results = [];
  for (const model of PROBE_MODELS) {
    for (const resumeUnrestricted of [false, true]) {
      const names = await capturedTools(codexBinary, model, { resumeUnrestricted });
      const allowed = resumeUnrestricted ? ALLOWED_LEGACY_RESUME_TOOLS : ALLOWED_BUILT_IN_TOOLS;
      const unexpected = names.filter((name) => name !== DYNAMIC_NAMESPACE && !allowed.has(name));
      const label = `${model}${resumeUnrestricted ? " (resumed)" : ""}`;
      if (!names.includes(DYNAMIC_NAMESPACE)) throw new Error(`${label}: dynamic browser tools were not offered.`);
      if (unexpected.length > 0) throw new Error(`${label}: Codex still offered built-in tools ${unexpected.join(", ")}.`);
      results.push({ label, names });
    }
  }
  return results;
}
