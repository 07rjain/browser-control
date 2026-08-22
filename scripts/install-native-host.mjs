import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const companionVersion = "0.3.1";
const extensionIds = [
  "mpdfhhhjgbpdpfnkjbnboebdjokfjglf",
  "fodoakcimglhplkoohggjdggdffhkdam",
];
const hostName = "com.codex.sidebar";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceHostScript = join(repositoryRoot, "bridge", "native-host.mjs");
const sourceProtocolScript = join(repositoryRoot, "bridge", "protocol.mjs");
const applicationRoot = join(homedir(), "Library", "Application Support", "Browser Control");
const runtimeDir = join(applicationRoot, "host", companionVersion);
const installedHostScript = join(runtimeDir, "native-host.mjs");
const installedProtocolScript = join(runtimeDir, "protocol.mjs");
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
const codexBinary = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
if (!codexBinary) throw new Error("Codex CLI was not found on PATH.");

mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
mkdirSync(binDir, { recursive: true, mode: 0o700 });
copyFileSync(sourceHostScript, installedHostScript);
copyFileSync(sourceProtocolScript, installedProtocolScript);
chmodSync(installedHostScript, 0o700);
chmodSync(installedProtocolScript, 0o600);

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
