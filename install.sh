#!/bin/sh
set -e

REPO="jackccrawford/clawmark"
INSTALL_DIR="${CLAWMARK_INSTALL_DIR:-$HOME/.local/bin}"

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)  os="linux" ;;
  Darwin) os="darwin" ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)  arch="amd64" ;;
  aarch64|arm64) arch="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

NAME="${os}-${arch}"

# Get latest release tag
LATEST=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
if [ -z "$LATEST" ]; then
  echo "Failed to fetch latest release" >&2
  exit 1
fi

URL="https://github.com/${REPO}/releases/download/${LATEST}/clawmark-${NAME}.tar.gz"

echo "Installing clawmark ${LATEST} (${NAME})..."

# Download and extract
mkdir -p "$INSTALL_DIR"
curl -fsSL "$URL" | tar xz -C "$INSTALL_DIR"
chmod +x "${INSTALL_DIR}/clawmark"

# Verify
if "${INSTALL_DIR}/clawmark" --version > /dev/null 2>&1; then
  VERSION=$("${INSTALL_DIR}/clawmark" --version)
  echo ""
  echo "  Installed: ${VERSION}"
  echo "  Location:  ${INSTALL_DIR}/clawmark"
  echo ""
  # Check PATH
  case ":$PATH:" in
    *":${INSTALL_DIR}:"*) ;;
    *) echo "  Add to PATH: export PATH=\"${INSTALL_DIR}:\$PATH\"" ;;
  esac
  echo "  Next: clawmark signal -c \"Hello from clawmark\" -g \"first signal\""
else
  echo "Installation failed" >&2
  exit 1
fi
