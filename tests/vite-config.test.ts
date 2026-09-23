import { describe, expect, it } from "vitest";
import config from "../vite.config";

describe("extension build configuration", () => {
  it("does not emit cross-world module preload links", () => {
    expect(config.build?.modulePreload).toBe(false);
  });

  it("builds the packaged page recorder beside the page executor", () => {
    const input = config.build?.rollupOptions?.input;
    expect(input).toMatchObject({
      pageExecutor: expect.stringContaining("page-executor.ts"),
      pageRecorder: expect.stringContaining("page-recorder.ts"),
    });
  });
});
