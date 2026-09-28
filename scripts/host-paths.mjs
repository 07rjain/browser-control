import path from "node:path";

export const HOST_NAME = "com.codex.sidebar";
export const EXTENSION_IDS = [
  "mpdfhhhjgbpdpfnkjbnboebdjokfjglf",
  "fodoakcimglhplkoohggjdggdffhkdam",
];

export function pathForPlatform(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

export function companionLayout(platform, home, env = {}, version = "0.0.0") {
  const paths = pathForPlatform(platform);
  const sidebarHome = paths.join(home, ".codex-sidebar");
  if (platform === "darwin") {
    const applicationRoot = paths.join(home, "Library", "Application Support", "Browser Control");
    return {
      platform,
      applicationRoot,
      runtimeDir: paths.join(applicationRoot, "host", version),
      launcherPath: paths.join(applicationRoot, "bin", "native-host"),
      sidebarHome,
      browsers: "Chrome and Brave",
      manifestTargets: [
        manifestFile(paths, home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
        manifestFile(paths, home, "Library", "Application Support", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
      ],
    };
  }
  if (platform === "linux") {
    const dataHome = env.XDG_DATA_HOME || paths.join(home, ".local", "share");
    const configHome = env.XDG_CONFIG_HOME || paths.join(home, ".config");
    const applicationRoot = paths.join(dataHome, "browser-control");
    return {
      platform,
      applicationRoot,
      runtimeDir: paths.join(applicationRoot, "host", version),
      launcherPath: paths.join(applicationRoot, "bin", "native-host"),
      sidebarHome,
      browsers: "Chrome, Chromium, and Brave",
      manifestTargets: [
        { kind: "file", path: paths.join(configHome, "google-chrome", "NativeMessagingHosts", `${HOST_NAME}.json`) },
        { kind: "file", path: paths.join(configHome, "chromium", "NativeMessagingHosts", `${HOST_NAME}.json`) },
        { kind: "file", path: paths.join(configHome, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts", `${HOST_NAME}.json`) },
      ],
    };
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || paths.join(home, "AppData", "Local");
    const applicationRoot = paths.join(localAppData, "Browser Control");
    return {
      platform,
      applicationRoot,
      runtimeDir: paths.join(applicationRoot, "host", version),
      launcherPath: paths.join(applicationRoot, "bin", "native-host.exe"),
      sidebarHome,
      browsers: "Chrome and Brave",
      manifestTargets: [
        { kind: "registry", key: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, path: paths.join(applicationRoot, `${HOST_NAME}.json`) },
        { kind: "registry", key: `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`, path: paths.join(applicationRoot, `${HOST_NAME}.json`) },
      ],
    };
  }
  throw new Error(`Browser Control does not support ${platform}. Use macOS, Linux, or Windows.`);
}

function manifestFile(paths, home, ...parts) {
  return { kind: "file", path: paths.join(home, ...parts, `${HOST_NAME}.json`) };
}

export function nativeMessagingManifest(launcherPath) {
  return `${JSON.stringify({
    name: HOST_NAME,
    description: "Native Codex App Server bridge for Browser Control",
    path: launcherPath,
    type: "stdio",
    allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`),
  }, null, 2)}\n`;
}

export function posixLauncherScript({ nodePath, nodeDir, hostScript, codexPath, sidebarHome }) {
  const quote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;
  return [
    "#!/bin/sh",
    `export PATH=${quote(nodeDir)}:"$PATH"`,
    `export CODEX_BIN=${quote(codexPath)}`,
    `export CODEX_SIDEBAR_HOME=${quote(sidebarHome)}`,
    `exec ${quote(nodePath)} ${quote(hostScript)}`,
    "",
  ].join("\n");
}

export function windowsLauncherSource({ nodePath, hostScript, codexPath, sidebarHome }) {
  for (const value of [nodePath, hostScript, codexPath, sidebarHome]) {
    if (String(value).includes("\"")) throw new Error("Companion paths cannot contain a double quote.");
  }
  const csharp = (value) => String(value).replaceAll("\"", "\"\"");
  return `using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

static class Program {
  static int Main() {
    var start = new ProcessStartInfo();
    start.FileName = @"${csharp(nodePath)}";
    start.Arguments = "\\"${csharp(hostScript).replaceAll("\\", "\\\\")}\\"";
    start.UseShellExecute = false;
    start.CreateNoWindow = true;
    start.RedirectStandardInput = true;
    start.RedirectStandardOutput = true;
    start.RedirectStandardError = true;
    start.EnvironmentVariables["CODEX_BIN"] = @"${csharp(codexPath)}";
    start.EnvironmentVariables["CODEX_SIDEBAR_HOME"] = @"${csharp(sidebarHome)}";
    var nodeDir = @"${csharp(path.win32.dirname(nodePath))}";
    var currentPath = Environment.GetEnvironmentVariable("PATH") ?? "";
    start.EnvironmentVariables["PATH"] = nodeDir + ";" + currentPath;
    var child = Process.Start(start);
    var input = new Thread(() => Copy(Console.OpenStandardInput(), child.StandardInput.BaseStream, true));
    var output = new Thread(() => Copy(child.StandardOutput.BaseStream, Console.OpenStandardOutput(), false));
    var error = new Thread(() => Copy(child.StandardError.BaseStream, Stream.Null, false));
    input.Start();
    output.Start();
    error.Start();
    child.WaitForExit();
    output.Join();
    error.Join();
    return child.ExitCode;
  }

  static void Copy(Stream source, Stream destination, bool closeDestination) {
    var buffer = new byte[8192];
    int read;
    while ((read = source.Read(buffer, 0, buffer.Length)) > 0) destination.Write(buffer, 0, read);
    destination.Flush();
    if (closeDestination) destination.Close();
  }
}
`;
}

export function resolveCodexBinary({ platform, env = process.env, execFileSync, realpathSync, statSync }) {
  const requested = env.CODEX_BIN?.trim() || findCodexOnPath(platform, execFileSync);
  if (!requested) throw new Error("Codex CLI was not found. Set CODEX_BIN or install Codex on PATH.");
  let resolved;
  try {
    resolved = realpathSync(requested);
  } catch {
    throw new Error(`Codex CLI was not found at ${requested}.`);
  }
  const paths = pathForPlatform(platform);
  if (!paths.isAbsolute(resolved)) throw new Error("CODEX_BIN must resolve to an absolute path.");
  const stat = statSync(resolved);
  if (!stat.isFile()) throw new Error("CODEX_BIN must point to the Codex executable file.");
  if (platform === "win32") {
    if (!resolved.toLowerCase().endsWith(".exe")) {
      throw new Error("On Windows, CODEX_BIN must be the Codex .exe, not the npm .cmd shim.");
    }
    return resolved;
  }
  if ((stat.mode & 0o111) === 0) throw new Error("The Codex CLI is not executable.");
  return resolved;
}

function findCodexOnPath(platform, execFileSync) {
  if (platform === "win32") {
    const output = execFileSync("where.exe", ["codex"], { encoding: "utf8" });
    const candidates = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const executable = candidates.find((candidate) => candidate.toLowerCase().endsWith(".exe"));
    if (!executable) {
      throw new Error("Codex CLI was found only as a Windows script shim. Set CODEX_BIN to codex.exe.");
    }
    return executable;
  }
  return execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
}

export function chromeLikePath(platform, env = process.env) {
  if (platform === "win32") {
    const root = env.SystemRoot || "C:\\Windows";
    return `${root}\\System32`;
  }
  return "/usr/bin:/bin:/usr/sbin:/sbin";
}
