# ADR 0003: Desktop companion for macOS, Linux, and Windows

- Status: Accepted
- Date: 2026-09-28
- Owner: `codex-chrome-extension-manager`

## Decision

Install the same `com.codex.sidebar` companion on desktop macOS, Linux, and Windows. The extension bundle does not change by operating system and gains no new Chrome permissions.

Chrome and Brave remain the supported browsers. Chromium on Linux is best-effort. ChromeOS, mobile browsers, Firefox, Safari, and Snap or Flatpak Chrome are unsupported.

## Why

The side panel already talks to the companion through `chrome.runtime.connectNative("com.codex.sidebar")`. The macOS-only installer was what stopped Linux and Windows from connecting. Each operating system looks up that host name in a different place, and Windows cannot start a batch file as a native-messaging host.

## Install locations

`~/.codex-sidebar` remains the isolated Codex home on every desktop. On Windows that is `%USERPROFILE%\.codex-sidebar`. The installer does not read or write `~/.codex`.

- macOS: `~/Library/Application Support/Browser Control`, with a `#!/bin/sh` launcher at `bin/native-host`. Manifest files go in the Chrome and Brave `NativeMessagingHosts` directories. This matches the existing macOS install.
- Linux: `$XDG_DATA_HOME/browser-control` or `~/.local/share/browser-control`, with the same shell launcher. Manifest files go under the Chrome, Chromium, and Brave config directories (`$XDG_CONFIG_HOME` or `~/.config`).
- Windows: `%LOCALAPPDATA%\Browser Control`. The manifest `path` is `bin\native-host.exe`. Chrome's registry entries are `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.codex.sidebar` and the Brave equivalent. Both values point at the companion's JSON manifest.

The Windows launcher is a small program generated at install time and compiled with the .NET Framework C# compiler (`csc.exe`). It forwards Chrome's binary native-messaging stdio to `node.exe` and the packaged `native-host.mjs`. The manifest cannot pass arguments, so the path cannot be `node.exe` itself, and Chrome does not start `.cmd` or `.bat` hosts.

The launcher records absolute paths for Node and Codex. Chrome starts the host with a short PATH, so the install must not depend on `which` or `where` at chat time. On Windows, Codex must be `codex.exe`. An npm `codex.cmd` shim is rejected. `CODEX_BIN` overrides discovery.

When Chrome disconnects, the host stops Codex and exits. On Windows it stops the child process tree with `taskkill /T /F`.

## Consequences

- `npm run install:host` and `npm run uninstall:host` follow the current operating system. The `:mac` script names remain aliases.
- Uninstall removes the host registration and companion files. It still leaves `~/.codex-sidebar` in place.
- Skill files saved on Windows accept CRLF, and reserved device names such as `con` are stored as `con-skill`.
- Snap and Flatpak Chrome can see the manifest and still fail to launch a program outside the sandbox. The Linux installer warns when `google-chrome` is on one of those paths.
- Signed installers are still future work. This change does not update the Chrome Web Store listing.
