import { describe, expect, it } from "vitest";
import { requiresSignIn } from "../src/shared/auth-recovery";

describe("Codex session recovery", () => {
  it.each([
    "Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.",
    "Your refresh token has expired. Please sign in again.",
    "Your refresh token has already been used to generate a new access token.",
    "Token refresh failed: refresh_token_revoked",
    "refresh_token_expired",
    "refresh_token_reused",
    "Your authentication token has expired. Please try signing in again.",
  ])("recognizes invalidated credentials: %s", (message) => {
    expect(requiresSignIn(message)).toBe(true);
  });

  it.each([
    "workspace routing discovery timed out", "Native host has exited.",
    "Specified native messaging host not found.", "Network request timed out",
    "Rate limit exceeded", "Permission denied", "Token limit exceeded", null,
  ])("does not prescribe logout for other failures: %s", (message) => {
    expect(requiresSignIn(message)).toBe(false);
  });
});
