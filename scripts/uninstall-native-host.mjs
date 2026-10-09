import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { companionLayout, HOST_NAME } from "./host-paths.mjs";

const layout = companionLayout(process.platform, homedir(), process.env, "0.0.0");

for (const target of layout.manifestTargets) {
  if (target.kind === "file") {
    rmSync(target.path, { force: true });
    continue;
  }
  try {
    execFileSync("reg.exe", ["delete", target.key, "/f"], { stdio: "ignore" });
  } catch {
    // The key is already absent.
  }
  rmSync(target.path, { force: true });
}
rmSync(layout.applicationRoot, { recursive: true, force: true });
rmSync(dirname(layout.launcherPath), { recursive: true, force: true });

process.stdout.write([
  `Removed ${HOST_NAME} from ${layout.browsers}.`,
  "Browser Control account and conversation data was kept in ~/.codex-sidebar.",
  "Use the extension's Delete all Browser Control data action before uninstalling if you also want that data removed.",
  "",
].join("\n"));
