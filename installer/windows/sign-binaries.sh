#!/usr/bin/env bash
# sign-binaries.sh — Sign Geniuz inner Windows binaries with the YubiKey
# before they get packaged by Inno Setup.
#
# Usage:
#   ./sign-binaries.sh STAGING-DIR
#
# Expects the staging dir to contain unsigned cross-compiled binaries:
#   geniuz.exe
#   geniuz-embed.exe
#   geniuz-tray.exe
#
# Signs each in place via sign-installer.sh. Run this BEFORE copying the
# staging dir to a Windows host for ISCC bundling, so the binaries packed
# inside Geniuz-Setup.exe are already signed. After ISCC produces the
# outer installer, sign that with sign-installer.sh too (dual-signing:
# inner binaries signed + outer installer signed).
#
# The YubiKey will prompt for the User PIN once per binary. Three PIN
# entries per release; tolerable for the safety it buys.

set -euo pipefail

STAGING="${1:-}"

if [[ -z "$STAGING" ]]; then
  cat >&2 <<EOF
Usage: $0 STAGING-DIR

Signs the three Geniuz inner binaries (geniuz.exe, geniuz-embed.exe,
geniuz-tray.exe) in place using sign-installer.sh. Run before transferring
the staging dir to a Windows host for Inno Setup bundling.
EOF
  exit 1
fi

if [[ ! -d "$STAGING" ]]; then
  echo "Error: staging dir not found: $STAGING" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIGN_CMD="${SCRIPT_DIR}/sign-installer.sh"

if [[ ! -x "$SIGN_CMD" ]]; then
  echo "Error: sign-installer.sh not executable at $SIGN_CMD" >&2
  exit 1
fi

BINARIES=(geniuz.exe geniuz-embed.exe geniuz-tray.exe)

# Preflight: confirm all binaries exist before prompting for any PIN.
for bin in "${BINARIES[@]}"; do
  path="$STAGING/$bin"
  if [[ ! -f "$path" ]]; then
    echo "Error: missing binary: $path" >&2
    exit 1
  fi
done

echo "→ Signing ${#BINARIES[@]} inner binaries in $STAGING"
echo "  YubiKey will prompt for User PIN once per binary."

for bin in "${BINARIES[@]}"; do
  echo
  echo "=== $bin ==="
  "$SIGN_CMD" "$STAGING/$bin"
done

echo
echo "✅ All inner binaries signed."
echo "   Next: copy $STAGING to the Windows host and run ISCC.exe Geniuz.iss"
echo "   Then sign the resulting Geniuz-Setup.exe with sign-installer.sh"
