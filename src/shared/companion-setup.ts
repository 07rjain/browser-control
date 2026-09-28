export const COMPANION_INSTALL_COMMAND = "node scripts/install-native-host.mjs";

export function isMissingNativeHost(message: string | null | undefined): boolean {
  return /native messaging host not found/i.test(message ?? "");
}
