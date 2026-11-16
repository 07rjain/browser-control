import { useEffect, useState } from "react";
import { extensionUpdateCheckSchema, extensionUpdateStateSchema, type ExtensionUpdateState } from "../shared/extension-updates";
import type { SidebarEvent } from "../shared/protocol";

interface Props {
  disabled: boolean;
  request: (message: Record<string, unknown>) => Promise<unknown>;
}

export default function ExtensionUpdates({ disabled, request }: Props) {
  const [state, setState] = useState<ExtensionUpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void request({ type: "EXTENSION_UPDATE_READ" }).then((result) => {
      if (current) setState(extensionUpdateStateSchema.parse(result));
    }).catch(() => { if (current) setError("Unable to read update status. Reopen Settings to retry."); });
    const listener = (message: SidebarEvent, sender: chrome.runtime.MessageSender) => {
      if (sender.id !== chrome.runtime.id || message.source !== "codex-sidebar-background" || message.event !== "extension.update") return;
      const parsed = extensionUpdateStateSchema.safeParse(message.data);
      if (parsed.success && current) { setState(parsed.data); setNotice(null); setError(null); }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => { current = false; chrome.runtime.onMessage.removeListener(listener); };
  }, [request]);

  async function check() {
    setChecking(true); setNotice(null); setError(null);
    try {
      const result = extensionUpdateCheckSchema.parse(await request({ type: "EXTENSION_UPDATE_CHECK" }));
      setState(result);
      if (result.status === "throttled") setNotice("Chrome has checked recently. Try again later; automatic checks continue.");
      else if (result.status === "no_update") setNotice("Chrome isn't offering a newer version right now.");
      else if (result.status === "unsupported") setNotice("This development build must be rebuilt and reloaded from chrome://extensions.");
    } catch { setError("Couldn't check for updates. Check your connection and try again later."); }
    finally { setChecking(false); }
  }

  return <section aria-label="Extension updates">
    <h3 className="settings-section-title">Updates</h3>
    {state && <p className="menu-hint">Browser Control {state.currentVersion}</p>}
    {state?.storeManaged && <p className="menu-hint">Chrome checks for updates automatically. Updates install when Browser Control is closed and no task or skill recording is active.</p>}
    {state && !state.storeManaged && <p className="menu-hint">Development build: rebuild and reload from chrome://extensions.</p>}
    <button type="button" disabled={disabled || checking || !state || !state.storeManaged || Boolean(state.availableVersion)} onClick={() => void check()}>{checking ? "Checking…" : "Check for updates"}</button>
    {state?.availableVersion && <p className="menu-hint" role="status">Version {state.availableVersion} is available. Finish any task or skill recording, then close Browser Control to let it update.</p>}
    {notice && !state?.availableVersion && <p className="menu-hint" role="status">{notice}</p>}
    {error && <p className="menu-hint" role="alert">{error}</p>}
  </section>;
}
