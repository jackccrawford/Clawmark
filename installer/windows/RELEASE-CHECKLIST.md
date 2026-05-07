# Windows release checklist

Step-by-step runbook for shipping a signed Geniuz Windows installer to GitHub Releases.

This is **two-machine work**: build on a Windows box (Inno Setup runs there), sign on a Mac (the YubiKey FIPS + EV cert provisioning lives there). Plan ~1-2 hours start to finish if both environments are already set up; longer the first time.

---

## 0. Prerequisites

### On the Windows machine (referred to as Orbit below — adapt hostname for whichever box you're using)

- [ ] **Rust toolchain** — `rustup` with the `x86_64-pc-windows-msvc` target. Check with `rustc --version` and `rustup target list --installed`.
- [ ] **Inno Setup 6** — `ISCC.exe` on PATH. Easiest install: `choco install innosetup -y` (Chocolatey absorbs the URL drift; direct downloads from jrsoftware.org are unreliable).
- [ ] **Git + GitHub auth** — for cloning the repo and pulling latest. `gh auth status` to verify.
- [ ] **Network access** — to fetch crates.io deps and the ONNX runtime download.

### On the Mac

- [ ] **YubiKey FIPS plugged in** — EV cert provisioned to PIV slot 9A. Pulled out of the safe.
- [ ] **Signing toolchain installed** — `osslsigncode`, `opensc`, `libp11`, `ykman` (all via Homebrew). Run `ykman list` to verify the YubiKey is detected.
- [ ] **VirusTotal API key** — at `~/Dev/.keys/virustotal.txt`. Used for the post-sign scan submission.
- [ ] **GitHub CLI authed** — `gh auth status` shows `jackccrawford` logged in with repo permissions.

---

## 1. Sync the repo on Orbit

```powershell
cd C:\Dev          # or wherever you keep dev work
git clone https://github.com/jackccrawford/geniuz.git    # first time
# OR
cd C:\Dev\geniuz && git checkout main && git pull        # subsequent times
```

