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

### 포터블 무설치 빌드

`npm run tauri:portable`로 Windows 전용 포터블 실행파일을 빌드합니다.
결과는 `build/windows-portable/ssh-editor.exe`입니다.
일반 NSIS/MSI 빌드는 기존 AppData 저장 방식을 유지하며 빌드 캐시도 분리됩니다.

첫 실행 시 실행파일 옆에 `data/`가 생성됩니다.

- `data/ssh-editor.json`: 서버 프로필
- `data/webview/`: 테마·폰트·들여쓰기 등 localStorage와 웹뷰 캐시

앱을 완전히 종료한 뒤 폴더 전체를 복사하면 설정도 함께 이동합니다.
실행파일만 교체하면 기존 데이터가 유지됩니다. 작업 디렉터리와 무관하게
실행파일 위치를 기준으로 저장하며 쓰기 권한이 없으면 시작 시 실패합니다.
AppData로 우회 저장하지 않습니다.

WebView2 런타임은 대상 PC에 필요하며 이 빌드에는 포함되지 않습니다.
기존 설치판 설정은 자동 복사하지 않습니다. 서버 목록은 앱 종료 후 기존
`ssh-editor.json`을 `data/`에 복사해 옮길 수 있습니다.
SSH 키와 사용자가 가져오는 `~/.ssh/config`는 자동 복사하지 않습니다.
다른 PC에서는 등록한 키 파일 경로를 다시 지정해야 할 수 있습니다.
서버 비밀번호가 포함될 수 있으므로 `data/`를 안전하게 보관하세요.

실기 검증: 서버 프로필·테마·폰트·들여쓰기를 변경하고 종료한 뒤 폴더를 다른
경로로 옮겨 재실행하여 설정 유지 및 새 창 동작을 확인하세요.

### 코드 서명 (셀프 인증서, 사내·폐쇄망 배포용)

개인 키 생성·백업·복원·갱신·유출 대응과 문제 해결은 [codesign.md](codesign.md)를 참고하세요.

1. 처음 한 번 `powershell -ExecutionPolicy Bypass -File scripts\codesign-cert.ps1`을 실행합니다.
   코드 서명 인증서(`CN=Dany Kim, O=SSH Editor`)를 현재 사용자 인증서 저장소에 만들고,
   공개 인증서를 `codesign\SSH-Editor-codesign.cer`로 내보냅니다.
   `-BackupPfx <경로>`를 주면 개인 키를 비밀번호 걸린 `.pfx`로 백업합니다(저장소에 넣지 말 것).
2. `npm run tauri:signed`로 빌드합니다. 폐쇄망용 NSIS 설치판(앱 exe·언인스톨러·설치 파일)과
   포터블 exe를 SHA-256으로 서명하고 DigiCert RFC 3161 타임스탬프를 넣습니다.
   인증서가 만료돼도 서명은 유효합니다. 하나만 빌드하려면
   `scripts\build-signed.ps1 -Installer` 또는 `-Portable`.
   설치판·포터블·`install-cert.cmd`·`.cer`가 모두 `build\windows-signed\`에 모입니다.
3. 배포 대상 PC에서 배포본 폴더의 `install-cert.cmd`를 실행하거나 GPO로 `.cer`를 배포합니다.
   신뢰할 수 있는 루트 인증 기관과 신뢰할 수 있는 게시자에 등록되어 '확인된 게시자: Dany Kim'으로
   보이고, 게시자 기준 실행 정책(AppLocker·WDAC)에도 쓸 수 있습니다.

- 개인 키와 비밀번호는 설정 파일이나 저장소에 두지 않습니다. 서명할 때 인증서 저장소에서 주체 이름으로 찾습니다.
- 서명에는 Windows SDK의 `signtool.exe`가 필요하고, 타임스탬프 때문에 빌드 PC에 인터넷이 필요합니다.
- 셀프 인증서라 SmartScreen 평판은 생기지 않습니다.

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
