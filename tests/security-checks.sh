#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[security-checks] running..."

echo "[1/5] Checking for dangerous dynamic code patterns"
if rg -n \
  --glob '*.js' \
  --glob '*.html' \
  --glob '!lib/jszip.min.js' \
  --glob '!lib/highlight.min.js' \
  'eval\(|new Function\(' "$ROOT" >/dev/null; then
  echo "Found disallowed dynamic code execution pattern."
  exit 1
fi

echo "[2/5] Checking for remote script references"
if rg -n --glob '*.html' --glob '*.js' '<script[^>]+src="https?://' "$ROOT" >/dev/null; then
  echo "Found remote script src reference."
  exit 1
fi

echo "[3/5] Verifying host permission scope"
MANIFEST_PATH="$ROOT/manifest.json" node <<'NODE'
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"));

const hosts = manifest.host_permissions || [];
if (hosts.length !== 1 || hosts[0] !== "https://chatgpt.com/*") {
  console.error("host_permissions not restricted to chatgpt.com.");
  process.exit(1);
}
NODE

echo "[4/5] Verifying no <all_urls> permission"
if rg -n '<all_urls>' "$ROOT/manifest.json" >/dev/null; then
  echo "Found forbidden <all_urls> scope."
  exit 1
fi

echo "[5/5] Verifying minimal required extension permissions are present"
MANIFEST_PATH="$ROOT/manifest.json" node <<'NODE'
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"));
const required = ["activeTab", "scripting", "downloads", "storage"];
const perms = new Set(manifest.permissions || []);
for (const perm of required) {
  if (!perms.has(perm)) {
    console.error(`Missing expected permission: ${perm}`);
    process.exit(1);
  }
}
NODE

echo "[security-checks] all checks passed"
