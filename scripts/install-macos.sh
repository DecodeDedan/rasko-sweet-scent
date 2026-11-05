#!/usr/bin/env bash
#
# Install the latest RSS Management System on Apple Silicon macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/DecodeDedan/rasko-sweet-scent/main/scripts/install-macos.sh | bash
#
# A browser download adds Apple's quarantine flag to an unsigned or
# ad-hoc-signed DMG. Downloading through curl avoids that flag. The release
# asset is still verified against GitHub's published SHA-256 digest before it
# is opened or installed.

set -euo pipefail

REPO="DecodeDedan/rasko-sweet-scent"
APP_NAME="RSS Management System.app"
API_URL="https://api.github.com/repos/$REPO/releases/latest"
CURL_ARGS=(--fail --silent --show-error --location --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 20)

log() { printf '==> %s\n' "$*" >&2; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer is for macOS."
[ "$(uname -m)" = "arm64" ] || fail "This build is for Apple Silicon Macs."

resolve_release() {
  local json="$1"
  RELEASE_JSON="$json" osascript -l JavaScript -e '
    const env = $.NSProcessInfo.processInfo.environment;
    const release = JSON.parse(ObjC.unwrap(env.objectForKey("RELEASE_JSON")));
    const asset = (release.assets || []).find((a) => a.name.endsWith("_aarch64.dmg"));
    if (!asset) throw new Error("No Apple Silicon DMG in " + release.tag_name);
    if (!/^sha256:[0-9a-f]{64}$/.test(asset.digest || "")) {
      throw new Error("GitHub published no SHA-256 digest for " + asset.name);
    }
    asset.browser_download_url + " " + asset.digest.slice("sha256:".length);
  '
}

RELEASE_JSON="$(curl "${CURL_ARGS[@]}" -H "Accept: application/vnd.github+json" "$API_URL")" \
  || fail "Could not reach GitHub."
read -r DMG_URL DMG_SHA256 <<<"$(resolve_release "$RELEASE_JSON")" \
  || fail "Could not locate the latest Apple Silicon release."

WORK="$(mktemp -d "${TMPDIR:-/tmp}/rasko-install.XXXXXX")"
MOUNT="$WORK/mnt"
cleanup() {
  if [ -d "$MOUNT" ]; then hdiutil detach -quiet "$MOUNT" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

DMG="$WORK/$(basename "$DMG_URL")"
log "Downloading $(basename "$DMG_URL")"
curl "${CURL_ARGS[@]}" --progress-bar -o "$DMG" "$DMG_URL" || fail "Download failed."

ACTUAL_SHA256="$(shasum -a 256 "$DMG" | awk '{print $1}')"
[ "$ACTUAL_SHA256" = "$DMG_SHA256" ] \
  || fail "Checksum mismatch. Expected $DMG_SHA256, got $ACTUAL_SHA256."
log "Checksum OK"

if [ -w /Applications ]; then
  DEST_DIR="/Applications"
else
  DEST_DIR="$HOME/Applications"
fi
mkdir -p "$DEST_DIR"
DEST="$DEST_DIR/$APP_NAME"
mkdir -p "$MOUNT"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$MOUNT" "$DMG" \
  || fail "Could not open the disk image."
[ -d "$MOUNT/$APP_NAME" ] || fail "$APP_NAME not found in the disk image."

if pgrep -xq "RSS Management System"; then
  osascript -e 'tell application "RSS Management System" to quit' >/dev/null 2>&1 || true
  sleep 2
fi

STAGED="$DEST_DIR/.$APP_NAME.installing"
rm -rf "$STAGED"
ditto "$MOUNT/$APP_NAME" "$STAGED"
rm -rf "$DEST"
mv "$STAGED" "$DEST"

VERSION="$(defaults read "$DEST/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "unknown")"
log "Installed RSS Management System $VERSION to $DEST"
open "$DEST"
