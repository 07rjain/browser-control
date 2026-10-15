export const COMPANION_INSTALL_COMMAND = 'git clone --depth 1 -b feat/desktop-companion https://github.com/07rjain/browser-control.git "$HOME/browser-control" || git -C "$HOME/browser-control" pull --ff-only && node "$HOME/browser-control/scripts/install-native-host.mjs"';

export function isMissingNativeHost(message: string | null | undefined): boolean {
  return /native messaging host not found/i.test(message ?? "");
}

export const LEGACY_THREAD_ERROR =
  "This chat was created before Browser Control limited Codex's built-in tools, so it can no longer be continued.";

export function isLegacyThreadError(message: string | null | undefined): boolean {
  return message === LEGACY_THREAD_ERROR;
}
