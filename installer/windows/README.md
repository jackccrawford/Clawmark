# Windows installer

Inno Setup script for building `Geniuz-Setup.exe` — per-user Windows installer.

## Build

Requires Inno Setup 6+ (`ISCC.exe`). Easiest install on Windows:

```powershell
choco install innosetup -y
```

Then from this directory, with `geniuz.exe`, `geniuz-embed.exe`, and
`geniuz-tray.exe` from `target/x86_64-pc-windows-msvc/release/` copied
alongside `Geniuz.iss` — **after** they've been signed (see Sign step 1):

```powershell
cd path\to\staging-dir
& 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' Geniuz.iss
```

Output: `output\Geniuz-Setup.exe` (~13 MB, LZMA2 compressed).

## Sign

Dual-signing: the three inner binaries are signed **before** Inno Setup
bundles them, and the outer `Geniuz-Setup.exe` is signed **after** ISCC
produces it. Both passes happen on Mac with the YubiKey FIPS plugged in
(EV cert in PIV slot 9A). The inner-binary pass closes the gap where
Windows would otherwise trigger fresh warnings the first time a user
launches `geniuz.exe` or the tray app after installation.

**Step 1 — sign inner binaries (on Mac, before transferring to Windows):**

```bash
./sign-binaries.sh /path/to/staging-dir
```

The staging dir holds the unsigned cross-compiled `.exe` files from
`target/x86_64-pc-windows-msvc/release/`. The helper signs all three in
place via `sign-installer.sh`. Prompts once per binary for the YubiKey
User PIN (three total).

**Step 2 — bundle on Windows:** see the `ISCC.exe` command above. ISCC
packs the now-signed inner binaries into `output\Geniuz-Setup.exe`.

**Step 3 — sign the outer installer (back on Mac):**

```bash
./sign-installer.sh output/Geniuz-Setup.exe
```

Signs in place. Prompts once for the YubiKey User PIN. Embeds an RFC 3161
timestamp from `ts.ssl.com` so signatures remain valid past cert expiration.
Result: the installer AND every inner binary are signed. Windows shows
"Verified publisher: Managed Ventures LLC" on the installer; inner binaries
don't trigger fresh warnings on first launch. See `sign-installer.sh` for
env-var overrides (cert path, hash alg, description fields) and dependencies.

## Trusted Signing (future)

`sign-installer-trustedsigning.sh` is the parallel signing script that uses
Azure Trusted Signing instead of the YubiKey — no hardware token required;
signs over a cloud HSM via API. Currently idle, waiting on Microsoft Identity
Validation to complete. When IV finishes and a certificate profile is created,
the daily-build flow can switch tools (same three-step dual-sign shape, same
input/output) without changing the Inno Setup pipeline.

## What it does

- Per-user install (no admin required)
- Installs to `%LOCALAPPDATA%\Programs\Geniuz\`
- Adds install dir to user PATH (idempotent)
- Runs `geniuz mcp install` postinstall — wires Claude Desktop config at
  `%APPDATA%\Claude\claude_desktop_config.json`
- Generates uninstaller (`unins000.exe`) that reverses everything but
  preserves `~/.geniuz/memory.db` (user data is sacred)

## Why per-user, not Program Files

Per-user means no admin elevation, no UAC prompt, faster install. Geniuz is a
personal-memory tool — installing it under one Windows account doesn't make
sense to share with another. Mac install pattern is the same (`~/Applications`
or `/Applications` is a user choice, MCP config is per-user).

## Why Inno Setup, not NSIS or MSI

Tried NSIS first — direct downloads from SourceForge consistently failed
across multiple mirrors (corrupted bytes, 404s). Tried Inno Setup direct
downloads from jrsoftware.org — same problem (404s on multiple version URLs).
Chocolatey absorbed the URL drift cleanly. Inno Setup also has nicer default
UX than NSIS for non-technical users.

MSI via WiX would be more enterprise-friendly but heavier toolchain. Inno
Setup is the right balance for a consumer product shipped to individual users.
