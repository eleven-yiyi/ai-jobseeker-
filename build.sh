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

  # Copy everything into temp dir
  cp -r . "$tmp/"

  # Replace manifest with browser-specific one
  cp "$SCRIPT_DIR/$manifest_src" "$tmp/manifest.json"

  # Remove files that must not ship
  rm -rf  "$tmp/.git" "$tmp/node_modules" "$tmp/dist" "$tmp/tests" "$tmp/docs"
  rm -f   "$tmp/.gitignore" "$tmp/.DS_Store" "$tmp/background/.DS_Store"
  rm -f   "$tmp/background/config.js" "$tmp/extension_key.pem"
  rm -f   "$tmp/build.sh" "$tmp/package.json" "$tmp/package-lock.json"
  rm -f   "$tmp/CLAUDE.md" "$tmp/prompts.md" "$tmp/logo.png"
  rm -f   "$tmp/manifest.edge.json" "$tmp/manifest.firefox.json"
  # Remove any lingering personal files
  find "$tmp" -name "*.pdf"    -delete
  find "$tmp" -name "*.pem"    -delete
  find "$tmp" -maxdepth 1 -name "*.md" -delete

  (cd "$tmp" && zip -rq "$SCRIPT_DIR/$out" .)
  rm -rf "$tmp"
  echo "  $out"
}

echo "Building..."
pack chrome  manifest.json
pack edge    manifest.edge.json
pack firefox manifest.firefox.json
echo "Done."
