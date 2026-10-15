import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRestrictedThreadRegistry, LEGACY_THREAD_ERROR } from "../bridge/restricted-threads.mjs";

const directories: string[] = [];

function registryPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "restricted-threads-"));
  directories.push(directory);
  return join(directory, "restricted-threads.json");
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("restricted thread registry", () => {
  it("allows only threads it recorded, across companion restarts", () => {
    const path = registryPath();
    createRestrictedThreadRegistry(path).add("thread-new");
    const reopened = createRestrictedThreadRegistry(path);
    expect(reopened.has("thread-new")).toBe(true);
    expect(() => reopened.assertRestricted("thread-new")).not.toThrow();
    expect(() => reopened.assertRestricted("thread-legacy")).toThrow(LEGACY_THREAD_ERROR);
    expect(() => reopened.assertRestricted(undefined)).toThrow(LEGACY_THREAD_ERROR);
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("treats a missing or corrupt registry as having no restricted threads", () => {
    const path = registryPath();
    expect(createRestrictedThreadRegistry(path).has("thread-a")).toBe(false);
    writeFileSync(path, "{not json");
    const registry = createRestrictedThreadRegistry(path);
    expect(registry.has("thread-a")).toBe(false);
    registry.add("thread-a");
    expect(registry.has("thread-a")).toBe(true);
  });
});
