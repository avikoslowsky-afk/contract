#!/bin/zsh
cd "$(dirname "$0")"
echo "Starting Contract Operations for this Mac and your local network..."
echo ""
echo "On this Mac:"
echo "  http://127.0.0.1:4182/"
echo ""
echo "From another device on the same Wi-Fi, try the Local network URL printed below."
echo ""
HOST=0.0.0.0 PORT=4182 /Applications/Codex.app/Contents/Resources/node server.mjs
