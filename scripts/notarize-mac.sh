#!/usr/bin/env bash
# Notarizes and staples the universal Mac release produced by `pnpm build:mac`.
#
# 1. Submits Skritch.app to Apple's notary service and staples the ticket to it.
# 2. Rebuilds the DMG around the stapled app with Tauri's own bundle_dmg.sh (same layout).
# 3. Signs, notarizes and staples the DMG.
#
# Credentials come from a notarytool keychain profile (NOTARY_PROFILE, default "fives-notary"):
#   xcrun notarytool store-credentials <profile> --apple-id <id> --team-id <team> --password <app-specific>
# The app must be Developer ID signed; ad-hoc builds (APPLE_SIGNING_IDENTITY=-) cannot be notarized.
set -euo pipefail

PROFILE=${NOTARY_PROFILE:-fives-notary}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BUNDLE=$ROOT/apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle
VERSION=$(node -p 'require(process.argv[1]).version' "$ROOT/apps/desktop/src-tauri/tauri.conf.json")
APP=$BUNDLE/macos/Skritch.app
DMG_DIR=$BUNDLE/dmg
DMG=$DMG_DIR/Skritch_${VERSION}_universal.dmg

[[ -d $APP && -x $DMG_DIR/bundle_dmg.sh ]] || { echo "error: run pnpm build:mac first" >&2; exit 1; }
IDENTITY=$(codesign -dv --verbose=2 "$APP" 2>&1 | sed -n 's/^Authority=\(Developer ID Application: .*\)$/\1/p')
[[ -n $IDENTITY ]] || { echo "error: $APP is not Developer ID signed" >&2; exit 1; }
codesign --verify --deep --strict "$APP"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

notarize() {
  echo "Notarizing $(basename "$1")…"
  local out id status
  out=$(xcrun notarytool submit "$1" --keychain-profile "$PROFILE" --wait --output-format json) || true
  id=$(plutil -extract id raw -o - - <<<"$out" 2>/dev/null) || true
  status=$(plutil -extract status raw -o - - <<<"$out" 2>/dev/null) || true
  if [[ $status != Accepted ]]; then
    echo "error: notarization ${status:-failed}: $out" >&2
    [[ -n $id ]] && xcrun notarytool log "$id" --keychain-profile "$PROFILE" >&2
    exit 1
  fi
}

# 1. The app (notarytool takes a zip, not a bare bundle).
ditto -c -k --keepParent "$APP" "$WORK/Skritch.zip"
notarize "$WORK/Skritch.zip"
xcrun stapler staple "$APP"

# 2. The DMG, matching tauri.macos.conf.json and the CI-mode packaging of build:mac.
mkdir "$WORK/stage"
ditto "$APP" "$WORK/stage/Skritch.app"
rm -f "$DMG"
"$DMG_DIR/bundle_dmg.sh" --volname Skritch --volicon "$DMG_DIR/icon.icns" \
  --window-size 560 340 --icon Skritch.app 150 170 --hide-extension Skritch.app \
  --app-drop-link 410 170 --skip-jenkins "$DMG" "$WORK/stage"
codesign --force --timestamp --sign "$IDENTITY" "$DMG"

# 3. Notarize and staple the DMG, then check both the way Gatekeeper will.
notarize "$DMG"
xcrun stapler staple "$DMG"
xcrun stapler validate "$APP"
xcrun stapler validate "$DMG"
spctl --assess --type execute --verbose=2 "$APP"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"
shasum -a 256 "$DMG"
