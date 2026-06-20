#!/usr/bin/env bash
# SSH Editor - macOS/Linux 빌드 환경 점검 스크립트
# Makefile의 `make env-check`가 호출함. 누락 도구가 있으면 exit 1.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok=1

check() {  # $1=이름  $2=명령어  $3=버전인자  $4=힌트
  local name="$1" cmd="$2" varg="$3" hint="$4"
  if command -v "$cmd" >/dev/null 2>&1; then
    local ver; ver="$("$cmd" $varg 2>/dev/null | head -1)"
    printf "  ${GREEN}[OK]${NC}   %-18s %s\n" "$name" "$ver"
  else
    printf "  ${RED}[MISS]${NC} %-18s %s\n" "$name" "$hint"
    ok=0
  fi
}

echo ""
echo -e "${CYAN}==== SSH Editor - macOS/Linux 빌드 환경 점검 ====${NC}"
echo ""

check 'Rust (cargo)' cargo '--version' 'rustup: https://rustup.rs'
check 'Node.js'      node  '--version' 'brew install node'
check 'npm'          npm   '--version' 'Node.js와 함께 설치됨'

# macOS: Xcode Command Line Tools (clang/codesign)
if [ "$(uname -s)" = "Darwin" ]; then
  if xcode-select -p >/dev/null 2>&1; then
    printf "  ${GREEN}[OK]${NC}   %-18s %s\n" 'Xcode CLT' "$(xcode-select -p)"
  else
    printf "  ${RED}[MISS]${NC} %-18s %s\n" 'Xcode CLT' 'xcode-select --install'
    ok=0
  fi
  check 'codesign' codesign '' 'Xcode CLT에 포함'
fi

echo ""
if [ "$ok" = "1" ]; then
  echo -e "${GREEN}==> 빌드 가능. 'npm run native' (개발/실행) / 'npm run native:release' (배포)${NC}"
  exit 0
else
  echo -e "${RED}==> 누락 도구 있음. 'make setup' 실행 후 다시 점검하세요.${NC}"
  exit 1
fi
