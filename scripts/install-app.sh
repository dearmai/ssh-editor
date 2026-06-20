#!/usr/bin/env bash
# SSH Editor - macOS 설치(앱 번들 빌드 후 /Applications에 설치) 스크립트
# Makefile의 `make setup`이 호출함.
# 정식 .app 번들을 만든 뒤 운영 폴더(/Applications)에 복사한다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
APP_NAME="SSH Editor"
DEST="/Applications"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo -e "${CYAN}==== SSH Editor - 앱 번들 빌드 & 설치 (macOS) ====${NC}"
echo ""

# 1) 정식 .app 번들 빌드 (배포용)
echo -e "${CYAN}[1/2] 번들 빌드 (release)...${NC}"
npm run native:bundle

# 2) 운영 폴더(/Applications)에 설치
SRC_APP="$ROOT/build/release/$APP_NAME.app"
if [ ! -d "$SRC_APP" ]; then
  # native:bundle 산출 위치가 다를 경우 tauri 기본 경로도 시도
  SRC_APP="$ROOT/src-tauri/target/release/bundle/macos/$APP_NAME.app"
fi

if [ ! -d "$SRC_APP" ]; then
  echo -e "${RED}[ERROR] 빌드된 .app을 찾지 못했습니다.${NC}"
  exit 1
fi

echo -e "${CYAN}[2/2] $DEST 에 설치: $SRC_APP${NC}"
rm -rf "$DEST/$APP_NAME.app"
cp -Rf "$SRC_APP" "$DEST/"

echo ""
echo -e "${GREEN}==> 설치 완료. Launchpad/Spotlight에서 'SSH Editor'를 실행하세요.${NC}"
