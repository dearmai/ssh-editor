#!/usr/bin/env bash
#
# SSH Editor - 네이티브 빌드 & 실행 스크립트
#
# 사용법:
#   ./scripts/native.sh [debug|release] [옵션] [-- <앱 실행 인자>]
#
# 옵션:
#   -r, --run       빌드 후 바로 실행 (.app 으로 실행 → 터미널창 안 뜸)
#   -b, --bundle    tauri 정식 .app 번들 생성 (배포용, 느림)
#   -h, --help      도움말
#
# 예시:
#   ./scripts/native.sh                       # debug 빌드 → build/debug/
#   ./scripts/native.sh release               # release 빌드 → build/release/
#   ./scripts/native.sh debug --run           # 빌드 후 .app 으로 실행 (터미널 X)
#   ./scripts/native.sh release --bundle       # 배포용 정식 번들
#
# 결과물 (build/<mode>/):
#   SSH Editor.app   ← 더블클릭/open 으로 실행 (터미널창 안 뜸)
#   ssh-editor       ← 단일 바이너리 (CLI 인자 테스트용)
#
set -euo pipefail

# ── 프로젝트 루트 (이 스크립트는 scripts/ 안에 위치) ──────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BIN_NAME="ssh-editor"        # Cargo package name → 바이너리 이름
APP_NAME="SSH Editor"        # productName → .app 이름
BUNDLE_ID="io.rinjae.ssh-editor"
APP_VERSION="0.1.0"

# ── 인자 파싱 ─────────────────────────────────────────────────
MODE="debug"
DO_RUN=0
DO_BUNDLE=0
APP_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    debug)        MODE="debug" ;;
    release)      MODE="release" ;;
    -r|--run)     DO_RUN=1 ;;
    -b|--bundle)  DO_BUNDLE=1 ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --)           shift; APP_ARGS=("$@"); break ;;
    *) echo "❌ 알 수 없는 인자: $1  (--help 참고)"; exit 1 ;;
  esac
  shift
done

OUT_DIR="$ROOT/build/$MODE"

# ── 최소 .app 번들 래핑 (터미널 없이 실행되게) ────────────────
# $1: 바이너리 경로, $2: 출력 디렉토리
make_app_bundle() {
  local bin="$1" out="$2"
  local app="$out/$APP_NAME.app"
  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  cp -f "$bin" "$app/Contents/MacOS/$BIN_NAME"
  if [ -f "src-tauri/icons/icon.icns" ]; then
    cp -f "src-tauri/icons/icon.icns" "$app/Contents/Resources/icon.icns"
  fi
  cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleVersion</key><string>$APP_VERSION</string>
  <key>CFBundleShortVersionString</key><string>$APP_VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>$BIN_NAME</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
</dict>
</plist>
PLIST
  # 로컬 실행용 ad-hoc 서명 (실패해도 진행)
  codesign --force --sign - "$app" >/dev/null 2>&1 || true
}

echo "════════════════════════════════════════════════"
echo "  SSH Editor 네이티브 빌드  [$MODE]"
echo "════════════════════════════════════════════════"

# ── 빌드 ──────────────────────────────────────────────────────
if [ "$DO_BUNDLE" = "1" ]; then
  echo "▶ [1/2] tauri 정식 번들 빌드 ($MODE)…"
  pushd src-tauri >/dev/null
  if [ "$MODE" = "release" ]; then
    npx tauri build --bundles app
  else
    npx tauri build --debug --bundles app
  fi
  popd >/dev/null
else
  echo "▶ [1/2] 프론트엔드 빌드 (vite)…"
  npm run build

  echo "▶ [1/2] Rust 빌드 ($MODE)…"
  pushd src-tauri >/dev/null
  if [ "$MODE" = "release" ]; then
    cargo build --release --features custom-protocol
  else
    cargo build --features custom-protocol
  fi
  popd >/dev/null
fi

# ── 결과물 정리 → build/<mode>/ ───────────────────────────────
echo "▶ [2/2] 결과물 정리 → build/$MODE/"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

RUN_TARGET=""

if [ "$DO_BUNDLE" = "1" ]; then
  # tauri 가 만든 .app 사용
  SRC_APP="src-tauri/target/$MODE/bundle/macos/$APP_NAME.app"
  if [ -d "$SRC_APP" ]; then
    cp -Rf "$SRC_APP" "$OUT_DIR/"
    RUN_TARGET="$OUT_DIR/$APP_NAME.app"
  fi
  # 단일 바이너리도 함께 복사
  [ -f "src-tauri/target/$MODE/$BIN_NAME" ] && cp -f "src-tauri/target/$MODE/$BIN_NAME" "$OUT_DIR/"
else
  SRC_BIN="src-tauri/target/$MODE/$BIN_NAME"
  cp -f "$SRC_BIN" "$OUT_DIR/"
  # 단일 바이너리를 최소 .app 으로 래핑 → 터미널창 없이 실행
  make_app_bundle "$SRC_BIN" "$OUT_DIR"
  RUN_TARGET="$OUT_DIR/$APP_NAME.app"
fi

echo "✅ 빌드 완료"
echo ""
ls -lh "$OUT_DIR"
echo ""

# ── 실행 ──────────────────────────────────────────────────────
if [ "$DO_RUN" = "1" ]; then
  if [ -z "$RUN_TARGET" ]; then
    echo "❌ 실행할 산출물을 찾을 수 없습니다."
    exit 1
  fi
  echo "▶ 실행 (터미널 비종속): $RUN_TARGET ${APP_ARGS[*]:-}"
  if [ ${#APP_ARGS[@]} -gt 0 ]; then
    open -n "$RUN_TARGET" --args "${APP_ARGS[@]}"
  else
    open -n "$RUN_TARGET"
  fi
fi
