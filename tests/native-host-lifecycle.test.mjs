import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { encodeNativeMessage, LengthPrefixedJsonDecoder } from "../bridge/protocol.mjs";

it("waits for Codex to stop on native stdin EOF, including an npm shim in a path with spaces and Unicode", async () => {
  const home = mkdtempSync(join(tmpdir(), "codex-sidebar-smoke-path ü-"));
  const script = join(home, "codex.mjs");
  const shim = join(home, "codex.cmd");
  const pidFile = join(home, "child-pid");
  let host;
  let pid;
  let timeout;
  try {
    writeFileSync(script, `import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
writeFileSync(process.env.FIXTURE_PID_FILE, String(process.pid));
process.on("SIGTERM", () => setTimeout(() => process.exit(0), 300));
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id !== undefined) process.stdout.write(JSON.stringify({ id: request.id, result: { userAgent: "fixture/0" } }) + "\\n");
});
`);
    // The real launcher unwraps npm's .cmd shim into a direct Node invocation.
    writeFileSync(shim, '"%~dp0codex.mjs" %*\r\n');
    host = spawn(process.execPath, [fileURLToPath(new URL("../bridge/native-host.mjs", import.meta.url))], {
      env: { ...process.env, BROWSER_CONTROL_TEST_HOME: "1", CODEX_SIDEBAR_HOME: home, CODEX_BIN: shim, FIXTURE_PID_FILE: pidFile },
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    let stderr = "";
    host.stderr.on("data", (chunk) => { stderr += chunk; });
    const child = host;
    const decoder = new LengthPrefixedJsonDecoder();
    const reply = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`Native host did not initialize. ${stderr}`)), 5000);
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`Host exited before replying: ${code}. ${stderr}`)));
      child.stdout.on("data", (chunk) => {
        for (const message of decoder.push(chunk)) if (message.id === "connect") resolve(message);
      });
    });
    child.stdin.write(encodeNativeMessage({ type: "request", id: "connect", method: "bridge.status" }));
    expect(await reply).toMatchObject({ ok: true, data: { connected: true } });
    clearTimeout(timeout);
    pid = Number(readFileSync(pidFile, "utf8"));
    const closed = once(child, "close", { signal: AbortSignal.timeout(7000) });
    child.stdin.end();
    expect((await closed)[0]).toBe(0);
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
  } finally {
    clearTimeout(timeout);
    host?.stdin.end();
    if (host?.exitCode === null) host.kill("SIGKILL");
    if (pid) { try { process.kill(pid, "SIGKILL"); } catch { /* The owned fixture already stopped. */ } }
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 12_000);
