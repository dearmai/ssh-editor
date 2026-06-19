#!/usr/bin/env bash
#
# SSH Editor - 네이티브 빌드 & 실행 스크립트
#
# 사용법:
#   ./scripts/native.sh [debug|release] [옵션] [-- <앱 실행 인자>]
#
# 옵션:
#   -r, --run       빌드 후 바로 실행
#   -b, --bundle    macOS .app 번들 생성 (기본은 단일 바이너리)
#   -h, --help      도움말
#
# 예시:
#   ./scripts/native.sh                       # debug 바이너리 빌드 → build/debug/
#   ./scripts/native.sh release               # release 바이너리 빌드 → build/release/
#   ./scripts/native.sh debug --run           # 빌드 후 실행
#   ./scripts/native.sh release --bundle --run  # .app 번들 생성 후 실행
#   ./scripts/native.sh debug --run -- djb-vm:/home   # CLI 인자 전달 실행
#
# 결과물:
#   build/debug/    ← debug 빌드 산출물 (ssh-editor 바이너리 / SSH Editor.app)
#   build/release/  ← release 빌드 산출물
#
set -euo pipefail

# ── 프로젝트 루트 (이 스크립트는 scripts/ 안에 위치) ──────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BIN_NAME="ssh-editor"        # Cargo package name → 바이너리 이름
APP_NAME="SSH Editor"        # tauri.conf.json productName → .app 이름

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

echo "════════════════════════════════════════════════"
echo "  SSH Editor 네이티브 빌드  [$MODE]"
echo "════════════════════════════════════════════════"

# ── 빌드 ──────────────────────────────────────────────────────
if [ "$DO_BUNDLE" = "1" ]; then
  # tauri build 가 프론트엔드(beforeBuildCommand)까지 처리 → .app 번들 생성
  echo "▶ [1/2] tauri 번들 빌드 ($MODE)…"
  pushd src-tauri >/dev/null
  if [ "$MODE" = "release" ]; then
    npx tauri build --bundles app
  else
    npx tauri build --debug --bundles app
  fi
  popd >/dev/null
else
  # 단일 네이티브 바이너리 (custom-protocol 로 프론트 자산 내장 → devUrl 불필요)
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

# 단일 바이너리는 항상 복사
SRC_BIN="src-tauri/target/$MODE/$BIN_NAME"
if [ -f "$SRC_BIN" ]; then
  cp -f "$SRC_BIN" "$OUT_DIR/"
  RUN_TARGET="$OUT_DIR/$BIN_NAME"
fi

# .app 번들이 있으면 복사 (실행 우선 대상)
if [ "$DO_BUNDLE" = "1" ]; then
  SRC_APP="src-tauri/target/$MODE/bundle/macos/$APP_NAME.app"
  if [ -d "$SRC_APP" ]; then
    cp -Rf "$SRC_APP" "$OUT_DIR/"
    RUN_TARGET="$OUT_DIR/$APP_NAME.app"
  fi
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
  echo "▶ 실행: $RUN_TARGET ${APP_ARGS[*]:-}"
  echo "────────────────────────────────────────────────"
  if [[ "$RUN_TARGET" == *.app ]]; then
    open "$RUN_TARGET" ${APP_ARGS[@]:+--args "${APP_ARGS[@]}"}
  else
    "$RUN_TARGET" "${APP_ARGS[@]}"
  fi
fi
