import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const APP_SERVER_ARGS = ["app-server", "--stdio"];

export function codexInvocation({
  platform = process.platform,
  env = process.env,
  home = homedir(),
  existsSync: fileExists = existsSync,
  readFileSync: readFile = readFileSync,
  execFileSync: execFile = execFileSync,
  nodePath = process.execPath,
} = {}) {
  const paths = platform === "win32" ? path.win32 : path;
  const requested = env.CODEX_BIN?.trim();
  if (requested) {
    const direct = invocationFor(requested, { paths, fileExists, readFile, nodePath });
    if (direct) return direct;
  }
  if (platform === "win32") {
    const found = findWindowsCodex({ env, home, paths, fileExists, readFile, execFile, nodePath });
    if (found) return found;
    return { command: "codex.exe", args: APP_SERVER_ARGS };
  }
  return { command: "codex", args: APP_SERVER_ARGS };
}

function invocationFor(filePath, { paths, fileExists, readFile, nodePath }) {
  if (!filePath || !fileExists(filePath)) return null;
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) return unwrapWindowsShim(filePath, { paths, fileExists, readFile, nodePath });
  return { command: filePath, args: APP_SERVER_ARGS };
}

function findWindowsCodex({ env, home, paths, fileExists, readFile, execFile, nodePath }) {
  const localAppData = env.LOCALAPPDATA || paths.join(home, "AppData", "Local");
  const appData = env.APPDATA || paths.join(home, "AppData", "Roaming");
  const candidates = [
    paths.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
    paths.join(home, ".codex", "packages", "standalone", "current", "codex.exe"),
    paths.join(localAppData, "Microsoft", "WinGet", "Links", "codex.exe"),
    paths.join(appData, "npm", "codex.cmd"),
  ];
  for (const candidate of candidates) {
    const invocation = invocationFor(candidate, { paths, fileExists, readFile, nodePath });
    if (invocation) return invocation;
  }
  try {
    const output = execFile("where.exe", ["codex"], { encoding: "utf8", windowsHide: true });
    const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const ordered = [
      ...lines.filter((line) => line.toLowerCase().endsWith(".exe")),
      ...lines.filter((line) => !line.toLowerCase().endsWith(".exe")),
    ];
    for (const line of ordered) {
      const invocation = invocationFor(line, { paths, fileExists, readFile, nodePath });
      if (invocation) return invocation;
    }
  } catch {
    // where.exe could not see Codex on PATH.
  }
  return null;
}

function unwrapWindowsShim(shimPath, { paths, fileExists, readFile, nodePath }) {
  let text;
  try {
    text = readFile(shimPath, "utf8");
  } catch {
    return null;
  }
  const shimDir = paths.dirname(shimPath);
  const prefix = shimDir.endsWith(paths.sep) ? shimDir : `${shimDir}${paths.sep}`;
  const expanded = text.replace(/%~dp0/gi, prefix).replace(/%dp0%/gi, prefix);
  const exe = expanded.match(/["']([^"'\r\n]+codex\.exe)["']/i);
  if (exe) {
    const executable = paths.normalize(exe[1]);
    if (fileExists(executable)) return { command: executable, args: APP_SERVER_ARGS };
  }
  const script = expanded.match(/["']([^"'\r\n]+codex\.(?:js|mjs|cjs))["']/i);
  if (script) {
    const scriptPath = paths.normalize(script[1]);
    if (fileExists(scriptPath)) return { command: nodePath, args: [scriptPath, ...APP_SERVER_ARGS] };
  }
  return null;
}
