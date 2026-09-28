import { describe, expect, it } from "vitest";
import { COMPANION_INSTALL_COMMAND, isMissingNativeHost } from "../src/shared/companion-setup";

describe("companion setup", () => {
  it("recognizes Chrome's missing-host error", () => {
    expect(isMissingNativeHost("Specified native messaging host not found.")).toBe(true);
    expect(isMissingNativeHost("Native host has exited.")).toBe(false);
    expect(COMPANION_INSTALL_COMMAND).toContain('node "$HOME/browser-control/scripts/install-native-host.mjs"');
  });
});
