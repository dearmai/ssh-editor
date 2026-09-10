#!/usr/bin/env bash
# SSH Editor - macOS/Linux 빌드 환경 자동 세팅 스크립트
# Makefile의 `make env-setup`이 호출함. macOS는 Homebrew + Xcode CLT 기준.
set -euo pipefail

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
  . /etc/os-release
  if [[ "${ID:-} ${ID_LIKE:-}" =~ (rhel|rocky|almalinux|centos) ]] && [[ "${VERSION_ID:-}" = 9* ]]; then
    command -v podman >/dev/null 2>&1 || sudo dnf install -y podman
    bash "$ROOT/scripts/linux-container.sh" setup
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y build-essential pkg-config libssl-dev libgtk-3-dev \
      libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf curl
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y gcc gcc-c++ make pkgconf-pkg-config openssl-devel \
      gtk3-devel webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel patchelf curl
  else
    echo "지원하지 않는 배포판입니다. https://v2.tauri.app/start/prerequisites/ 참고" >&2
    exit 1
  fi
fi

# 4) Rust (rustup)
[ ! -f "$HOME/.cargo/env" ] || . "$HOME/.cargo/env"
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
  echo -e "  ${CYAN}[npm]${NC} 프론트엔드 의존성 설치 (npm ci)..."
  (cd "$ROOT" && npm ci)
elif [ "$(uname -s)" = Linux ] && command -v podman >/dev/null 2>&1 && podman image exists localhost/ssh-editor-dev:bookworm; then
  bash "$ROOT/scripts/linux-container.sh" npm ci
else
  echo "Node.js 22 이상과 npm을 설치한 뒤 다시 실행하세요." >&2
  exit 1
fi

echo ""
echo -e "${GREEN}==> 세팅 완료. 새 셸을 열어 PATH를 반영한 뒤 'make env-check'로 확인하세요.${NC}"
