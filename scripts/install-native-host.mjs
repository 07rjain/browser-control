import { accessSync, constants, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const extensionId = "fodoakcimglhplkoohggjdggdffhkdam";
const hostName = "com.codex.sidebar";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostScript = join(repositoryRoot, "bridge", "native-host.mjs");
const appHome = join(homedir(), ".codex-sidebar");
const binDir = join(appHome, "bin");
const launcher = join(binDir, "native-host");
const manifestDir = join(
  homedir(),
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "NativeMessagingHosts",
);
const manifestPath = join(manifestDir, `${hostName}.json`);

if (process.platform !== "darwin") {
  throw new Error("The MVP installer currently supports macOS only.");
}

accessSync(hostScript, constants.R_OK);
const codexBinary = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
if (!codexBinary) throw new Error("Codex CLI was not found on PATH.");

mkdirSync(binDir, { recursive: true, mode: 0o700 });
mkdirSync(manifestDir, { recursive: true });

const shellQuote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;
const nodeBinDirectory = dirname(process.execPath);
writeFileSync(
  launcher,
  [
    "#!/bin/sh",
    `export PATH=${shellQuote(nodeBinDirectory)}:"$PATH"`,
    `export CODEX_BIN=${shellQuote(codexBinary)}`,
    `export CODEX_SIDEBAR_HOME=${shellQuote(appHome)}`,
    `exec ${shellQuote(process.execPath)} ${shellQuote(hostScript)}`,
    "",
  ].join("\n"),
  { mode: 0o700 },
);
chmodSync(launcher, 0o700);

writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      name: hostName,
      description: "Native Codex App Server bridge for Codex Sidebar MVP",
      path: launcher,
      type: "stdio",
      allowed_origins: [`chrome-extension://${extensionId}/`],
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);

process.stdout.write(`Installed ${hostName}\nManifest: ${manifestPath}\nExtension ID: ${extensionId}\n`);
