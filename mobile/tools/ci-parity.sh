#!/usr/bin/env bash
# Starts the Go server (built as ../hadid-ci) on a throwaway data dir and runs the JS-vs-Go parity test.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=$(mktemp -d)
HADID_DIR="$DIR" ../hadid-ci --nowindow --console > "$DIR/log.txt" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
URL=""
for _ in $(seq 1 40); do
  URL=$(grep -o 'http://127.0.0.1:[0-9]*' "$DIR/log.txt" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 0.5
done
if [ -z "$URL" ]; then echo "server did not start:"; cat "$DIR/log.txt"; exit 1; fi
node tests/parity.js "$URL"
