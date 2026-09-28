import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { encodeNativeMessage, LengthPrefixedJsonDecoder } from "../bridge/protocol.mjs";
import { chromeLikePath, companionLayout } from "./host-paths.mjs";

const launcher = companionLayout(process.platform, homedir(), process.env, "0.0.0").launcherPath;
const host = spawn(launcher, [], {
  env: {
    HOME: homedir(),
    USERPROFILE: homedir(),
    PATH: chromeLikePath(process.platform),
    TMPDIR: process.env.TMPDIR ?? process.env.TEMP ?? "/tmp",
    TEMP: process.env.TEMP,
    SystemRoot: process.env.SystemRoot,
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const decoder = new LengthPrefixedJsonDecoder();
const pending = new Map();
let stderr = "";

host.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
});
host.stdout.on("data", (chunk) => {
  for (const message of decoder.push(chunk)) {
    if (message.type !== "response") continue;
    const handler = pending.get(message.id);
    if (!handler) continue;
    pending.delete(message.id);
    if (message.ok) handler.resolve(message.data);
    else handler.reject(new Error(message.error));
  }
});

function request(method) {
  const id = crypto.randomUUID();
  host.stdin.write(encodeNativeMessage({ type: "request", id, method }));
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => rejectRequest(new Error(`Timed out: ${method}\n${stderr}`)), 15_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolveRequest(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        rejectRequest(error);
      },
    });
  });
}

try {
  const status = await request("bridge.status");
  await request("account.read");
  const catalog = await request("models.list");
  if (status.connected !== true) throw new Error("Installed host did not connect.");
  if (!Array.isArray(catalog.models)) throw new Error("Installed host returned an invalid model catalog.");
  process.stdout.write("Installed native host passed a Chrome-like environment smoke test.\n");
} finally {
  host.kill("SIGTERM");
}
