// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The publisher helper runs on Ubuntu; the portable packages have separate
// Windows/macOS/Linux gates. Exercise its real git/gh/unzip CLI boundary here.
describe.skipIf(process.platform === "win32")("GitHub release preflight", () => {
  const helper = resolve("scripts/prepare-github-release.mjs");
  let root: string;
  let assets: { id: number; name: string }[];
  let payloads: Record<string, string>;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  function run(mode: string) {
    writeFileSync(join(root, "api.json"), JSON.stringify({ release: { draft: false, prerelease: false, assets }, payloads }));
    return spawnSync(process.execPath, [helper, mode], { cwd: root, encoding: "utf8", env: {
      ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, RELEASE_TAG: "v0.3.9",
    } });
  }
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "browser-control-release-test-"));
    mkdirSync(join(root, "bin")); mkdirSync(join(root, "scripts")); mkdirSync(join(root, "release"));
    for (const file of ["package.json", "package-lock.json"]) writeFileSync(join(root, file), JSON.stringify({ version: "0.3.9", packages: { "": { version: "0.3.9" } } }));
    mkdirSync(join(root, "public"));
    writeFileSync(join(root, "public/manifest.json"), JSON.stringify({ version: "0.3.9" }));
    writeFileSync(join(root, "scripts/install-native-host.mjs"), 'const companionVersion = "0.3.9";');
    const fake = join(root, "bin/gh");
    writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const data = JSON.parse(fs.readFileSync('api.json', 'utf8'));
const args = process.argv.slice(2);
fs.appendFileSync('requests.jsonl', JSON.stringify(args) + '\\n');
if (args[0] !== 'api') { console.error('Unexpected mutation'); process.exit(1); }
if (args[1].includes('/releases/assets/')) process.stdout.write(Buffer.from(data.payloads[args[1].split('/').pop()], 'base64'));
else process.stdout.write(JSON.stringify(data.release));
`);
    chmodSync(fake, 0o755);
    git("init", "-q"); git("add", ".");
    git("-c", "user.name=Release Test", "-c", "user.email=release@example.invalid", "commit", "-qm", "fixture");
    git("tag", "v0.3.9"); git("update-ref", "refs/remotes/origin/main", "HEAD");
    assets = []; payloads = {};
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  it("accepts a published matching tag on main, rejects version drift before contacting GitHub", () => {
    expect(run("check").status).toBe(0);
    rmSync(join(root, "requests.jsonl"));
    writeFileSync(join(root, "package.json"), '{"version":"0.4.0"}');
    const result = run("check");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Version mismatch");
    expect(() => readFileSync(join(root, "requests.jsonl"))).toThrow();
  });
  it("refuses partial source assets instead of overwriting or filling an ambiguous release", () => {
    assets = [{ id: 1, name: "SHA256SUMS.txt" }];
    const result = run("assets");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Partial source release assets");
    expect(readFileSync(join(root, "requests.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
  });
  it("reuses exact existing packages and rejects a corrupt checksum without uploading", () => {
    const names = ["browser-control-companion-linux-0.3.9.zip", "browser-control-extension-0.3.9.zip", "SHA256SUMS.txt", "EXTENSION_SHA256SUMS.txt"];
    writeFileSync(join(root, "manifest.json"), '{"version":"0.3.9"}');
    execFileSync("zip", ["-q", join(root, "release", names[1]), "manifest.json"], { cwd: root });
    const bytes = [Buffer.from("portable companion fixture"), readFileSync(join(root, "release", names[1]))];
    const sums = bytes.map((data, index) => Buffer.from(`${createHash("sha256").update(data).digest("hex")}  ${names[index]}\n`));
    assets = names.map((name, index) => ({ name, id: index + 1 }));
    [...bytes, ...sums].forEach((data, index) => { payloads[String(index + 1)] = data.toString("base64"); });
    expect(run("assets").status).toBe(0);
    expect(readFileSync(join(root, "release", names[0]))).toEqual(bytes[0]);
    payloads["3"] = Buffer.from("invalid checksum").toString("base64");
    const failed = run("assets");
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain("Checksum mismatch");
    const calls = readFileSync(join(root, "requests.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(calls.every((call: string[]) => call[0] === "api")).toBe(true);
  });
});
