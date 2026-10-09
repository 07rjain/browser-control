import { describe, expect, it } from "vitest";
import {
  chromeLikePath,
  companionLayout,
  nativeMessagingManifest,
  posixLauncherScript,
  resolveCodexBinary,
  windowsLauncherSource,
} from "../scripts/host-paths.mjs";

describe("companion layout", () => {
  it("keeps the macOS Chrome and Brave host locations", () => {
    const layout = companionLayout("darwin", "/Users/ada", {}, "0.3.4");
    expect(layout.applicationRoot).toBe("/Users/ada/Library/Application Support/Browser Control");
    expect(layout.launcherPath).toBe("/Users/ada/Library/Application Support/Browser Control/bin/native-host");
    expect(layout.sidebarHome).toBe("/Users/ada/.codex-sidebar");
    expect(layout.manifestTargets.map((target) => target.path)).toEqual([
      "/Users/ada/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.codex.sidebar.json",
      "/Users/ada/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.codex.sidebar.json",
    ]);
  });

  it("uses XDG directories on Linux", () => {
    const layout = companionLayout("linux", "/home/ada", {
      XDG_DATA_HOME: "/data",
      XDG_CONFIG_HOME: "/cfg",
    }, "0.3.4");
    expect(layout.applicationRoot).toBe("/data/browser-control");
    expect(layout.launcherPath).toBe("/data/browser-control/bin/native-host");
    expect(layout.manifestTargets.map((target) => target.path)).toEqual([
      "/home/ada/.config",
      "/cfg",
    ].flatMap((configHome) => [
      "google-chrome",
      "google-chrome-beta",
      "google-chrome-unstable",
      "chromium",
      "chromium-browser",
      "BraveSoftware/Brave-Browser",
    ].map((browser) => `${configHome}/${browser}/NativeMessagingHosts/com.codex.sidebar.json`)));
  });

  it("registers Windows hosts in the current-user registry", () => {
    const layout = companionLayout("win32", "C:\\Users\\ada", {
      LOCALAPPDATA: "D:\\AppData\\Local",
    }, "0.3.4");
    expect(layout.launcherPath).toBe("D:\\AppData\\Local\\Browser Control\\bin\\native-host.exe");
    expect(layout.sidebarHome).toBe("C:\\Users\\ada\\.codex-sidebar");
    expect(layout.manifestTargets).toEqual([
      {
        kind: "registry",
        key: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.codex.sidebar",
        path: "D:\\AppData\\Local\\Browser Control\\com.codex.sidebar.json",
      },
      {
        kind: "registry",
        key: "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.codex.sidebar",
        path: "D:\\AppData\\Local\\Browser Control\\com.codex.sidebar.json",
      },
    ]);
  });

  it("pins Codex into a POSIX launcher and a Windows executable source", () => {
    const script = posixLauncherScript({
      nodePath: "/usr/local/bin/node",
      nodeDir: "/usr/local/bin",
      hostScript: "/opt/browser control/native-host.mjs",
      codexPath: "/opt/codex",
      sidebarHome: "/home/ada/.codex-sidebar",
    });
    expect(script).toContain("#!/bin/sh");
    expect(script).toContain("export CODEX_BIN='/opt/codex'");
    expect(script).toContain("command -v codex");
    expect(posixLauncherScript({
      nodePath: "/usr/bin/node",
      nodeDir: "/usr/bin",
      hostScript: "/opt/native-host.mjs",
      codexPath: "",
      sidebarHome: "/home/ada/.codex-sidebar",
    })).toContain("command -v codex");
    expect(script).toContain("'/opt/browser control/native-host.mjs'");

    const source = windowsLauncherSource({
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      hostScript: "C:\\Users\\ada\\native-host.mjs",
      codexPath: "C:\\Tools\\codex.exe",
      sidebarHome: "C:\\Users\\ada\\.codex-sidebar",
    });
    expect(source).toContain('start.FileName = @"C:\\Program Files\\nodejs\\node.exe"');
    expect(source).toContain('start.Arguments = "\\"C:\\\\Users\\\\ada\\\\native-host.mjs\\""');
    expect(source).toContain('var pinnedCodex = @"C:\\Tools\\codex.exe"');
    expect(source).toContain('if (pinnedCodex.Length > 0 && File.Exists(pinnedCodex)) start.EnvironmentVariables["CODEX_BIN"] = pinnedCodex;');
    expect(source).toContain('var codexBin = localAppData + @"\\Programs\\OpenAI\\Codex\\bin";');
    expect(source).toContain('var npmBin = appData + @"\\npm";');
    expect(source).toContain('var wingetBin = localAppData + @"\\Microsoft\\WinGet\\Links";');
    expect(source).toContain('userProfile + @"\\.local\\bin;"');
    expect(source).toMatch(/while \(\(read = source\.Read\(buffer, 0, buffer\.Length\)\) > 0\) \{\s*destination\.Write\(buffer, 0, read\);\s*destination\.Flush\(\);/);
  });

  it("prefers a Windows exe and rejects a cmd shim", () => {
    const executable = resolveCodexBinary({
      platform: "win32",
      env: {},
      execFileSync: () => "C:\\npm\\codex.cmd\r\nC:\\Tools\\codex.exe\r\n",
      realpathSync: (value: string) => value,
      statSync: () => ({ isFile: () => true, mode: 0 }),
    });
    expect(executable).toBe("C:\\Tools\\codex.exe");

    expect(() => resolveCodexBinary({
      platform: "win32",
      env: { CODEX_BIN: "C:\\npm\\codex.cmd" },
      execFileSync: () => { throw new Error("should not search PATH"); },
      realpathSync: (value: string) => value,
      statSync: () => ({ isFile: () => true, mode: 0 }),
    })).toThrow(/\.exe/);
  });

  it("writes the same host manifest for every desktop", () => {
    const manifest = JSON.parse(nativeMessagingManifest("/opt/native-host"));
    expect(manifest.name).toBe("com.codex.sidebar");
    expect(manifest.path).toBe("/opt/native-host");
    expect(manifest.allowed_origins).toContain("chrome-extension://mpdfhhhjgbpdpfnkjbnboebdjokfjglf/");
    expect(chromeLikePath("linux")).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("rejects an unsupported platform and a non-executable Codex binary", () => {
    expect(() => companionLayout("freebsd", "/home/ada")).toThrow(/does not support freebsd/);
    expect(() => resolveCodexBinary({
      platform: "linux",
      env: { CODEX_BIN: "/opt/codex" },
      execFileSync: () => { throw new Error("should not search PATH"); },
      realpathSync: (value: string) => value,
      statSync: () => ({ isFile: () => true, mode: 0o644 }),
    })).toThrow(/not executable/);
    expect(() => windowsLauncherSource({
      nodePath: "C:\\node.exe",
      hostScript: "C:\\host\"bad.mjs",
      codexPath: "C:\\codex.exe",
      sidebarHome: "C:\\Users\\ada\\.codex-sidebar",
    })).toThrow(/double quote/);
  });
});
