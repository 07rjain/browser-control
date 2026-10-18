import { describe, expect, it } from "vitest";
import { LEGACY_THREAD_ERROR as BRIDGE_LEGACY_THREAD_ERROR } from "../bridge/restricted-threads.mjs";
import { COMPANION_INSTALL_COMMAND, isLegacyThreadError, isMissingNativeHost, LEGACY_THREAD_ERROR } from "../src/shared/companion-setup";

describe("companion setup", () => {
  it("recognizes Chrome's missing-host error", () => {
    expect(isMissingNativeHost("Specified native messaging host not found.")).toBe(true);
    expect(isMissingNativeHost("Native host has exited.")).toBe(false);
    expect(COMPANION_INSTALL_COMMAND).toContain('node "$HOME/browser-control/scripts/install-native-host.mjs"');
    expect(COMPANION_INSTALL_COMMAND).toContain("--branch main");
    expect(COMPANION_INSTALL_COMMAND).toContain("pull --ff-only origin main");
  });

  it("recognizes the companion's legacy-thread refusal", () => {
    expect(LEGACY_THREAD_ERROR).toBe(BRIDGE_LEGACY_THREAD_ERROR);
    expect(isLegacyThreadError(BRIDGE_LEGACY_THREAD_ERROR)).toBe(true);
    expect(isLegacyThreadError("no rollout found for thread id")).toBe(false);
  });
});
