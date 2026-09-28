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
  set CODEX_BIN to codex.exe if `where codex` only finds the npm .cmd shim.
- Windows also needs the .NET Framework C# compiler, csc.exe, to build the
  native-host launcher.
- Browser Control installed from the Chrome Web Store
- An eligible ChatGPT/Codex subscription

Snap and Flatpak Chrome are not supported. ChromeOS, Firefox, and Safari are
not supported.

Install or update
-----------------

1. Extract this ZIP.
2. Open a terminal in the extracted folder.
3. Run: node scripts/install-native-host.mjs
4. Restart Chrome or Brave, then reopen Browser Control.

Verify
------

Run: node scripts/smoke-installed-host.mjs

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
