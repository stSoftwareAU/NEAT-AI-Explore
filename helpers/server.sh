#!/bin/bash
set -euo pipefail

# Local Server Starter Script for NEAT-AI Explore
#
# Uses Deno (JSR Std modules) to serve this repo over HTTP.
#
# Usage:
#   ./helpers/server.sh [port] [dir]
#
# Defaults:
# - port: 8000
# - dir:  docs  (matches the deployed GitHub Pages / PWA output)

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Change to project root directory
cd "$PROJECT_ROOT"

# Check if Deno is installed
if ! command -v deno &> /dev/null; then
  echo "❌ Error: Deno is not installed or not in PATH"
  echo "Please install Deno from https://deno.com/"
  exit 1
fi

# Get args or use defaults
PORT="${1:-8000}"
DIR="${2:-docs}"

echo "🚀 Starting NEAT-AI Explore local server"
echo "📁 Project root: $PROJECT_ROOT"
echo "📦 Serving dir:   $DIR"
echo "🌐 URL:           http://localhost:$PORT"
echo "⏹️  Press Ctrl+C to stop the server"
echo ""

deno run --allow-net --allow-read --allow-env "$SCRIPT_DIR/server.ts" "$PORT" "$DIR"

