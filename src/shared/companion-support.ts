import { reviewCapabilitiesSchema } from "./auto-review";
import reviewerConfig from "../../bridge/reviewer-config.json";
import companionVersion from "../../bridge/version.json";

export const COMPANION_RELEASE_URL = `https://github.com/07rjain/browser-control-support/releases/tag/companion-v${companionVersion.version}`;

export interface ReviewSupport {
  state: "checking" | "available" | "companion-update" | "unsupported" | "unavailable";
  message: string;
  codexVersion?: string;
  companionVersion?: string;
}

export function describeReviewSupport(result: unknown): ReviewSupport {
  const parsed = reviewCapabilitiesSchema.safeParse(result);
  if (!parsed.success) return {
    state: "companion-update",
    message: "This companion does not report the Auto review support this extension needs. Update the companion, then restart Chrome or Brave.",
  };
  const capability = parsed.data;
  const versions = { codexVersion: capability.codexVersion, companionVersion: capability.companionVersion };
  if (capability.available) return { ...versions, state: "available", message: "Auto review is available." };
  if (capability.codexVersion && reviewerConfig.verifiedCodexVersions.includes(capability.codexVersion) &&
      capability.reason?.startsWith("Auto review is unavailable for Codex CLI ")) {
    return { ...versions, state: "companion-update",
      message: `Codex CLI ${capability.codexVersion} is supported. The companion currently running on this computer needs an update or a restart. Updating the extension alone does not replace the companion.` };
  }
  return { ...versions, state: "unsupported", message: capability.reason ?? "The companion could not confirm Auto review support. Check its installation and retry." };
}
