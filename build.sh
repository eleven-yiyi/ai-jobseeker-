#!/usr/bin/env bash
# Packages the extension for Chrome, Edge, and Firefox.
# Output: dist/chrome.zip  dist/edge.zip  dist/firefox.zip
# Usage: bash build.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p dist

pack() {
  local browser="$1"
  local manifest_src="$2"
  local out="dist/${browser}.zip"
  local tmp
  tmp=$(mktemp -d)

  # Copy only the files that should ship, excluding dev/private artifacts
  rsync -a \
    --exclude=".git" \
    --exclude=".claude" \
    --exclude=".superpowers" \
    --exclude=".DS_Store" \
    --exclude="node_modules" \
    --exclude="dist" \
    --exclude="tests" \
    --exclude="docs" \
    --exclude="background/config.js" \
    --exclude="extension_key.pem" \
    --exclude="build.sh" \
    --exclude="package.json" \
    --exclude="package-lock.json" \
    --exclude="CLAUDE.md" \
    --exclude="prompts.md" \
    --exclude="logo.png" \
    --exclude="manifest.edge.json" \
    --exclude="manifest.firefox.json" \
    --exclude="*.pdf" \
    --exclude="*.pem" \
    --exclude="*.md" \
    . "$tmp/"

  # Override manifest with browser-specific version
  cp "$SCRIPT_DIR/$manifest_src" "$tmp/manifest.json"

  rm -f "$SCRIPT_DIR/$out"
  (cd "$tmp" && zip -rq "$SCRIPT_DIR/$out" .)
  rm -rf "$tmp"
  echo "  $out"
}

echo "Building..."
pack chrome  manifest.json
pack edge    manifest.edge.json
pack firefox manifest.firefox.json
echo "Done."
