# Install Browser Control on a new Windows or Linux desktop

This is a **test guide**, checked on 2026-10-04. It assumes your machine has a
web browser and internet access, but no Node.js, Codex CLI, Git, or development
tools. You do **not** need Git, npm, VS Code, or this repository on the test
machine.

**Release status:** The Chrome Web Store extension is version 0.3.4, but its
public companion downloads currently contain only macOS ZIPs. Windows and Linux
are being validated from the separate test bundle named below. Do not use the
macOS companion ZIP on Windows or Linux or advertise this as a finished public
installer. The Store listing may still say macOS-only.

You need a Google Chrome or Brave desktop browser and an eligible ChatGPT/Codex
account. The extension is installed from the [Chrome Web Store][store]. The
companion runs locally and is required because extensions cannot launch Codex
CLI themselves. ChromeOS, Firefox, Safari, and Snap/Flatpak-packaged Chromium
browsers are not supported by this test.

## Obtain the companion files

If you are testing the pushed source on Windows, open the
[project's `feat/desktop-companion` branch][source] in your browser, choose
**Code → Download ZIP**, and extract it into a folder under Downloads. The
extracted repository should contain `bridge` and `scripts` folders. This does
not require Git. Keep that folder in place until the companion test finishes.

Alternatively, use the maintainer-prepared test bundle:

Ask the project maintainer for
`browser-control-companion-windows-linux-test-0.3.4.zip` and its SHA-256 hash.
For this test, the maintainer prepares it from the current working tree and
transfers it to your Windows/Linux machine (for example via USB or a trusted
file-sharing service). **Do not download a similarly named ZIP from an
unverified site.** It contains only the companion's JavaScript and installer
scripts, not the extension, Node.js, Codex, credentials, or an executable.

Keep the ZIP until installation succeeds. Its expected SHA-256 is:

```text
a81a0ffb54bc8d00f7aedeb539fbbce6f1492cd867dc9669ef17b56e64b611a9
```

If your copy has a different hash, stop before running the installer.

## Recommended Windows path: let Codex help with setup

This path starts with just a browser and Windows PowerShell. Codex can inspect
your PC, install missing prerequisites with your approval, and run the companion
checks. You still approve Windows installers and Chrome's extension-install and
ChatGPT sign-in prompts yourself.

1. Open **Windows PowerShell** (Start menu → type `PowerShell`) and install
   Codex using [OpenAI's standalone installer][codex]:

   ```powershell
   powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
   ```

   Close PowerShell, open a new window, run `codex`, and choose **Sign in with
   ChatGPT**. Codex's standalone installer does not require Node.js. If
   `codex` is not recognized, follow the installer's PATH instructions and try
   a new PowerShell window before continuing.

2. Download and extract the GitHub source as described above. This is the
   simplest way to test the code you fetched after the push. If you received
   the maintainer's test ZIP instead, put it in Downloads and use the alternate
   instruction after the prompt below.

3. Paste the following into the **Codex CLI conversation** (not PowerShell):

   ```text
   Help me set up Browser Control 0.3.4 on this Windows PC. I downloaded the
   feat/desktop-companion branch from
   https://github.com/07rjain/browser-control and extracted its ZIP under my
   Downloads folder. Find that extracted folder and show me its full path.
   Before running anything from it, confirm it contains bridge/native-host.mjs,
   bridge/codex-launch.mjs, bridge/login-proxy.mjs, and
   scripts/install-native-host.mjs. If the source is missing or looks like a
   different project, stop. Check that codex.exe works, Node.js is version 20
   or newer, and at least one of these
   Windows .NET Framework C# compiler paths exists:
   $env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe
   $env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe

   If Node is missing or too old, guide me through installing the current LTS
   Windows .msi from https://nodejs.org/en/download, asking for approval before
   installation or elevation. If both compiler paths are absent, explain the
   prerequisite and guide me to Microsoft's official .NET Framework 4.x
   download; do not substitute an unrelated SDK or bypass the check.

   When prerequisites pass, give me the exact commands to run myself from the
   extracted repository root in my normal, non-administrator PowerShell.
   Do not run the companion installer from your Codex sandbox: it may use a
   different Windows account, and native-host registration uses HKCU. The
   commands are node .\scripts\install-native-host.mjs and then
   node .\scripts\smoke-installed-host.mjs, stopping if the first fails.
   Do not run npm install; the companion scripts use Node's built-ins.
   Help me interpret the output I paste back. Ask before making system changes. Do not
   disable antivirus, firewall, or security policy; do not use --full-auto;
   do not sign in for me or handle my credentials. If any step fails, stop and
   show me the error rather than claiming setup succeeded.
   ```

   If using the separate test bundle rather than GitHub source, tell Codex its
   ZIP path and expected SHA-256 from **Obtain the companion files**. Require
   it to verify the hash *before* extracting or running anything, then use the
   extracted bundle's root for the same two `node` commands.

   Run those commands in **your own ordinary PowerShell**, not inside the
   Codex sandbox. From the verified repository root:

   ```powershell
   node .\scripts\install-native-host.mjs
   if ($LASTEXITCODE -ne 0) { throw "Companion installation failed; stop before smoke test." }
   node .\scripts\smoke-installed-host.mjs
   if ($LASTEXITCODE -ne 0) { throw "Companion smoke test failed; inspect the error." }
   ```

   The installer writes Chrome and Brave native-host registration under your
   current user's `HKCU`. A Codex Windows sandbox can run as a different user,
   so its successful install would not register the host for your browser.

4. Once Codex reports that the companion smoke test passed, open the
   [Browser Control Chrome Web Store listing][store] in Chrome or Brave and
   click **Add to Chrome** yourself. Confirm the extension ID is
   `mpdfhhhjgbpdpfnkjbnboebdjokfjglf` in `chrome://extensions` or
   `brave://extensions`. Fully quit and reopen the browser. Open Browser Control
   from its toolbar icon, click **Retry connection** if shown, then **Sign in
   with ChatGPT** in the side panel. This is a separate, extension-specific
   sign-in even though you already signed in to the Codex CLI.

5. Send `Hello—please reply with one sentence.` in the side panel. If it
   fails, keep the exact error and use the troubleshooting table below.

## Manual Windows fallback

The commands below use **Windows PowerShell**, not Command Prompt or the
browser address bar. To open it, press Start, type `PowerShell`, and open
**Windows PowerShell**. Normal user privileges are enough for the companion;
the Node installer may show the usual Windows administrator prompt.

1. **Install Node.js.** In your browser, open the [official Node.js downloads][node]
   and download the **LTS Windows Installer (.msi)** for your machine (`x64` for
   most PCs, `ARM64` for ARM PCs). Run it with default options. Close PowerShell,
   open a new PowerShell window, and check:

   ```powershell
   node --version
   ```

   It must show Node 20 or newer. If Windows says `node` is not recognized,
   restart the machine and check again before continuing.

2. **Install Codex CLI.** Run OpenAI's [official Windows standalone install][codex]
   command in PowerShell:

   ```powershell
   powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
   ```

   Close and reopen PowerShell, then run `codex --version`. You do not need to
   sign in to Codex CLI separately: Browser Control will start a dedicated
   Codex session and offer **Sign in with ChatGPT** in its side panel.

3. **Check the current Windows launcher prerequisite.** In PowerShell, run:

   ```powershell
   Test-Path "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
   Test-Path "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
   ```

   At least one line must say `True`. The current test installer compiles a
   small native-messaging launcher with the .NET Framework C# compiler. If
   both say `False`, install or enable a supported [.NET Framework 4.x][dotnet]
   from Microsoft and check again. The newer standalone .NET SDK is not a
   substitute for the exact `csc.exe` path this installer checks. If it remains
   absent, stop and report this as an installer blocker; do not disable Windows
   security features.

4. **Verify the test ZIP.** Save it to Downloads. In PowerShell, run:

   ```powershell
   Get-FileHash "$env:USERPROFILE\Downloads\browser-control-companion-windows-linux-test-0.3.4.zip" -Algorithm SHA256
   ```

   Compare the hash with the value above, character for character. If it does
   not match, do not extract or run the archive.

5. **Extract and install the companion.** In File Explorer, right-click the ZIP
   and choose **Extract All**. Open the extracted folder. You should see
   `bridge` and `scripts` folders. Click File Explorer's address bar,
   type `powershell`, and press Enter. In the PowerShell window that opens, run:

   ```powershell
   node .\scripts\install-native-host.mjs
   node .\scripts\smoke-installed-host.mjs
   ```

   Expect `Installed com.codex.sidebar companion 0.3.4` and then
   `Installed native host passed a Chrome-like environment smoke test.`
   The installer registers the host for your user account; it does not need an
   administrator PowerShell window. Keep the extracted folder until testing is
   complete so you can rerun the smoke test or uninstaller.

6. **Install and use the extension.** Open the [Browser Control Store listing][store]
   in Chrome or Brave and choose **Add to Chrome**. Check the extension page
   (`chrome://extensions` or `brave://extensions`) shows ID
   `mpdfhhhjgbpdpfnkjbnboebdjokfjglf`. Fully quit and reopen the browser.
   Open Browser Control from its toolbar icon, choose **Retry connection** if
   shown, then choose **Sign in with ChatGPT** and finish sign-in in the browser.
   Return to the side panel and send a harmless first message such as
   `Hello—please reply with one sentence.`

## Linux desktop

These steps are for a normal, non-sandboxed Google Chrome or Brave install on
an `x86_64` or `aarch64` Linux desktop. Open a Terminal with your desktop's app
launcher. The commands below are for a POSIX-style shell such as Bash.

1. **Install basic download tools if missing.** On Ubuntu/Debian:

   ```sh
   sudo apt update
   sudo apt install -y curl ca-certificates xz-utils unzip
   ```

   On Fedora, use `sudo dnf install -y curl ca-certificates xz unzip` instead.
   Other distributions need equivalent `curl`, `tar`, and `xz` tools.

2. **Install Node.js LTS from the [official Node archive][node-archive].** The
   following pins Node 24.21.0 for a repeatable test and installs it in your
   home directory, without changing system packages:

   ```sh
   case "$(uname -m)" in
     x86_64) node_arch=x64 ;;
     aarch64) node_arch=arm64 ;;
     *) echo "Unsupported CPU for this test"; exit 1 ;;
   esac
   mkdir -p "$HOME/.local/opt/node-v24.21.0"
   curl -fL "https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-${node_arch}.tar.xz" -o "$HOME/Downloads/node-v24.21.0-linux-${node_arch}.tar.xz"
   tar -xJf "$HOME/Downloads/node-v24.21.0-linux-${node_arch}.tar.xz" --strip-components=1 -C "$HOME/.local/opt/node-v24.21.0"
   export PATH="$HOME/.local/opt/node-v24.21.0/bin:$PATH"
   node --version
   ```

   The version should be `v24.21.0`. Use the **same Terminal window** for the
   companion installation so its launcher records this permanent Node path.
   If your `Downloads` folder has another name or location, change that part
   of the two commands. Do not delete `$HOME/.local/opt/node-v24.21.0` while
   Browser Control is installed.

3. **Install Codex CLI** with OpenAI's [official Linux standalone install][codex]:

   ```sh
   curl -fsSL https://chatgpt.com/codex/install.sh | sh
   export PATH="$HOME/.local/bin:$PATH"
   codex --version
   ```

   Browser Control handles its own ChatGPT sign-in later; a separate CLI sign-in
   is not required for this test.

4. **Verify and extract the test bundle.** Save the ZIP to Downloads, then run:

   ```sh
   cd "$HOME/Downloads"
   sha256sum browser-control-companion-windows-linux-test-0.3.4.zip
   ```

   Compare the result to the hash above. If it differs, stop. Then extract:

   ```sh
   mkdir -p "$HOME/Downloads/browser-control-companion-test"
   unzip browser-control-companion-windows-linux-test-0.3.4.zip -d "$HOME/Downloads/browser-control-companion-test"
   cd "$HOME/Downloads/browser-control-companion-test"
   ```

   Confirm this directory contains `bridge` and `scripts`.

5. **Install and smoke-test the companion:**

   ```sh
   node scripts/install-native-host.mjs
   node scripts/smoke-installed-host.mjs
   ```

   Expect the same two success messages as on Windows. Keep the extracted
   folder until testing is complete.

6. **Install and use Browser Control** from the [Chrome Web Store][store].
   Fully quit and reopen Chrome or Brave, open the side panel, choose
   **Retry connection** if shown, and complete **Sign in with ChatGPT**. Send
   the harmless first message shown in the Windows steps.

## If something fails

| Symptom | Check |
| --- | --- |
| `node` or `codex` is not recognized | Open a new terminal. Check `node --version` and `codex --version` before rerunning the companion installer. On Linux, keep Node's permanent folder and the `PATH` export in the same Terminal session. |
| Windows installer says `csc.exe` is missing | Repeat the two `Test-Path` checks above; the current installer cannot proceed without one of those files. |
| C# `CS1009: Unrecognized escape sequence` | Pull the branch containing the Windows launcher fix, then rerun the installer from your normal PowerShell. This is a generated-launcher code error, not a missing prerequisite. |
| Smoke test times out at `bridge.status` | Pull the branch containing the live-pipe flush fix, reinstall from your normal PowerShell, and rerun the smoke test. If it still fails, capture its exact error. |
| C# `CS0016` says `native-host.exe` is in use | Save browser work and fully quit Chrome/Brave. Stop only a `native-host.exe` process whose full path matches this companion's launcher path, then reinstall. Do not kill every Node or Codex process. |
| `Native host not found` | Confirm both installer and smoke test succeeded under the same Windows account as the browser, check the Store extension ID, then fully quit and reopen the browser. Do not use a macOS companion archive. |
| `Codex not found` | Run `codex --version` and rerun the companion installer after repairing Codex. |
| Sign-in stalls on Windows | Keep the auth tab open. If Windows asks about a local Codex/Node callback listener, allow only the expected local connection; do not broadly disable the firewall. Capture the exact error if it fails. |
| Linux browser never connects | Snap/Flatpak browsers are unsupported. Confirm a native Chrome/Brave install and run `node scripts/smoke-installed-host.mjs` from the extracted bundle. |

For your Windows test, record the Windows version, Chrome/Brave version,
`node --version`, `codex --version`, both compiler-check results, installer
output, smoke-test result, sidebar result, and any exact error text. Do not
share login codes, tokens, passwords, or private page contents in the report.

To uninstall just the companion later, return to the extracted folder and run
`node .\scripts\uninstall-native-host.mjs` in Windows PowerShell or
`node scripts/uninstall-native-host.mjs` on Linux. This leaves the separate
Browser Control account/conversation data in place; use the extension's
**Delete all Browser Control data and sign out** action if you also want that
data removed.

[store]: https://chromewebstore.google.com/detail/browser-control/mpdfhhhjgbpdpfnkjbnboebdjokfjglf
[node]: https://nodejs.org/en/download
[node-archive]: https://nodejs.org/en/download/archive/v24.21.0
[codex]: https://learn.chatgpt.com/docs/codex/cli#getting-started
[dotnet]: https://dotnet.microsoft.com/en-us/download/dotnet-framework
[source]: https://github.com/07rjain/browser-control/tree/feat/desktop-companion
