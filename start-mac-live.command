#!/bin/zsh
cd "$(dirname "$0")"

if [ -x "/Applications/Codex.app/Contents/Resources/node" ]; then
  NODE_BIN="/Applications/Codex.app/Contents/Resources/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  echo "Node.js was not found."
  echo "Install Node.js from https://nodejs.org or run this from Codex on this Mac."
  read -r "?Press Enter to close."
  exit 1
fi

export PORT="${PORT:-4182}"
export HOST="${HOST:-127.0.0.1}"

"$NODE_BIN" server.mjs
