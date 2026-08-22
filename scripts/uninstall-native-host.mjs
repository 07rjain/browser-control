import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const hostName = "com.codex.sidebar";
const browserManifestDirs = [
  join(homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
  join(homedir(), "Library", "Application Support", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
];
const applicationRoot = join(homedir(), "Library", "Application Support", "Browser Control");

for (const manifestDir of browserManifestDirs) {
  rmSync(join(manifestDir, `${hostName}.json`), { force: true });
}
rmSync(applicationRoot, { recursive: true, force: true });

process.stdout.write([
  `Removed ${hostName} from Chrome and Brave.`,
  "Browser Control account and conversation data was kept in ~/.codex-sidebar.",
  "Use the extension's Delete all Browser Control data action before uninstalling if you also want that data removed.",
  "",
].join("\n"));
