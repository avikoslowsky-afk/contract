#!/bin/zsh
cd "$(dirname "$0")"
echo "Starting Contract Operations with free local AI through Ollama..."
echo ""
echo "This needs Ollama installed from https://ollama.com"
echo "It also needs the model downloaded once with:"
echo "  ollama pull llama3.1"
echo ""
echo "App URL:"
echo "  http://127.0.0.1:4182/"
echo ""
OLLAMA_MODEL=llama3.1 PORT=4182 /Applications/Codex.app/Contents/Resources/node server.mjs
