import { describe, expect, it } from "vitest";
import config from "../vite.config";

describe("extension build configuration", () => {
  it("does not emit cross-world module preload links", () => {
    expect(config.build?.modulePreload).toBe(false);
  });
});
