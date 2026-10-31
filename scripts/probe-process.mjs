import { spawn } from "node:child_process";
import { APP_SERVER_ARGS, codexInvocation } from "../bridge/codex-launch.mjs";

export function spawnProbeCodex(codexBinary, home, args = APP_SERVER_ARGS) {
  const invocation = codexInvocation({ env: { ...process.env, CODEX_BIN: codexBinary } });
  // Preserve Node + script when Codex is installed via npm on Windows. Only
  // replace the app-server arguments for the legacy-thread isolation probe.
  const prefix = invocation.args.slice(0, -APP_SERVER_ARGS.length);
  return spawn(invocation.command, [...prefix, ...args], {
    env: { ...process.env, CODEX_HOME: home }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
}

export async function stopProbeProcess(child) {
  const streamsClosed = child.stdio.filter(Boolean).every((stream) => stream.closed);
  if (streamsClosed && (child.exitCode !== null || child.signalCode !== null || !child.pid)) return;
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(force);
      clearTimeout(deadline);
      child.off("close", closed);
      child.off("error", finish);
      if (error) reject(error); else resolve();
    };
    const closed = () => finish();
    const force = setTimeout(() => {
      if (process.platform === "win32") {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => child.kill("SIGKILL"));
      } else child.kill("SIGKILL");
    }, 8_000);
    const deadline = setTimeout(() => finish(new Error("Probe process did not stop.")), 12_000);
    child.once("close", closed);
    child.once("error", finish);
    // Windows SIGTERM kills Node immediately, bypassing native-host cleanup.
    // EOF lets the host stop its Codex process before releasing its files.
    child.stdin?.end();
  });
}
