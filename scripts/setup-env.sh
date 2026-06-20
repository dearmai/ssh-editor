#!/usr/bin/env bash
# SSH Editor - macOS/Linux 빌드 환경 자동 세팅 스크립트
# Makefile의 `make env-setup`이 호출함. macOS는 Homebrew + Xcode CLT 기준.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; GRAY='\033[0;90m'; NC='\033[0m'

echo ""
echo -e "${CYAN}==== SSH Editor - macOS/Linux 빌드 환경 세팅 ====${NC}"
echo ""

if [ "$(uname -s)" = "Darwin" ]; then
  # 1) Xcode Command Line Tools
  if ! xcode-select -p >/dev/null 2>&1; then
    echo -e "  ${CYAN}[INSTALL]${NC} Xcode Command Line Tools..."
    xcode-select --install || true
    echo -e "  ${YELLOW}설치 창이 뜨면 완료 후 다시 'make setup'을 실행하세요.${NC}"
  else
    echo -e "  ${GRAY}[SKIP] Xcode CLT 이미 설치됨${NC}"
  fi

  # 2) Homebrew
  if ! command -v brew >/dev/null 2>&1; then
    echo -e "  ${YELLOW}[필요] Homebrew 미설치. https://brew.sh 의 설치 명령을 실행하세요.${NC}"
  else
    # 3) Node.js
    if ! command -v node >/dev/null 2>&1; then
      echo -e "  ${CYAN}[INSTALL]${NC} Node.js (brew)..."
      brew install node
    else
      echo -e "  ${GRAY}[SKIP] Node.js 이미 설치됨${NC}"
    fi
  fi
else
  echo -e "  ${YELLOW}Linux는 배포판 패키지 매니저로 build-essential/clang/node를 설치하세요.${NC}"
fi

# 4) Rust (rustup)
if ! command -v cargo >/dev/null 2>&1; then
  echo -e "  ${CYAN}[INSTALL]${NC} Rust (rustup)..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1091
  [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
else
  echo -e "  ${GRAY}[SKIP] Rust 이미 설치됨${NC}"
fi

# 5) npm 의존성
if [ -f "$ROOT/package.json" ] && command -v npm >/dev/null 2>&1; then
  echo -e "  ${CYAN}[npm]${NC} 프론트엔드 의존성 설치 (npm install)..."
  (cd "$ROOT" && npm install)
fi

echo ""
echo -e "${GREEN}==> 세팅 완료. 새 셸을 열어 PATH를 반영한 뒤 'make env-check'로 확인하세요.${NC}"
