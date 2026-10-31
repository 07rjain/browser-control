import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeNativeMessage, LengthPrefixedJsonDecoder } from "../bridge/protocol.mjs";
import { stopProbeProcess } from "./probe-process.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const platform = { darwin: "macos", linux: "linux", win32: "windows" }[process.platform];
const name = `browser-control-companion-${platform}-${version}`;
const archive = join(root, "release", `${name}.zip`);
const extracted = mkdtempSync(join(tmpdir(), "browser-control-package ü-"));
const home = mkdtempSync(join(tmpdir(), "codex-sidebar-smoke-package ü-"));
let child;
const pending = new Map();
let stderr = "";
try {
  if (process.platform === "win32") {
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    execFileSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(extracted)}`]);
  } else execFileSync("unzip", ["-q", archive, "-d", extracted]);
  child = spawn(process.execPath, [join(extracted, name, "bridge", "native-host.mjs")], {
    env: { ...process.env, BROWSER_CONTROL_TEST_HOME: "1", CODEX_SIDEBAR_HOME: home },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  const fail = (error) => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); };
  child.once("error", fail);
  child.once("exit", (code) => fail(new Error(`Packaged native host exited ${code}. ${stderr}`)));
  const decoder = new LengthPrefixedJsonDecoder();
  child.stdout.on("data", (chunk) => {
    for (const message of decoder.push(chunk)) {
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.ok) waiter.resolve(message.data); else waiter.reject(new Error(message.error));
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Packaged host timed out: ${method}. ${stderr}`)); }, 5000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    child.stdin.write(encodeNativeMessage({ type: "request", id, method, params }));
  });
  // No account or model request: exercise the extracted companion, its import
  // graph, prompt persistence and binary native-message transfer directly.
  assert.equal((await request("memory.capabilities")).version, 1);
  let memory = await request("memory.read");
  memory = await request("memory.write", { operation: "settings", identity: memory.identity, revision: memory.revision, enabled: true });
  memory = await request("memory.write", { operation: "add", identity: memory.identity, revision: memory.revision, kind: "preference", text: "Package memory: café\r\n🦦", pinned: false, expiresAt: null });
  assert.equal((await request("memory.read")).records[0].text, "Package memory: café\r\n🦦");
  assert.equal(JSON.parse(readFileSync(join(home, "memory.json"), "utf8")).records[0].text, "Package memory: café\r\n🦦");
  await request("memory.write", { operation: "delete", identity: memory.identity, revision: memory.revision, recordId: memory.records[0].id });
  assert.equal((await request("memory.read")).records.length, 0);
  const defaults = await request("chat.settingsRead");
  assert.match(defaults.systemPrompt, /^You are Browser Control/);
  const prompt = "  Preserve these exact bytes.\r\nUnicode: café.  ";
  await request("chat.settingsWrite", { version: 1, systemPrompt: prompt });
  assert.equal((await request("chat.settingsRead")).systemPrompt, prompt);
  assert.equal(JSON.parse(readFileSync(join(home, "chat-settings.json"), "utf8")).systemPrompt, prompt);
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==", "base64");
  const owner = randomUUID();
  const upload = await request("attachments.request", { operation: "begin", owner, bytes: bytes.length, mime: "image/png", sha256: createHash("sha256").update(bytes).digest("hex") });
  await request("attachments.request", { operation: "chunk", id: upload.id, owner, offset: 0, data: bytes.toString("base64") });
  await request("attachments.request", { operation: "finalize", id: upload.id, owner });
  const result = await request("attachments.request", { operation: "read", id: upload.id, owner, offset: 0 });
  assert.deepEqual(Buffer.from(result.data, "base64"), bytes);
  await request("attachments.request", { operation: "abort", owner });
  assert.deepEqual(readdirSync(join(home, "uploads")).filter((entry) => !entry.startsWith("aborted-")), []);
  process.stdout.write(`Packaged companion passed on ${process.platform}: native imports, memory CRUD, prompt bytes, image transfer and cancellation; no account inference.\n`);
} finally {
  if (child) await stopProbeProcess(child);
  for (const waiter of pending.values()) waiter.reject(new Error("Package probe finished."));
  rmSync(extracted, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
