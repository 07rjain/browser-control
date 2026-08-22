import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
const version = packageJson.version;
const bootstrap = process.argv.includes("--bootstrap");
const releaseDir = join(repositoryRoot, "release");
const temporaryRoot = mkdtempSync(join(tmpdir(), "browser-control-release-"));
const companionName = `browser-control-companion-macos-${version}`;
const companionStage = join(temporaryRoot, companionName);
const extensionStage = join(temporaryRoot, "extension");
const companionZip = join(releaseDir, `${companionName}.zip`);
const extensionZip = join(
  releaseDir,
  `browser-control-extension-${bootstrap ? "bootstrap-" : ""}${version}.zip`,
);

function zipDirectory(directory, output) {
  rmSync(output, { force: true });
  execFileSync("zip", ["-q", "-r", output, "."], {
    cwd: directory,
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
}

function checksum(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

try {
  mkdirSync(releaseDir, { recursive: true });
  mkdirSync(join(companionStage, "bridge"), { recursive: true });
  mkdirSync(join(companionStage, "scripts"), { recursive: true });
  for (const file of ["native-host.mjs", "protocol.mjs"]) {
    copyFileSync(join(repositoryRoot, "bridge", file), join(companionStage, "bridge", file));
  }
  for (const file of ["install-native-host.mjs", "uninstall-native-host.mjs", "smoke-installed-host.mjs"]) {
    copyFileSync(join(repositoryRoot, "scripts", file), join(companionStage, "scripts", file));
  }
  copyFileSync(join(repositoryRoot, "companion", "README.txt"), join(companionStage, "README.txt"));
  zipDirectory(temporaryRoot, companionZip);

  cpSync(join(repositoryRoot, "dist"), extensionStage, { recursive: true });
  if (bootstrap) {
    const manifestPath = join(extensionStage, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    delete manifest.key;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  zipDirectory(extensionStage, extensionZip);

  const checksums = [companionZip, extensionZip]
    .map((path) => `${checksum(path)}  ${basename(path)}`)
    .join("\n");
  writeFileSync(join(releaseDir, "SHA256SUMS.txt"), `${checksums}\n`);
  process.stdout.write(`${extensionZip}\n${companionZip}\n${join(releaseDir, "SHA256SUMS.txt")}\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
