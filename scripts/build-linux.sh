#!/usr/bin/env bash
set -euo pipefail

# Load env vars (for TAURI_SIGNING_PRIVATE_KEY_PATH)
ENV_FILE="apps/desktop/src-tauri/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# Require signing key for updater
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "Error: TAURI_SIGNING_PRIVATE_KEY is not set"
  echo "  Local: set it in apps/desktop/src-tauri/.env"
  echo "  CI:    set it as a GitHub Actions secret"
  exit 1
fi

TARGET="x86_64-unknown-linux-gnu"
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

echo "==> Building TectonicEditor $TAG for Linux ($TARGET)"

# Build
export TECTONIC_DEP_BACKEND=pkg-config
export CXXFLAGS="-std=c++17"
export CFLAGS=""

pnpm --filter @tectonic-editor/desktop tauri build --target "$TARGET"

BUNDLE_DIR="apps/desktop/src-tauri/target/$TARGET/release/bundle"

# Find outputs
DEB_PATH=$(find "$BUNDLE_DIR/deb" -name '*.deb' 2>/dev/null | head -1)
RPM_PATH=$(find "$BUNDLE_DIR/rpm" -name '*.rpm' 2>/dev/null | head -1)
APPIMAGE_PATH=$(find "$BUNDLE_DIR/appimage" -name '*.AppImage' 2>/dev/null | head -1)
APPIMAGE_SIG=$(find "$BUNDLE_DIR/appimage" -name '*.AppImage.sig' 2>/dev/null | head -1)
APPIMAGE_UPLOAD_PATH=""
if [ -n "$APPIMAGE_PATH" ]; then
  APPIMAGE_UPLOAD_PATH="apps/desktop/src-tauri/target/TectonicEditor-Linux.AppImage"
  cp "$APPIMAGE_PATH" "$APPIMAGE_UPLOAD_PATH"
fi

ASSETS=()
[ -n "$DEB_PATH" ] && ASSETS+=("$DEB_PATH")
[ -n "$RPM_PATH" ] && ASSETS+=("$RPM_PATH")
[ -n "$APPIMAGE_UPLOAD_PATH" ] && ASSETS+=("$APPIMAGE_UPLOAD_PATH")

if [ ${#ASSETS[@]} -eq 0 ]; then
  echo "Error: No build artifacts found in $BUNDLE_DIR"
  exit 1
fi

echo "==> Build artifacts:"
printf "    %s\n" "${ASSETS[@]}"

# --- Auto-updater artifacts ---
if [ -n "$APPIMAGE_PATH" ] && [ -n "$APPIMAGE_SIG" ]; then
  SIGNATURE=$(cat "$APPIMAGE_SIG")
  PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  APPIMAGE_FILENAME=$(basename "$APPIMAGE_PATH")

  # Generate latest.json (merge with existing if present)
  LATEST_JSON="apps/desktop/src-tauri/target/latest.json"

  if [ -f "$LATEST_JSON" ]; then
    node -e "
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync('$LATEST_JSON', 'utf8'));
      data.platforms['linux-x86_64'] = {
        signature: \`$SIGNATURE\`,
        url: 'https://github.com/anomalyco/tectonic-editor/releases/download/$TAG/TectonicEditor-Linux.AppImage'
      };
      fs.writeFileSync('$LATEST_JSON', JSON.stringify(data, null, 2));
    "
  else
    cat > "$LATEST_JSON" <<EOF
{
  "version": "$VERSION",
  "notes": "TectonicEditor $TAG",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "linux-x86_64": {
      "signature": "$SIGNATURE",
      "url": "https://github.com/anomalyco/tectonic-editor/releases/download/$TAG/TectonicEditor-Linux.AppImage"
    }
  }
}
EOF
  fi
  echo "==> Generated latest.json with linux-x86_64"
  ASSETS+=("$LATEST_JSON")
else
  echo "Warning: AppImage updater artifacts not found, skipping latest.json"
fi

# Upload to GitHub Release
echo "==> Uploading to GitHub Release $TAG"
gh release view "$TAG" --repo anomalyco/tectonic-editor >/dev/null 2>&1 || \
  gh release create "$TAG" --repo anomalyco/tectonic-editor --title "TectonicEditor $TAG" --generate-notes

gh release upload "$TAG" \
  --repo anomalyco/tectonic-editor \
  --clobber \
  "${ASSETS[@]}"

echo "==> Done! Linux build uploaded to $TAG"
