import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const mode = process.argv[2];
const tag = process.env.RELEASE_TAG;
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) throw new Error("RELEASE_TAG must be vX.Y.Z.");
const version = tag.slice(1);
for (const file of ["package.json", "public/manifest.json", "package-lock.json"]) {
  const content = JSON.parse(readFileSync(file, "utf8"));
  if (content.version !== version || (file === "package-lock.json" && content.packages[""].version !== version)) {
    throw new Error(`Version mismatch in ${file}`);
  }
}
if (!readFileSync("scripts/install-native-host.mjs", "utf8").includes(`const companionVersion = "${version}"`)) {
  throw new Error("Companion installer version differs from release.");
}
const commit = git("rev-parse", `${tag}^{commit}`);
if (git("rev-parse", "HEAD") !== commit) throw new Error("Checkout does not match release tag.");
git("merge-base", "--is-ancestor", commit, "origin/main");
const sourceRepo = "07rjain/browser-control";
const release = JSON.parse(gh("api", `repos/${sourceRepo}/releases/tags/${tag}`));
if (release.draft || release.prerelease) throw new Error("Only published stable releases can be deployed.");
const companion = `browser-control-companion-linux-${version}.zip`;
const extension = `browser-control-extension-${version}.zip`;
const names = [companion, extension, "SHA256SUMS.txt", "EXTENSION_SHA256SUMS.txt"];
mkdirSync("release", { recursive: true });
function download(repo, asset) {
  return execFileSync("gh", ["api", `repos/${repo}/releases/assets/${asset.id}`, "-H", "Accept: application/octet-stream"], { maxBuffer: 30 * 1024 * 1024 });
}
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function verifyPackages() {
  const manifest = JSON.parse(execFileSync("unzip", ["-p", `release/${extension}`, "manifest.json"], { encoding: "utf8" }));
  if (manifest.version !== version) throw new Error("Extension ZIP manifest differs from release.");
  for (const [file, sums] of [[companion, "SHA256SUMS.txt"], [extension, "EXTENSION_SHA256SUMS.txt"]]) {
    const expected = `${hash(readFileSync(`release/${file}`))}  ${file}\n`;
    if (readFileSync(`release/${sums}`, "utf8") !== expected) throw new Error(`Checksum mismatch: ${file}`);
  }
}
if (mode === "check") {
  console.log(`Verified ${tag} at ${commit}.`);
} else if (mode === "assets") {
  const existing = names.filter((name) => release.assets.some((asset) => asset.name === name));
  if (existing.length && existing.length !== names.length) throw new Error("Partial source release assets. Inspect manually before retrying.");
  if (existing.length) {
    for (const name of names) writeFileSync(`release/${name}`, download(sourceRepo, release.assets.find((asset) => asset.name === name)));
    verifyPackages();
  } else {
    verifyPackages();
    gh("release", "upload", tag, ...names.map((name) => `release/${name}`), "--repo", sourceRepo);
  }
} else if (mode === "companion") {
  verifyPackages();
  const repo = "07rjain/browser-control-support";
  const companionTag = `companion-${tag}`;
  // Listing avoids treating an auth or server failure as a missing release.
  const releases = JSON.parse(gh("api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`)).flat();
  let target = releases.find((item) => item.tag_name === companionTag);
  if (!target) {
    gh("release", "create", companionTag, "--repo", repo, "--draft", "--title", `Browser Control companion ${version}`,
      "--notes", `Portable companion for Browser Control ${tag}. Source: https://github.com/${sourceRepo}/commit/${commit}`);
    target = JSON.parse(gh("api", `repos/${repo}/releases/tags/${companionTag}`));
  }
  for (const name of [companion, "SHA256SUMS.txt"]) {
    const asset = target.assets.find((item) => item.name === name);
    if (asset) {
      if (hash(download(repo, asset)) !== hash(readFileSync(`release/${name}`))) throw new Error(`Existing companion asset differs: ${name}`);
    } else {
      if (!target.draft) throw new Error("Published companion is missing assets; repair manually.");
      gh("release", "upload", companionTag, `release/${name}`, "--repo", repo);
    }
  }
  if (target.draft) gh("release", "edit", companionTag, "--repo", repo, "--draft=false", "--latest");
  console.log(`Companion ready: https://github.com/${repo}/releases/tag/${companionTag}`);
} else {
  throw new Error("Expected check, assets, or companion command.");
}
