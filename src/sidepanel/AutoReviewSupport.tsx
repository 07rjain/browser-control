import { useState } from "react";
import { COMPANION_RELEASE_URL, type ReviewSupport } from "../shared/companion-support";

interface Props {
  support: ReviewSupport;
  desktopOs: string;
  disabled: boolean;
  onCheck: () => Promise<void>;
  onOpen: (url: string) => Promise<unknown>;
}

export default function AutoReviewSupport({ support, desktopOs, disabled, onCheck, onOpen }: Props) {
  const [notice, setNotice] = useState("");
  if (support.state === "available") return null;
  const checking = support.state === "checking";
  const platform = ({ mac: "macOS", win: "Windows", linux: "Linux" } as Record<string, string>)[desktopOs];
  return <section className="companion-support" aria-label="Auto review support">
    <p className="menu-hint" role="status">{support.message}</p>
    {(support.codexVersion || support.companionVersion) && <p className="menu-hint">
      {support.codexVersion && <>Codex CLI: {support.codexVersion}. </>}
      Companion: {support.companionVersion ?? "version not reported by this companion"}.
    </p>}
    {!checking && <>
      {support.state === "companion-update" && <>
        <button type="button" className="secondary-button" onClick={() => {
          void onOpen(COMPANION_RELEASE_URL).catch(() => setNotice("Couldn't open the download page. Try again."));
        }}>Download companion update</button>
        <details className="companion-update-steps" open>
          <summary>Update steps{platform ? ` for ${platform}` : ""}</summary>
          <p className="menu-hint">The same companion package supports Linux, macOS, and Windows. Download the ZIP and SHA256SUMS.txt from the release page, verify the checksum, then extract the ZIP.</p>
          <p className="menu-hint">Open {desktopOs === "win" ? "PowerShell" : desktopOs ? "Terminal" : "Terminal or PowerShell"} in the extracted folder and run:</p>
          <code className="setup-command">node scripts/install-native-host.mjs</code>
          <p className="menu-hint">Finish active tasks, fully quit Chrome or Brave{desktopOs === "mac" ? " with ⌘Q" : ""}, then reopen the browser. Select Auto review in Settings → Agent. Your sign-in, memories, and skills are kept.</p>
          <p className="menu-hint">Already installed the new companion? A full browser restart may be enough. This download is a local companion update; Chrome Web Store updates install the extension separately.</p>
        </details>
      </>}
      <button type="button" className="text-button" disabled={disabled} onClick={() => void onCheck()}>Check support again</button>
    </>}
    {notice && <p className="menu-hint" role="alert">{notice}</p>}
  </section>;
}
