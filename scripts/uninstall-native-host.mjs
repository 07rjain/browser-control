import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const hostName = "com.codex.sidebar";
const manifestPath = join(
  homedir(),
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "NativeMessagingHosts",
  `${hostName}.json`,
);
const launcherPath = join(homedir(), ".codex-sidebar", "bin", "native-host");

rmSync(manifestPath, { force: true });
rmSync(launcherPath, { force: true });
process.stdout.write(`Removed ${hostName} native-host registration.\n`);
