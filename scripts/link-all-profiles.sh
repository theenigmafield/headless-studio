#!/usr/bin/env bash
# Link this checkout into every local Hermes profile and enable it there.
# One checkout, many symlinks: every profile runs the same version, and a
# `git pull` here updates them all. Safe to re-run.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
H="${HERMES_ROOT:-$HOME/.hermes}"

homes=("$H")
for p in "$H"/profiles/*/; do [ -f "$p/config.yaml" ] && homes+=("${p%/}"); done

for h in "${homes[@]}"; do
  t="$h/plugins/headless-studio"
  mkdir -p "$h/plugins"
  if [ -e "$t" ] && [ ! -L "$t" ]; then echo "skip $(basename "$h"): a real folder is already there"; continue; fi
  ln -sfn "$SRC" "$t"
  if [ "$h" = "$H" ]; then prof=default; else prof="$(basename "$h")"; fi
  hermes -p "$prof" plugins enable headless-studio >/dev/null 2>&1 || true
  echo "linked + enabled: $prof"
done
echo "Restart Hermes, then turn Headless Studio on once in Capabilities > Plugins."
