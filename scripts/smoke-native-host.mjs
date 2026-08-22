import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeNativeMessage, LengthPrefixedJsonDecoder } from "../bridge/protocol.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryHome = mkdtempSync(join(tmpdir(), "codex-sidebar-smoke-"));
const codexBinary = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
const unsafeHost = spawn(process.execPath, [join(repositoryRoot, "bridge", "native-host.mjs")], {
  env: {
    ...process.env,
    BROWSER_CONTROL_TEST_HOME: "1",
    CODEX_BIN: codexBinary,
    CODEX_SIDEBAR_HOME: homedir(),
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let unsafeError = "";
unsafeHost.stderr.on("data", (chunk) => {
  unsafeError += chunk.toString("utf8");
});
const unsafeExitCode = await new Promise((resolveExit, rejectExit) => {
  const timeout = setTimeout(() => {
    unsafeHost.kill("SIGKILL");
    rejectExit(new Error("Unsafe data-root smoke test did not exit."));
  }, 3_000);
  unsafeHost.once("exit", (code) => {
    clearTimeout(timeout);
    resolveExit(code);
  });
});
if (unsafeExitCode === 0 || !unsafeError.includes("untrusted Browser Control data directory")) {
  throw new Error("Native host did not reject an unsafe data root.");
}
const host = spawn(process.execPath, [join(repositoryRoot, "bridge", "native-host.mjs")], {
  env: {
    ...process.env,
    BROWSER_CONTROL_TEST_HOME: "1",
    CODEX_BIN: codexBinary,
    CODEX_SIDEBAR_HOME: temporaryHome,
  },
  stdio: ["pipe", "pipe", "pipe"],
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
    const request = pending.get(message.id);
    if (!request) continue;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.data);
    else request.reject(new Error(message.error));
  }
});

function request(method, params) {
  const id = crypto.randomUUID();
  host.stdin.write(encodeNativeMessage({ type: "request", id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => rejectRequest(new Error(`Timed out: ${method}`)), 15_000);
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
  const account = await request("account.read");
  const catalog = await request("models.list");
  if (status.connected !== true) throw new Error("Bridge did not report a connected state.");
  if (account.account !== null) throw new Error("Isolated smoke-test home unexpectedly contained an account.");
  if (!Array.isArray(catalog.models) || catalog.models.some((model) => !model.id || !model.name)) {
    throw new Error("Codex returned an invalid model catalog.");
  }
  if (process.env.LIVE_BROWSER_LOGIN === "1") {
    const login = await request("auth.login");
    if (login.type !== "chatgpt") throw new Error("Unexpected browser-login response type.");
    if (!["auth.openai.com", "chatgpt.com"].includes(new URL(login.authUrl).hostname)) {
      throw new Error("Browser login returned an unexpected authorization origin.");
    }
    if (!login.loginId) throw new Error("Browser login omitted its login ID.");
    await request("auth.cancel", { loginId: login.loginId });
    process.stdout.write("Browser-login start/cancel smoke test passed.\n");
  }
  const deletionMarker = join(temporaryHome, "must-be-deleted.txt");
  writeFileSync(deletionMarker, "delete me\n");
  const deletion = await request("data.deleteAll");
  if (deletion.deleted !== true) throw new Error("Native data deletion did not report success.");
  if (existsSync(deletionMarker)) throw new Error("Native data deletion retained a seeded marker.");
  if (!existsSync(join(temporaryHome, ".browser-control-data-root"))) {
    throw new Error("Native data deletion did not recreate its ownership marker.");
  }
  if (!existsSync(join(temporaryHome, "workspace"))) {
    throw new Error("Native data deletion did not recreate its isolated workspace.");
  }
  const accountAfterDeletion = await request("account.read");
  if (accountAfterDeletion.account !== null) throw new Error("Deleted native data retained an account.");
  process.stdout.write("Native bridge smoke test passed (isolated, signed-out account).\n");
} catch (error) {
  process.stderr.write(`${stderr}\n`);
  throw error;
} finally {
  host.kill("SIGTERM");
  rmSync(temporaryHome, { recursive: true, force: true });
}
