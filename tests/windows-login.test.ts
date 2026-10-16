import { describe, expect, it } from "vitest";
import { APP_SERVER_ARGS, codexInvocation } from "../bridge/codex-launch.mjs";
import { localhostCallbackPort } from "../bridge/login-proxy.mjs";

describe("Windows Codex launch", () => {
  it("uses the standalone Codex executable", () => {
    const executable = "C:\\Users\\ada\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe";
    const invocation = codexInvocation({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" },
      home: "C:\\Users\\ada",
      existsSync: (file) => file === executable,
      readFileSync: () => "",
      execFileSync: () => { throw new Error("where should not run"); },
      nodePath: "C:\\node.exe",
    });
    expect(invocation).toEqual({ command: executable, args: [...APP_SERVER_ARGS] });
  });

  it("starts an npm Codex shim through node", () => {
    const shim = "C:\\Users\\ada\\AppData\\Roaming\\npm\\codex.cmd";
    const script = "C:\\Users\\ada\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js";
    const invocation = codexInvocation({
      platform: "win32",
      env: { CODEX_BIN: shim, APPDATA: "C:\\Users\\ada\\AppData\\Roaming", LOCALAPPDATA: "C:\\missing" },
      home: "C:\\Users\\ada",
      existsSync: (file) => file === shim || file === script,
      readFileSync: () => String.raw`"%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*`,
      execFileSync: () => { throw new Error("where should not run"); },
      nodePath: "C:\\node.exe",
    });
    expect(invocation).toEqual({ command: "C:\\node.exe", args: [script, ...APP_SERVER_ARGS] });
  });

  it.each([undefined, "C:\\npm\\prefix\\codex", "C:\\npm\\prefix\\codex.ps1"])("skips non-executable npm shims when CODEX_BIN is %s", (requested) => {
    const shell = "C:\\npm\\prefix\\codex";
    const powershell = "C:\\npm\\prefix\\codex.ps1";
    const shim = "C:\\npm\\prefix\\codex.cmd";
    const script = "C:\\npm\\prefix\\node_modules\\@openai\\codex\\bin\\codex.js";
    const files = new Set([shell, powershell, shim, script]);
    const invocation = codexInvocation({
      platform: "win32", env: { CODEX_BIN: requested }, home: "C:\\Users\\ada",
      existsSync: (file) => files.has(file),
      readFileSync: () => String.raw`"%_prog%" "%dp0%\node_modules\@openai\codex\bin\codex.js" %*`,
      execFileSync: () => `${shell}\r\n${powershell}\r\n${shim}\r\n`,
      nodePath: "C:\\node.exe",
    });
    expect(invocation).toEqual({ command: "C:\\node.exe", args: [script, ...APP_SERVER_ARGS] });
  });
});

describe("ChatGPT login callback", () => {
  it("reads the localhost callback port from the sign-in URL", () => {
    const callback = encodeURIComponent("http://localhost:1455/auth/callback");
    expect(localhostCallbackPort(`https://auth.openai.com/oauth/authorize?redirect_uri=${callback}`)).toBe(1455);
    expect(localhostCallbackPort("https://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback")).toBeNull();
  });
});
