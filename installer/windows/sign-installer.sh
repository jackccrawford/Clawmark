#!/usr/bin/env bash
# sign-installer.sh — Sign Windows binaries with the Managed Ventures LLC
# EV code signing certificate stored on the YubiKey FIPS, PIV slot 9A.
#
# Usage:
#   ./sign-installer.sh INPUT.exe [OUTPUT.exe]
#
# If OUTPUT.exe is omitted, the input is signed in place.
#
# Requires:
#   - Homebrew packages: osslsigncode opensc libp11 ykman
#   - YubiKey FIPS plugged in, EV cert provisioned to PIV slot 9A
#   - Leaf cert (DER) at $GENIUZ_SIGN_LEAF_DER
#     (default: ~/Dev/.keys/managed ventures llc.der)
#
# Will prompt once for the YubiKey User PIN per run.
#
# Cert chain: leaf is read from disk; intermediate is fetched on every run
# from the AIA URL embedded in the leaf cert (no caching — CAs rotate
# intermediates over a cert's lifetime).

set -euo pipefail

# --- Tunables (override via env if needed) ---
BREW_PREFIX="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"

PKCS11_MODULE="${GENIUZ_SIGN_PKCS11_MODULE:-$BREW_PREFIX/lib/opensc-pkcs11.so}"
OSSL_ENGINES="${GENIUZ_SIGN_OSSL_ENGINES:-$BREW_PREFIX/lib/engines-3}"
OSSL_MODULES="${GENIUZ_SIGN_OSSL_MODULES:-$BREW_PREFIX/lib/ossl-modules}"

LEAF_DER="${GENIUZ_SIGN_LEAF_DER:-$HOME/Dev/.keys/managed ventures llc.der}"
INTERMEDIATE_URL="${GENIUZ_SIGN_INTERMEDIATE_URL:-http://cert.ssl.com/SSLcom-SubCA-EV-codeSigning-ECC-384-R2.cer}"
TIMESTAMP_URL="${GENIUZ_SIGN_TIMESTAMP_URL:-http://ts.ssl.com}"
HASH_ALG="${GENIUZ_SIGN_HASH_ALG:-sha256}"
DESCRIPTION="${GENIUZ_SIGN_DESCRIPTION:-Geniuz}"
INFO_URL="${GENIUZ_SIGN_INFO_URL:-https://geniuz.life}"

# --- Args ---
INPUT="${1:-}"
OUTPUT="${2:-}"

if [[ -z "$INPUT" ]]; then
  cat >&2 <<EOF
Usage: $0 INPUT.exe [OUTPUT.exe]

If OUTPUT.exe is omitted, INPUT.exe is signed in place.

Examples:
  $0 installer/windows/output/Geniuz-Setup.exe
  $0 build/geniuz.exe build/geniuz-signed.exe
EOF
  exit 1
fi

if [[ ! -f "$INPUT" ]]; then
  echo "Error: input file not found: $INPUT" >&2
  exit 1
fi

IN_PLACE=false
if [[ -z "$OUTPUT" ]]; then
  IN_PLACE=true
  OUTPUT="${INPUT}.signed.tmp"
fi

# --- Preflight ---
echo "→ Verifying YubiKey is plugged in..."
if ! ykman list 2>/dev/null | grep -q 'Serial:'; then
  echo "Error: no YubiKey detected. Plug it in and re-run." >&2
  exit 1
fi

echo "→ Verifying signing tools..."
for tool in osslsigncode openssl curl ykman; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Error: $tool not found in PATH." >&2
    echo "Install via: brew install osslsigncode opensc libp11 ykman" >&2
    exit 1
  fi
done

if [[ ! -f "$PKCS11_MODULE" ]]; then
  echo "Error: PKCS#11 module not found at $PKCS11_MODULE" >&2
  echo "Install via: brew install opensc" >&2
  exit 1
fi

if [[ ! -f "$LEAF_DER" ]]; then
  echo "Error: leaf cert not found at: $LEAF_DER" >&2
  echo "Set \$GENIUZ_SIGN_LEAF_DER to override the default location." >&2
  exit 1
fi

# --- Build cert chain on the fly ---
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "→ Fetching SSL.com intermediate cert from AIA URL..."
curl -fsS -o "$TMPDIR/intermediate.cer" "$INTERMEDIATE_URL"

echo "→ Building cert chain (leaf + intermediate as PEM)..."
openssl x509 -in "$LEAF_DER" -inform DER -out "$TMPDIR/leaf.pem" -outform PEM
openssl x509 -in "$TMPDIR/intermediate.cer" -inform DER -out "$TMPDIR/intermediate.pem" -outform PEM
cat "$TMPDIR/leaf.pem" "$TMPDIR/intermediate.pem" > "$TMPDIR/chain.pem"

chain_count="$(grep -c 'BEGIN CERTIFICATE' "$TMPDIR/chain.pem")"
if [[ "$chain_count" -ne 2 ]]; then
  echo "Error: cert chain build failed (expected 2 certs, got $chain_count)" >&2
  exit 1
fi

# --- Sign ---
echo "→ Signing $INPUT"
echo "  YubiKey will prompt for User PIN once."

OPENSSL_ENGINES="$OSSL_ENGINES" \
OPENSSL_MODULES="$OSSL_MODULES" \
osslsigncode sign \
  -pkcs11module "$PKCS11_MODULE" \
  -certs "$TMPDIR/chain.pem" \
  -key 'pkcs11:id=%01;type=private' \
  -h "$HASH_ALG" \
  -ts "$TIMESTAMP_URL" \
  -n "$DESCRIPTION" \
  -i "$INFO_URL" \
  -in "$INPUT" \
  -out "$OUTPUT"

# --- In-place handling ---
if [[ "$IN_PLACE" == true ]]; then
  mv "$OUTPUT" "$INPUT"
  OUTPUT="$INPUT"
fi

# --- Verify ---
echo
echo "→ Verifying signature..."
OPENSSL_ENGINES="$OSSL_ENGINES" \
OPENSSL_MODULES="$OSSL_MODULES" \
osslsigncode verify -in "$OUTPUT" 2>&1 | grep -E 'Subject:|Issuer:|Signing time|Timestamp|Number of verified|Succeeded|Failed' | sed 's/^/  /'

echo
echo "✅ Signed: $OUTPUT"
