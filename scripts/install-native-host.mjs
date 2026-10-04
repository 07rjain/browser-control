import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  companionLayout,
  HOST_NAME,
  nativeMessagingManifest,
  posixLauncherScript,
  resolveCodexBinary,
  windowsLauncherSource,
} from "./host-paths.mjs";
import { codexInvocation } from "../bridge/codex-launch.mjs";

const companionVersion = "0.3.4";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const layout = companionLayout(process.platform, homedir(), process.env, companionVersion);
const installedHostScript = join(layout.runtimeDir, "native-host.mjs");
const bridgeFiles = ["native-host.mjs", "protocol.mjs", "skills.mjs", "codex-launch.mjs", "login-proxy.mjs"];

let codexBinary = "";
try {
  if (process.platform === "win32") {
    const invocation = codexInvocation();
    if (invocation.args[0] === "app-server" && existsSync(invocation.command)) codexBinary = invocation.command;
  } else {
    codexBinary = resolveCodexBinary({
      platform: process.platform,
      execFileSync,
      realpathSync,
      statSync,
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Codex CLI was not found.";
  process.stderr.write(`${message}\nThe companion is still being registered. Install Codex whenever you like, then choose Retry connection in the side panel.\n`);
}

mkdirSync(layout.runtimeDir, { recursive: true, mode: 0o700 });
mkdirSync(dirname(layout.launcherPath), { recursive: true, mode: 0o700 });
for (const file of bridgeFiles) {
  const source = realpathSync(join(repositoryRoot, "bridge", file));
  accessSync(source, constants.R_OK);
  const destination = join(layout.runtimeDir, file);
  copyFileSync(source, destination);
  chmodSync(destination, file === "native-host.mjs" ? 0o700 : 0o600);
}

if (process.platform === "win32") {
  const sourcePath = join(layout.runtimeDir, "native-host-launcher.cs");
  writeFileSync(sourcePath, windowsLauncherSource({
    nodePath: process.execPath,
    hostScript: installedHostScript,
    codexPath: codexBinary,
    sidebarHome: layout.sidebarHome,
  }));
  const compiler = frameworkCompiler();
  if (!compiler) {
    throw new Error("Windows needs the .NET Framework C# compiler (csc.exe) to build the native-host launcher.");
  }
  execFileSync(compiler, ["/nologo", "/optimize+", `/out:${layout.launcherPath}`, sourcePath], { stdio: "inherit" });
} else {
  writeFileSync(layout.launcherPath, posixLauncherScript({
    nodePath: process.execPath,
    nodeDir: dirname(process.execPath),
    hostScript: installedHostScript,
    codexPath: codexBinary,
    sidebarHome: layout.sidebarHome,
  }), { mode: 0o700 });
  chmodSync(layout.launcherPath, 0o700);
}

const nativeManifest = nativeMessagingManifest(layout.launcherPath);
for (const target of layout.manifestTargets) {
  if (target.kind === "file") {
    mkdirSync(dirname(target.path), { recursive: true });
    writeFileSync(target.path, nativeManifest, { mode: 0o600 });
    continue;
  }
  mkdirSync(layout.applicationRoot, { recursive: true });
  writeFileSync(target.path, nativeManifest);
  execFileSync("reg.exe", ["add", target.key, "/ve", "/t", "REG_SZ", "/d", target.path, "/f"], { stdio: "inherit" });
}

if (process.platform === "linux") warnAboutSandboxedChrome();

process.stdout.write([
  `Installed ${HOST_NAME} companion ${companionVersion}.`,
  `Runtime: ${layout.runtimeDir}`,
  `Browsers: ${layout.browsers}`,
  `Extension IDs: mpdfhhhjgbpdpfnkjbnboebdjokfjglf, fodoakcimglhplkoohggjdggdffhkdam`,
  "Next: open Browser Control and choose Retry connection. Node, Codex, and the extension can be installed in any order.",
  "",
].join("\n"));

function frameworkCompiler() {
  const root = process.env.WINDIR || process.env.SystemRoot;
  if (!root) return undefined;
  const candidates = [
    join(root, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join(root, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function warnAboutSandboxedChrome() {
  try {
    const chrome = execFileSync("which", ["google-chrome"], { encoding: "utf8" }).trim();
    if (chrome.includes("/snap/") || chrome.includes("/flatpak/")) {
      process.stderr.write("Snap or Flatpak Chrome may be unable to start this companion. Use a Chrome build that can launch programs outside its sandbox.\n");
    }
  } catch {
    // Chrome is not on PATH; the manifest is still installed for the normal config directory.
  }
}
