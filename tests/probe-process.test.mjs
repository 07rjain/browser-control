import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";
import { stopProbeProcess } from "../scripts/probe-process.mjs";

it("waits for inherited streams to close when a CLI wrapper already exited", async () => {
  const child = spawn(process.execPath, ["-e", `
    const { spawn } = require("node:child_process");
    spawn(process.execPath, ["-e", 'setTimeout(() => { process.stdout.write("descendant finished"); }, 700);'], { stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
    process.exit(0);
  `], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  try {
    await once(child, "exit");
    await stopProbeProcess(child);
    expect(output, stderr || "The descendant must finish before cleanup returns.").toContain("descendant finished");
    expect(child.stdout.closed).toBe(true);
  } finally {
    if (!child.stdout.closed) await once(child, "close");
  }
});
