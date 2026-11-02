#!/bin/bash
# Pocket Terminal, one-line install for macOS and Linux:
#
#   curl -fsSL https://terminal.utsavdoye.com/install.sh | bash
#
# Downloads the latest version from GitHub into ~/.pocket-terminal/app, then runs its installer.
# Run it again any time to update. Your pairing stays (it lives in ~/.pocket-terminal).
set -euo pipefail
REPO="${POCKET_REPO:-utsavdoye/pocket-terminal}"
BRANCH="${POCKET_BRANCH:-main}"
DEST="$HOME/.pocket-terminal/app"

case "$(uname)" in Darwin|Linux) ;; *) echo "This is for macOS and Linux. On Windows run in PowerShell:"; echo "  irm https://terminal.utsavdoye.com/install.ps1 | iex"; exit 1;; esac
if ! command -v node >/dev/null; then
  echo "Pocket Terminal needs Node.js 18.20 or newer. Install it, then run this line again:"
  if [ "$(uname)" = "Darwin" ]; then echo "  https://nodejs.org (LTS), or: brew install node"
  else echo "  https://nodejs.org (LTS), or your package manager, e.g.: sudo apt install -y nodejs npm"; fi
  exit 1
fi

echo "Downloading Pocket Terminal…"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar xz -C "$TMP"
SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -f "$SRC/agent/agent.js" ] || { echo "The download looks wrong. Try again in a minute."; exit 1; }
mkdir -p "$HOME/.pocket-terminal"; chmod 700 "$HOME/.pocket-terminal"
rm -rf "$DEST.new"; mv "$SRC" "$DEST.new"
rm -rf "$DEST"; mv "$DEST.new" "$DEST"
echo "Installed to $DEST"

# The installer asks a few questions (your password for sleep control, then pairing), so it
# reads from your keyboard, not from this pipe.
exec bash "$DEST/agent/install.sh" </dev/tty
