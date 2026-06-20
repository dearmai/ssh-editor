# ============================================================================
#  SSH Editor - 크로스플랫폼 빌드 환경 Makefile
#  개발환경 점검/세팅(env-*)과 설치파일 빌드/설치(setup)를 제공한다.
#
#  주요 타깃:
#    make              도움말
#    make env-check    개발 도구 설치 여부 점검 (누락 시 비정상 종료)
#    make env-setup    개발 도구 자동 설치 (Win: winget / mac: brew+rustup)
#    make install      npm 의존성 설치
#    make dev          개발 모드 실행
#    make build        배포 빌드 (설치파일/번들만 생성)
#    make setup        설치파일 빌드 후 실행/설치
#                        Win: NSIS/MSI 설치 마법사 실행
#                        mac: .app 빌드 후 /Applications 에 설치
#    make verify       타입 검증 (tsc + cargo check)
#    make clean        빌드 산출물 정리
#
#  ⚠ Windows에는 make가 기본 탑재되지 않음:
#       winget install GnuWin32.Make   (또는 ezwinports.make)
#     make 없이 직접 실행할 수도 있음:
#       powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1
#       powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1
#       powershell -ExecutionPolicy Bypass -File scripts/install-app.ps1
# ============================================================================

# ── OS 감지 ────────────────────────────────────────────────────────────────
ifeq ($(OS),Windows_NT)
  PLATFORM := windows
else
  UNAME_S := $(shell uname -s)
  ifeq ($(UNAME_S),Darwin)
    PLATFORM := macos
  else
    PLATFORM := linux
  endif
endif

.DEFAULT_GOAL := help
.PHONY: help env-check env-setup setup install dev build native verify frontend rust clean

# ============================================================================
#  Windows
# ============================================================================
ifeq ($(PLATFORM),windows)

PS := powershell -NoProfile -ExecutionPolicy Bypass -File

env-check:
	@$(PS) scripts/check-env.ps1

env-setup:
	@$(PS) scripts/setup-env.ps1

setup:
	@$(PS) scripts/install-app.ps1

install:
	npm install

dev:
	npm run tauri:dev

build:
	npm run tauri:build

native: build

verify:
	npm run build
	cd src-tauri && cargo check

clean:
	@powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path build) { Remove-Item -Recurse -Force build }; if (Test-Path src-tauri/target) { Remove-Item -Recurse -Force src-tauri/target }; if (Test-Path dist) { Remove-Item -Recurse -Force dist }"

# ============================================================================
#  macOS / Linux
# ============================================================================
else

env-check:
	@bash scripts/check-env.sh

env-setup:
	@bash scripts/setup-env.sh

setup:
	@bash scripts/install-app.sh

install:
	npm install

dev:
	npm run native

build:
	npm run native:release

native: build

verify:
	npm run build
	cd src-tauri && cargo check

clean:
	rm -rf build src-tauri/target dist

endif

# ============================================================================
#  공통: 도움말
# ============================================================================
help:
	@echo ""
	@echo "SSH Editor - 빌드 환경 (감지된 플랫폼: $(PLATFORM))"
	@echo ""
	@echo "  make env-check   개발 도구 설치 여부 점검"
	@echo "  make env-setup   개발 도구 자동 설치"
	@echo "  make install     npm 의존성 설치"
	@echo "  make dev         개발 모드 실행"
	@echo "  make build       배포 빌드 (설치파일/번들 생성)"
	@echo "  make setup       설치파일 빌드 후 실행/설치"
	@echo "  make verify      타입 검증 (tsc + cargo check)"
	@echo "  make clean       빌드 산출물 정리"
	@echo ""
