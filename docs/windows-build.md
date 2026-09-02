# Windows 빌드 가이드

SSH Editor를 Windows에서 개발·빌드·설치하는 방법.
저장소의 `scripts/*.ps1`, `Makefile`(Windows 분기), `package.json`, `src-tauri/Cargo.lock` 기준.

> ⚠️ 이 프로젝트는 지금까지 macOS에서만 빌드·검증되었습니다. 아래 절차는 저장소에 포함된
> Windows용 스크립트와 실제 의존성 트리에서 도출한 것이며, Windows 실기 빌드는 아직 검증되지 않았습니다.

---

## 1. 사전 준비

| 도구 | 용도 | 설치 |
|------|------|------|
| **VS 2022 Build Tools** (VCTools 워크로드) | MSVC 링커 `link.exe` + Windows SDK | `winget install Microsoft.VisualStudio.2022.BuildTools` |
| **Rustup** (stable-x86_64-pc-windows-msvc) | Rust 백엔드 컴파일 | `winget install Rustlang.Rustup` |
| **Node.js LTS** (18+) | 프론트엔드 빌드 | `winget install OpenJS.NodeJS.LTS` |
| **NASM** | `aws-lc-sys` x86_64 어셈블리 빌드 | `winget install NASM.NASM` + PATH 등록 |
| **CMake** | `aws-lc-sys`가 CC 빌더 대신 CMake 빌더로 넘어갈 때 필요 | `winget install Kitware.CMake` |
| **WebView2 런타임** | Tauri 웹뷰 (Win11 기본 탑재) | `winget install Microsoft.EdgeWebView2Runtime` |

`winget`이 없으면 Microsoft Store에서 **앱 설치 관리자(App Installer)** 를 먼저 설치하세요.

### NASM·CMake가 왜 필요한가

SSH 백엔드(`russh` → `rustls` → `aws-lc-rs`)가 **`aws-lc-sys 0.41`** 을 끌어옵니다.
이 크레이트의 빌더는 다음 순서로 동작합니다.

1. 먼저 **CC 빌더**를 시도 — 성공하면 CMake 없이 끝납니다.
2. 실패하면 **CMake 빌더**로 폴백 — 이때 `cmake`가 PATH에 없으면
   `Missing dependency: cmake`로 빌드가 중단됩니다.
3. Windows x86_64에서는 어느 경로든 **NASM**이 필요합니다. 없으면
   `Missing dependency: nasm`으로 중단됩니다.

NASM을 설치할 수 없는 환경이면 미리 빌드된 어셈블리를 쓰는 탈출구가 있습니다.

```powershell
$env:AWS_LC_SYS_PREBUILT_NASM = "1"
```

---

## 2. 환경 자동 세팅

```powershell
make env-setup
# make가 없으면:
powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1
```

`setup-env.ps1`이 하는 일:

- VS Build Tools를 `--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended`로 설치
- Rustup / Node.js LTS / NASM / CMake 설치 (이미 있으면 SKIP)
- NASM 디렉토리(`%LOCALAPPDATA%\bin\NASM`)를 **사용자 PATH에 등록** — winget이 자동 등록하지 않음
- CMake는 `--custom ADD_CMAKE_TO_PATH=System`으로 PATH 등록까지 함께 처리
- `npm install` 실행

> 설치 후 **새 PowerShell 창**을 열어야 PATH가 반영됩니다.

## 3. 환경 점검

```powershell
make env-check
# 또는
powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1
```

cargo / node / npm / NASM / CMake / MSVC 링커 / WebView2 / `icon.ico` 유효성을 점검하고
누락이 있으면 exit 1로 끝납니다.
CMake와 WebView2는 조건부 의존성이라 **경고만** 하고 exit 코드에는 영향을 주지 않습니다.

> `make`는 Windows 기본 탑재가 아닙니다: `winget install GnuWin32.Make` (또는 `ezwinports.make`).
> 없으면 위처럼 `powershell -File` 로 직접 실행하면 됩니다.

---

## 4. 개발 모드

```powershell
make dev
# = npm run tauri:dev
```

`tauri:dev`는 `--features custom-protocol`을 강제합니다. 이건 **macOS 16(Tahoe)의 `tao` 패닉 회피용**이라
Windows에서는 필요 없습니다. custom-protocol은 번들된 `dist/` 자산을 쓰므로 HMR을 잃습니다.
Windows에서 HMR이 필요하면 devUrl 모드로 직접 실행하세요.

```powershell
npx tauri dev
```

> debug 빌드는 콘솔 창이 함께 뜹니다. `main.rs`의
> `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` 가
> **release에서만** 콘솔을 숨기기 때문입니다.

---

## 5. 빌드

```powershell
make build
# = npm run tauri:build
```

`tauri.conf.json`의 `bundle.targets: "all"` 이므로 Windows에서는 **NSIS + MSI** 두 가지가 생성됩니다.

