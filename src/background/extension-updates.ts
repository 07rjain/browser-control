import { z } from "zod";
import {
  EXTENSION_UPDATE_KEY, SIDEBAR_LIFETIME_PORT, extensionVersionSchema,
  isNewerExtensionVersion, type ExtensionUpdateCheck, type ExtensionUpdateState,
} from "../shared/extension-updates";

const pendingUpdateSchema = z.object({ fromVersion: extensionVersionSchema, version: extensionVersionSchema });
const IDLE_GRACE_MS = 1_000;

/** Chrome owns downloads/signatures. We only choose when to apply its staged update. */
export function createExtensionUpdater(options: {
  isBusyNow: () => boolean;
  isBusy: () => Promise<boolean>;
  notify: (state: ExtensionUpdateState) => void;
}) {
  const panels = new Set<chrome.runtime.Port>();
  let operations = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let applying = false;
  let checking: Promise<ExtensionUpdateCheck> | null = null;
  // Serializing the writes prevents overlapping update events losing the newest version.
  let writes: Promise<void> = Promise.resolve();

  function busyNow(): boolean {
    return panels.size > 0 || operations > 0 || options.isBusyNow();
  }

  async function read(): Promise<ExtensionUpdateState> {
    const manifest = chrome.runtime.getManifest();
    const stored = await chrome.storage.local.get(EXTENSION_UPDATE_KEY);
    const pending = pendingUpdateSchema.safeParse(stored[EXTENSION_UPDATE_KEY]);
    const availableVersion = pending.success && pending.data.fromVersion === manifest.version &&
      isNewerExtensionVersion(pending.data.version, manifest.version) ? pending.data.version : null;
    return { currentVersion: manifest.version, availableVersion,
      storeManaged: manifest.update_url === "https://clients2.google.com/service/update2/crx" };
  }

  async function applyWhenIdle(): Promise<void> {
    if (applying || busyNow()) return;
    applying = true;
    try {
      await writes;
      const state = await read();
      if (!state.storeManaged || !state.availableVersion || busyNow() || await options.isBusy()) return;
      // Includes open extension tabs and panels that haven't mounted their lifetime port yet.
      const contexts = await chrome.runtime.getContexts({});
      if (contexts.some((context) => context.contextType !== "BACKGROUND") || busyNow()) return;
      // No await after this last guard: a new request/port cannot slip before reload.
      chrome.runtime.reload();
    } finally { applying = false; }
  }

  function reconsider(): void {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    // A one-shot grace period lets pagehide conversation saves arrive; never polls the Store.
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      void applyWhenIdle().catch(() => undefined); // Fail closed if state cannot be read.
    }, IDLE_GRACE_MS);
  }

  function hold(): () => void {
    operations++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      operations--;
      reconsider();
    };
  }

  function available(version: string): Promise<void> {
    const write = writes.then(async () => {
      const current = await read();
      if (!isNewerExtensionVersion(version, current.availableVersion ?? current.currentVersion)) return;
      await chrome.storage.local.set({ [EXTENSION_UPDATE_KEY]: { fromVersion: current.currentVersion, version } });
      options.notify(await read());
    });
    writes = write.catch(() => undefined);
    return write.finally(reconsider);
  }

  function check(): Promise<ExtensionUpdateCheck> {
    if (checking) return checking;
    const run = (async (): Promise<ExtensionUpdateCheck> => {
      const state = await read();
      if (!state.storeManaged) return { ...state, status: "unsupported" };
      if (state.availableVersion) return { ...state, status: "update_available" };
      // User-initiated only. Chrome performs the routine background checks itself.
      const result = await chrome.runtime.requestUpdateCheck();
      if (result.status === "update_available" && result.version) await available(result.version);
      const updated = await read();
      return { ...updated, status: updated.availableVersion ? "update_available" : result.status };
    })();
    checking = run;
    void run.finally(() => { if (checking === run) checking = null; }).catch(() => undefined);
    return run;
  }

  function acceptPort(port: chrome.runtime.Port): boolean {
    if (port.name !== SIDEBAR_LIFETIME_PORT || port.sender?.id !== chrome.runtime.id || port.sender.tab !== undefined) return false;
    panels.add(port);
    port.onDisconnect.addListener(() => { panels.delete(port); reconsider(); });
    return true;
  }

  function register(): void {
    chrome.runtime.onUpdateAvailable?.addListener((details) => { void available(details.version).catch(() => undefined); });
    // Recover a staged version after MV3 suspension without making a network check.
    reconsider();
  }

  return { read, check, acceptPort, hold, reconsider, register };
}