- [ ] Verify the version on disk matches the intended release tag:
  ```powershell
  type Cargo.toml | findstr version
  ```
  Should show `version = "1.2.0"` (or whatever's current).

---

## 2. Build Rust binaries on Orbit

```powershell
cd C:\Dev\geniuz
cargo build --release --features tray
```

- [ ] Check the three executables exist:
  ```powershell
  dir target\release\geniuz.exe target\release\geniuz-embed.exe target\release\geniuz-tray.exe
  ```

**Why `--features tray`:** The `geniuz-tray` binary is feature-gated in `Cargo.toml` (pulls in `tray-icon`, `image`, `winit`). Without the flag, only `geniuz.exe` and `geniuz-embed.exe` build. The Inno Setup script expects all three; missing tray binary = installer build fails or ships without tray.

**Likely failure modes:**

- `linker not found` — install MSVC build tools (`rustup toolchain install stable-x86_64-pc-windows-msvc` or VS Build Tools).
- ONNX runtime download timeout — re-run; the `ort` crate downloads `onnxruntime.dll` on first build, cached after.
- Compile failure on `dirs` or platform-specific deps — `cargo update` and retry.

---

## 3. Stage binaries for Inno Setup

Per `installer/windows/README.md`, the Inno Setup script expects `geniuz.exe` and `geniuz-embed.exe` (plus tray) alongside `Geniuz.iss` in a staging directory. The `.iss` file is in `installer/windows/`; copy the built binaries there:

```powershell
cd C:\Dev\geniuz\installer\windows
copy ..\..\target\release\geniuz.exe .
copy ..\..\target\release\geniuz-embed.exe .
copy ..\..\target\release\geniuz-tray.exe .
```

- [ ] Verify the three .exe files are alongside `Geniuz.iss` in `installer\windows\`.

---

## 4. Run Inno Setup

```powershell
cd C:\Dev\geniuz\installer\windows
& 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' Geniuz.iss
```

- [ ] Check the output:
  ```powershell
  dir output\Geniuz-Setup.exe
  ```
  Should be ~20MB. The `output\` folder is `.gitignore`d, so it's local to Orbit only.

- [ ] Smoke-test: double-click `output\Geniuz-Setup.exe` on Orbit, walk through the install (or cancel partway). At this point it's **unsigned** — Windows will show the "Unknown publisher" friction. That's expected; we sign on the Mac next.

---

## 5. Transfer signed-target installer to Mac

Three options, pick the one that fits your setup:

- **scp from Mac**: `scp orbit:C:/Dev/geniuz/installer/windows/output/Geniuz-Setup.exe ~/Dev/geniuz/installer/windows/output/Geniuz-Setup.exe`
- **Network share**: copy via Finder if Orbit is exposed via SMB.
- **GitHub artifact**: push a temporary branch with the .exe and pull on Mac (heavy for a 20MB binary; cleaner to use direct copy).

- [ ] Verify the binary landed at `~/Dev/geniuz/installer/windows/output/Geniuz-Setup.exe` on the Mac.
- [ ] Note its hash for sanity checking later: `shasum -a 256 ~/Dev/geniuz/installer/windows/output/Geniuz-Setup.exe`

---

## 6. Sign on Mac

```bash
~/Dev/geniuz/installer/windows/sign-installer.sh \
  ~/Dev/geniuz/installer/windows/output/Geniuz-Setup.exe
```

- [ ] **YubiKey User PIN prompt** appears — type it from `~/Dev/.keys/.yubi`.
- [ ] Watch for `→ Signing ...`, then `Connecting to http://ts.ssl.com`, then `Succeeded`.
- [ ] Verification block prints: signer subject, issuer, timestamp, "Number of verified signatures: 1, Succeeded".
- [ ] Final line: `✅ Signed: ...`.

**Likely failure modes:**

- `no YubiKey detected` — re-plug the YubiKey, give USB ~5 seconds to register, retry.
- `Failed to find and load 'pkcs11' engine` — `OPENSSL_ENGINES` / `OPENSSL_MODULES` env vars missing; the script sets these but if you ran the command manually, check `/opt/homebrew/lib/engines-3` exists.
- `PIN locked after too many attempts` — STOP. Use the PUK to unlock via `ykman piv access unblock-pin`. Avoid retrying with guesses.

- [ ] Sanity-check the signed file's hash (different from unsigned hash; signing modifies the .exe):
  ```bash
  shasum -a 256 ~/Dev/geniuz/installer/windows/output/Geniuz-Setup.exe
  ```

---

## 7. Upload to GitHub Releases

```bash
gh release upload v1.2.0 \
  ~/Dev/geniuz/installer/windows/output/Geniuz-Setup.exe \
  --clobber --repo jackccrawford/Geniuz
```

(Use the appropriate tag — bump the placeholder if shipping a different version.)

- [ ] Verify the upload:
  ```bash
  gh release view v1.2.0 --repo jackccrawford/Geniuz | grep Geniuz-Setup
  ```

---

## 8. Hash-verify the public download

```bash
shasum -a 256 ~/Dev/geniuz/installer/windows/output/Geniuz-Setup.exe
curl -sL "https://github.com/jackccrawford/Geniuz/releases/latest/download/Geniuz-Setup.exe" | shasum -a 256
```

- [ ] Both hashes identical. If not, re-upload (CDN cache hiccup or wrong file).

---

## 9. VirusTotal scan

```bash
HASH=$(shasum -a 256 ~/Dev/geniuz/installer/windows/output/Geniuz-Setup.exe | awk '{print $1}')
curl -s -H "x-apikey: $(grep -E '^[a-f0-9]{64}$' ~/Dev/.keys/virustotal.txt)" \
  -F "file=@$HOME/Dev/geniuz/installer/windows/output/Geniuz-Setup.exe" \
  "https://www.virustotal.com/api/v3/files"
echo "Wait ~60s for scan to complete..."
sleep 60
curl -s -H "x-apikey: $(grep -E '^[a-f0-9]{64}$' ~/Dev/.keys/virustotal.txt)" \
  "https://www.virustotal.com/api/v3/files/$HASH" | python3 -c "
import json, sys
data = json.load(sys.stdin)
stats = data.get('data', {}).get('attributes', {}).get('last_analysis_stats', {})
print(f'Malicious: {stats.get(\"malicious\", 0)} / Suspicious: {stats.get(\"suspicious\", 0)} / Clean: {stats.get(\"undetected\", 0)} / Unsupported: {stats.get(\"type-unsupported\", 0)} / Total: {sum(stats.values())}')
"
echo "Public scan URL: https://www.virustotal.com/gui/file/$HASH/detection"
```

- [ ] Expect 0 malicious, 0 suspicious. Note the public scan URL for the next step.

---

## 10. Update trust signals (README + website)

Replace the old Windows VT URL/hash with the new one in two surfaces:

```bash
OLD_HASH="<previous Windows .exe hash>"
NEW_HASH="<new Windows .exe hash from step 8>"

cd ~/Dev/geniuz
sed -i '' "s|$OLD_HASH|$NEW_HASH|g" README.md

cd ~/Dev/geniuz-life
sed -i '' "s|$OLD_HASH|$NEW_HASH|g" src/pages/index.astro
```

- [ ] Verify the substitutions:
  ```bash
  grep "$NEW_HASH" ~/Dev/geniuz/README.md
  grep -c "$NEW_HASH" ~/Dev/geniuz-life/src/pages/index.astro    # expect 2
  ```

- [ ] Commit and push both:
  ```bash
  cd ~/Dev/geniuz && git add README.md && \
    git commit -m "docs: update Windows VirusTotal scan link for new release" && \
    git push origin main

  cd ~/Dev/geniuz-life && git add src/pages/index.astro && \
    git commit -m "Trust line: update Windows VirusTotal link for new release" && \
    git push origin main
  ```

- [ ] Netlify auto-deploys geniuz.life within ~1-2 minutes.

---

## 11. Verify the full user journey

On Orbit (or any Windows box):

- [ ] Visit `https://geniuz.life`.
- [ ] Click "Get Geniuz for Windows".
- [ ] Browser downloads the new `Geniuz-Setup.exe`.
- [ ] Right-click → Properties → Digital Signatures → "Managed Ventures LLC" listed; details show the new signing time.
- [ ] Run the installer. SmartScreen popup probably still appears (publisher reputation hasn't crossed the threshold yet — see `installer/windows/RELEASE-CHECKLIST.md`'s sibling Genesis signal `00000000:3F434311` for the campaign plan).
- [ ] Click "More info" → "Run anyway" → installer proceeds → "Verified publisher: Managed Ventures LLC" in the UAC dialog (or absent if per-user install).
- [ ] After install, in PowerShell:
  ```powershell
  geniuz --version              # 1.2.0
  geniuz settings list          # shows the four settings (or the user's prior values)
  geniuz settings path          # %USERPROFILE%\.geniuz\settings.json
  ```

- [ ] Memories and settings preserved if Geniuz was installed previously.

---

## 12. Cleanup

- [ ] Pull YubiKey, return to physical safe.
- [ ] Optional: delete the staging copies of binaries in `installer\windows\` on Orbit (they re-build on next release).
- [ ] No traces of the PIN anywhere in shell history (sign-installer.sh's PIN prompt doesn't echo and isn't logged; verify just to be safe).

---

## Reference signals

- Shipping playbook (full pipeline both platforms): `96A3AC4E:562C9D0D`
- v1.2.0 session arc (what's in 1.2.0): `96A3AC4E:0EBC1F2D`
- Microsoft SmartScreen + campaign plan: `00000000:3F434311`
- Local cert/PIN/path specifics: `~/Dev/.keys/signing-flow.md`

---

*Last updated: May 7 2026, after Microsoft case eed2a1e1 review completed and Orbit became available for Windows builds.*