| 산출물 | 경로 |
|--------|------|
| 실행 파일 | `src-tauri\target\release\ssh-editor.exe` |
| NSIS 설치 마법사 | `src-tauri\target\release\bundle\nsis\*-setup.exe` |
| MSI 패키지 | `src-tauri\target\release\bundle\msi\*.msi` |

## 6. 설치

```powershell
make install     # = make setup (별칭)
# 또는
powershell -ExecutionPolicy Bypass -File scripts/install-app.ps1
```

`install-app.ps1`은 `npm run tauri:build` 후 **NSIS `*-setup.exe` 우선**, 없으면 MSI를 찾아
설치 마법사를 실행합니다. 완료 후 시작 메뉴에서 `SSH Editor` 실행.

## 7. 아이콘 재생성

```powershell
npm run icons    # src-tauri/icons/icon.svg → icns/ico/png
```

`src-tauri\icons\icon.ico`가 placeholder(수백 바이트 미만)면 Windows 번들 단계에서 실패합니다.
`check-env.ps1`이 100바이트 미만일 때 경고합니다.

---

## 8. Windows에서 달라지는 점

### 쓰면 안 되는 스크립트

`npm run native` / `native:debug` / `native:release` / `native:run` / `native:bundle` 은
**macOS 전용**입니다. `scripts/native.sh`가 bash + `codesign` + `.app` 래핑을 하기 때문입니다.
Windows에서는 `npm run tauri:build`(= `make build`)를 쓰세요.
`Makefile`의 Windows 분기는 이미 `dev`/`build`/`native`를 tauri 명령으로 매핑해 둡니다.

### 메뉴

`lib.rs`가 만드는 앱 메뉴에는 macOS 전용 항목이 섞여 있습니다.
muda 기준 **Services / Show All 은 Windows 미지원**이라 Windows에서는 동작하지 않는 항목으로 남습니다.
(빌드는 정상. 신경 쓰인다면 `#[cfg(target_os = "macos")]`로 분기하면 됩니다.)

### 단축키

`CmdOrCtrl` 액셀러레이터는 Windows에서 `Ctrl`로 해석됩니다.

| 동작 | macOS | Windows |
|------|-------|---------|
| 환경설정 | ⌘, | Ctrl+, |
| 새 창 | ⇧⌘N | Ctrl+Shift+N |
| 자동 줄바꿈 | ⌥Z | Alt+Z |
| 탭 닫기 (프론트 처리) | ⌘W | Ctrl+W |
| 실행 취소 다시 | ⇧⌘Z | Ctrl+Y (muda 기본값) |
| 창 닫기 (predefined) | ⌘W | Alt+F4 |

### 경로

`~/.ssh/config` 읽기는 `dirs::home_dir()` 기반이라 Windows에서
`C:\Users\<사용자>\.ssh\config`를 그대로 읽습니다. 별도 설정 불필요.

### 크로스 컴파일

macOS에서 Windows 타깃으로 크로스 빌드하는 건 MSVC 링커·Windows SDK 때문에 실용적이지 않습니다.
Windows 실기 또는 `windows-latest` CI 러너에서 빌드하세요.

---

## 9. 트러블슈팅

| 증상 | 원인 | 조치 |
|------|------|------|
| `Missing dependency: nasm` | NASM이 PATH에 없음 | NASM 설치 + PATH 등록 후 **새 셸**. 또는 `$env:AWS_LC_SYS_PREBUILT_NASM="1"` |
| `Missing dependency: cmake` | aws-lc-sys가 CMake 빌더로 폴백했는데 cmake 없음 | `winget install Kitware.CMake` 후 새 셸 |
| `linker 'link.exe' not found` | VS Build Tools의 VCTools 워크로드 누락 | `make env-setup` 재실행, 또는 "x64 Native Tools Command Prompt"에서 빌드 |
| 앱 실행 시 흰 화면 | WebView2 런타임 없음 | `winget install Microsoft.EdgeWebView2Runtime` |
| 번들 단계에서 아이콘 오류 | `icon.ico`가 placeholder | `npm run icons`로 재생성 |
| `make: command not found` | Windows에 make 없음 | `winget install GnuWin32.Make` 또는 `powershell -File scripts/*.ps1` 직접 실행 |
| `winget` 없음 | App Installer 미설치 | Microsoft Store에서 "앱 설치 관리자" 설치 |
| PATH 변경이 반영 안 됨 | 기존 셸이 옛 환경변수 유지 | PowerShell/터미널을 **새로 열기** |

---

## 10. 참고

- 타입 검증만: `make verify` (`npm run build` + `cargo check`)
- 정리: `make clean` (`build`, `src-tauri/target`, `dist` 삭제)
- 전체 타깃 목록: `make` (인자 없이)
