import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  mkdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const companionVersion = "0.3.2";
const extensionIds = [
  "mpdfhhhjgbpdpfnkjbnboebdjokfjglf",
  "fodoakcimglhplkoohggjdggdffhkdam",
];
const hostName = "com.codex.sidebar";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceHostScript = realpathSync(join(repositoryRoot, "bridge", "native-host.mjs"));
const sourceProtocolScript = realpathSync(join(repositoryRoot, "bridge", "protocol.mjs"));
const sourceSkillsScript = realpathSync(join(repositoryRoot, "bridge", "skills.mjs"));
const applicationRoot = join(homedir(), "Library", "Application Support", "Browser Control");
const runtimeDir = join(applicationRoot, "host", companionVersion);
const installedHostScript = join(runtimeDir, "native-host.mjs");
const installedProtocolScript = join(runtimeDir, "protocol.mjs");
const installedSkillsScript = join(runtimeDir, "skills.mjs");
const binDir = join(applicationRoot, "bin");
const launcher = join(binDir, "native-host");
const appHome = join(homedir(), ".codex-sidebar");
const browserManifestDirs = [
  join(homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
  join(homedir(), "Library", "Application Support", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
];

if (process.platform !== "darwin") {
  throw new Error("The Browser Control companion currently supports macOS only.");
}

accessSync(sourceHostScript, constants.R_OK);
accessSync(sourceProtocolScript, constants.R_OK);
accessSync(sourceSkillsScript, constants.R_OK);

function resolveCodexBinary() {
  const requested = process.env.CODEX_BIN?.trim()
    || execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  if (!requested) throw new Error("Codex CLI was not found. Set CODEX_BIN or install Codex on PATH.");
  let resolved;
  try {
    resolved = realpathSync(requested);
  } catch {
    throw new Error(`Codex CLI was not found at ${requested}.`);
  }
  if (!isAbsolute(resolved)) throw new Error("CODEX_BIN must resolve to an absolute path.");
  const stat = statSync(resolved);
  if (!stat.isFile()) throw new Error("CODEX_BIN must point to the Codex executable file.");
  if ((stat.mode & 0o111) === 0) throw new Error("The Codex CLI is not executable.");
  return resolved;
}

const codexBinary = resolveCodexBinary();

mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
mkdirSync(binDir, { recursive: true, mode: 0o700 });
copyFileSync(sourceHostScript, installedHostScript);
copyFileSync(sourceProtocolScript, installedProtocolScript);
copyFileSync(sourceSkillsScript, installedSkillsScript);
chmodSync(installedHostScript, 0o700);
chmodSync(installedProtocolScript, 0o600);
chmodSync(installedSkillsScript, 0o600);

const shellQuote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;
const nodeBinDirectory = dirname(process.execPath);
writeFileSync(
  launcher,
  [
    "#!/bin/sh",
    `export PATH=${shellQuote(nodeBinDirectory)}:"$PATH"`,
    `export CODEX_BIN=${shellQuote(codexBinary)}`,
    `export CODEX_SIDEBAR_HOME=${shellQuote(appHome)}`,
    `exec ${shellQuote(process.execPath)} ${shellQuote(installedHostScript)}`,
    "",
  ].join("\n"),
  { mode: 0o700 },
);
chmodSync(launcher, 0o700);

const nativeManifest = `${JSON.stringify(
  {
    name: hostName,
    description: "Native Codex App Server bridge for Browser Control",
    path: launcher,
    type: "stdio",
    allowed_origins: extensionIds.map((id) => `chrome-extension://${id}/`),
  },
  null,
  2,
)}\n`;

for (const manifestDir of browserManifestDirs) {
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, `${hostName}.json`), nativeManifest, { mode: 0o600 });
}

process.stdout.write([
  `Installed ${hostName} companion ${companionVersion}.`,
  `Runtime: ${runtimeDir}`,
  "Browsers: Chrome and Brave",
  `Extension IDs: ${extensionIds.join(", ")}`,
  "",
].join("\n"));
