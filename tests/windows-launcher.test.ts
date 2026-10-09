import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { windowsLauncherSource } from "../scripts/host-paths.mjs";

const windowsRoot = process.env.WINDIR ?? process.env.SystemRoot;
const compiler = process.platform === "win32" && windowsRoot
  ? [
      join(windowsRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
      join(windowsRoot, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
    ].find(existsSync)
  : undefined;

describe("Windows native-host launcher", () => {
  it.skipIf(!compiler)("compiles and forwards a message while stdin stays open", async () => {
    if (!compiler) throw new Error("The .NET Framework C# compiler is unavailable.");
    const directory = mkdtempSync(join(tmpdir(), "browser-control-launcher-"));
    let launcher: ChildProcessWithoutNullStreams | undefined;
    try {
      const source = join(directory, "native-host-launcher.cs");
      const executable = join(directory, "native-host.exe");
      const echoScript = join(directory, "echo.mjs");
      writeFileSync(echoScript, 'process.stdin.on("data", (chunk) => process.stdout.write(chunk));\n');
      writeFileSync(source, windowsLauncherSource({
        nodePath: process.execPath,
        hostScript: echoScript,
        codexPath: "",
        sidebarHome: join(directory, ".codex-sidebar"),
      }));
      execFileSync(compiler, ["/nologo", "/optimize+", `/out:${executable}`, source]);

      launcher = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      const child = launcher;
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      const forwarded = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Launcher did not forward before stdin closed. ${stderr}`)), 3_000);
        child.stdout.once("data", (chunk) => {
          clearTimeout(timeout);
          resolve(chunk.toString("utf8"));
        });
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error(`Launcher exited ${String(code)} before forwarding. ${stderr}`));
        });
      });
      child.stdin.write("ping");
      expect(await forwarded).toBe("ping");
      child.stdin.end();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Launcher did not exit after stdin closed. ${stderr}`)), 3_000);
        child.once("close", (code) => {
          clearTimeout(timeout);
          if (code === 0) resolve();
          else reject(new Error(`Launcher exited ${String(code)}. ${stderr}`));
        });
      });
    } finally {
      if (launcher?.exitCode === null) {
        launcher.stdin.end();
        launcher.kill();
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
