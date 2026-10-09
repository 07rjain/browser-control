Browser Control Companion
=========================

This local companion connects the Browser Control Chromium extension to the
Codex CLI installed on this computer. It does not provide a remote service.

Requirements
------------

- macOS, Linux, or Windows
- Desktop Google Chrome or Brave. Chromium on Linux is best-effort.
- Node.js 20 or newer
- Codex CLI. On macOS and Linux it must be executable as `codex`. On Windows,
  the companion supports the standalone codex.exe and a resolvable npm
  codex.cmd shim. Set CODEX_BIN only for a nonstandard install location.
- Windows also needs the .NET Framework C# compiler, csc.exe, to build the
  native-host launcher.
- Browser Control installed from the Chrome Web Store
- An eligible ChatGPT/Codex subscription

Snap and Flatpak Chrome are not supported. ChromeOS, Firefox, and Safari are
not supported.

Install or update
-----------------

1. Extract this ZIP.
2. Open a terminal in the extracted folder. On Windows, use your own normal
   PowerShell session, not a Codex sandbox account: registration uses HKCU.
3. Run: node scripts/install-native-host.mjs
4. Restart Chrome or Brave, then reopen Browser Control.

Verify
------

After successful installation, run: node scripts/smoke-installed-host.mjs
The companion setup scripts do not require npm install.

Uninstall
---------

Run: node scripts/uninstall-native-host.mjs

Uninstalling the companion keeps Browser Control account and conversation data
in ~/.codex-sidebar (on Windows, %USERPROFILE%\.codex-sidebar). To delete that
data too, first use Settings > Delete all Browser Control data in the extension.

Security
--------

Download this archive only from the official Browser Control GitHub release.
Compare its SHA-256 checksum with SHA256SUMS.txt before installation.

Support and privacy
-------------------

https://07rjain.github.io/browser-control-support/support.html
https://07rjain.github.io/browser-control-support/privacy.html
