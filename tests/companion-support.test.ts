import { describe, expect, it } from "vitest";
import { describeReviewSupport } from "../src/shared/companion-support";

const legacy = { version: 2, available: false, configurableModel: true, editableSystemPrompt: true,
  codexVersion: "0.169.0", reason: "Auto review is unavailable for Codex CLI 0.169.0. Verified versions: 0.162.1, 0.164.0, 0.165.0. Use Ask every time until this version passes the isolated reviewer checks." };

describe("companion compatibility diagnosis", () => {
  it("identifies the reported legacy-host failure without enabling Auto review", () => {
    const result = describeReviewSupport(legacy);
    expect(result.state).toBe("companion-update");
    expect(result.message).toContain("Codex CLI 0.169.0 is supported");
    expect(result.message).toContain("Updating the extension alone does not replace the companion");
    expect(result.companionVersion).toBeUndefined();
  });

  it("keeps an unverified CLI unavailable and retains its actual reason", () => {
    const reason = "Auto review is unavailable for Codex CLI 0.170.0. Use Ask every time.";
    const result = describeReviewSupport({ ...legacy, codexVersion: "0.170.0", reason });
    expect(result).toMatchObject({ state: "unsupported", message: reason });
  });

  it("does not misdiagnose a different host failure as a version problem", () => {
    expect(describeReviewSupport({ ...legacy, reason: "Reviewer isolation checks failed." }))
      .toMatchObject({ state: "unsupported", message: "Reviewer isolation checks failed." });
  });

  it("accepts current capability metadata, while malformed legacy responses fail closed", () => {
    expect(describeReviewSupport({ ...legacy, available: true, companionVersion: "0.3.11", verifiedCodexVersions: ["0.169.0"] }))
      .toMatchObject({ state: "available", companionVersion: "0.3.11", codexVersion: "0.169.0" });
    expect(describeReviewSupport({ available: true }).state).toBe("companion-update");
  });
});
