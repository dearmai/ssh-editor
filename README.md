# SSH Editor

VSCode 스타일의 **SSH 원격 파일 에디터**. Tauri v2 + React + Monaco Editor + Rust(russh) 기반으로, 원격 서버의 파일을 로컬 에디터처럼 탐색·편집하고 통합 터미널을 사용할 수 있는 데스크탑 앱입니다.

## 주요 기능

- **SFTP 파일 탐색·편집** — 원격 디렉토리 트리 지연 로딩, Monaco 에디터로 열기/편집/저장(⌘S), 파일 생성·삭제·이름변경
- **외부 변경 감지** — 서버 파일이 바뀌면 자동 감지. 로컬 수정이 없으면 조용히 재로드, 수정 중이면 재로드/백업 선택창
- **에디터 분할** — 가로(좌우) / 세로(위아래) Split pane
- **통합 터미널** — xterm.js 기반 멀티 세션 PTY 터미널 (VSCode처럼 탭으로 여러 개)
- **로그 패널** — 프로그램 동작 로그를 레벨 필터(Info/Warn/Error)와 함께 출력
- **서버 관리** — 자체 서버 목록 관리, `~/.ssh/config`에서 가져오기, SSH Agent/키 파일/비밀번호 인증
- **복수 시작 디렉토리** — 서버별로 여러 base 디렉토리를 등록하고 빠르게 전환
- **테마** — Dark / Light / System, **서버·폴더별 오버라이드** 지원 (상태바에서 즉시 전환)
- **폰트 설정** — 기본(sans-serif) / 에디터·터미널(monospace) 폰트 패밀리·크기
- **다중 창** — 새 창으로 여러 서버에 동시 접속
- **상태바** — 연결 정보 + 서버 시간 + ping(왕복 지연) 실시간 표시
- **CLI 실행** — `sshe user@host:/path` 형식 인자로 바로 접속/파일 열기

## 기술 스택

| 영역 | 선택 |
|------|------|
| 데스크탑 | Tauri v2 |
| 프론트엔드 | React 19 + TypeScript + Vite 6 |
| 에디터 | @monaco-editor/react |
| SSH/SFTP | Rust `russh 0.61` + `russh-sftp` |
| 터미널 | `@xterm/xterm` + addon(fit, web-links) |
| 레이아웃 | `allotment` (리사이저블 스플릿) |
| 상태관리 | `zustand 5` (+ persist) |
| 스타일 | CSS Modules + CSS 변수 |
| 설정 저장 | `tauri-plugin-store` (서버 프로필), localStorage (UI 설정) |

## 사전 준비

- macOS (Apple Silicon/Intel) 또는 Linux
- [Node.js](https://nodejs.org/) 22+ (현재 검증 환경: 24)
- [Rust](https://rustup.rs/) (stable)
- macOS: Xcode Command Line Tools / Linux: GTK 3 및 WebKitGTK 4.1 개발 패키지

```bash
npm install
```

## 리눅스 개발 환경 및 실행

```bash
make env-setup        # 시스템 개발 패키지, Rust, npm 의존성 설치
make env-check        # 실제 빌드 환경 점검
make dev              # 프론트엔드 + Rust debug 빌드 후 GUI 실행
make install          # release 빌드 후 사용자 계정에 설치 (sudo 불필요)
```

`make install`은 Linux에서 바이너리를 `~/.local/share/ssh-editor/`, 실행기를
`~/.local/bin/ssh-editor`, 앱 메뉴 항목을 `~/.local/share/applications/`에 설치합니다.
`XDG_DATA_HOME`을 설정했다면 데이터 및 앱 메뉴는 해당 경로를 사용합니다.
설치 후 앱 메뉴에서 **SSH Editor**를 선택하거나 `~/.local/bin/ssh-editor`를 실행하세요.
Rocky 9에서는 설치된 실행기가 Podman을 사용하며, 프로젝트 폴더와 Rust 개발 도구 없이도
실행할 수 있습니다. 기존 컨테이너의 앱 설정은 유지됩니다.
로컬 설치는 release 바이너리를 사용하고, 배포용 DEB/RPM/AppImage 생성은
별도로 `npm run native:bundle`을 사용합니다. 기존 Podman 이미지의 번들 의존성을
갱신하려면 `bash scripts/linux-container.sh setup`을 실행하세요.

Ubuntu/Debian 및 Fedora에서는 배포판 개발 패키지를 설치합니다.
Rocky/RHEL 9는 저장소에 WebKitGTK 4.1이 없으므로 **Podman의 Debian Bookworm 환경**을 자동으로 사용합니다.
`scripts/Containerfile.linux`에 Node.js 24와 네이티브 개발 라이브러리를 정의하며,
Rust는 사용자 홈의 rustup 설치를 공유합니다. 요구 라이브러리는 [Tauri 공식 사전 준비 문서](https://v2.tauri.app/start/prerequisites/#linux)를 참고하세요.

Rocky Linux에서는 Podman 및 호스트의 `curl`이 필요합니다. Node.js가 호스트에 없으면
`make env-setup`이 컨테이너에서 npm 의존성을 설치하며, 이후 명령도 아래 래퍼로 실행할 수 있습니다.

```bash
bash scripts/linux-container.sh                 # 빌드 후 GUI 실행
bash scripts/linux-container.sh npm run tauri -- dev  # Vite HMR 개발
bash scripts/linux-container.sh bash -c 'node --test tests/*.test.mjs'
make verify                                    # 프론트엔드 빌드 + cargo check
npm run native:release                         # release 바이너리 빌드
bash scripts/linux-container.sh /workspace/build/release/ssh-editor  # 재빌드 없이 실행
```

일반 Linux 산출물은 `build/debug/ssh-editor` 또는 `build/release/ssh-editor`입니다.
컨테이너에서 빌드한 바이너리는 Rocky 9 호스트에서 직접 실행하지 않고 위 래퍼로 실행합니다.
컨테이너의 Rust 빌드 캐시는 `src-tauri/target/linux-container/`, 앱 설정은
Podman 볼륨 `ssh-editor-linux-home`에 보존됩니다.

컨테이너 GUI 실행에는 X11 또는 XWayland의 `DISPLAY`와 X 인증 파일
(`XAUTHORITY`, 기본값 `~/.Xauthority`)이 필요합니다. 실행 스크립트는 X 소켓과 인증 파일을
연결하며, `SSH_AUTH_SOCK`이 있으면 SSH Agent도 연결합니다. 호스트의 `~/.ssh`는 자동으로
공유하지 않으므로 SSH 키 인증은 Agent를 사용하거나 컨테이너에서 접근 가능한 키 경로를 지정하세요.
Linux에서는 macOS의 ⌘ 단축키 대신 Ctrl을 사용합니다.

## 개발

```bash
npm run tauri:dev      # 개발 모드 (HMR). custom-protocol 강제로 macOS 16 Tahoe 패닉 회피
```

> macOS 16(Tahoe)에서는 devUrl 모드(`--no-default-features`)로 실행 시 `tao`가 패닉합니다.
> `tauri:dev`는 `--features custom-protocol`을 강제하여 번들된 자산을 사용하므로 이 문제를 피합니다.

## 빌드 & 네이티브 실행

`scripts/native.sh`가 프론트엔드 + Rust를 빌드합니다. macOS에서는 **단일 바이너리를 최소 `.app`으로 래핑**하여 터미널창 없이 GUI로 실행하고, Linux에서는 바이너리를 직접 실행합니다.

```bash
npm run native           # debug 빌드 후 .app 으로 실행 (터미널창 안 뜸)
npm run native:debug     # debug 빌드만        → build/debug/
npm run native:release   # release 빌드만      → build/release/
npm run native:run       # release 빌드 후 실행
npm run native:bundle    # tauri 정식 .app 번들 (배포용, 느림)
```

빌드 결과:

```
build/debug/   (또는 release/)
├── SSH Editor.app   ← 더블클릭 / open 으로 실행 (터미널창 없음)
└── ssh-editor       ← 단일 바이너리 (CLI 인자 테스트용)
```

스크립트 직접 사용:

```bash
./scripts/native.sh release --run            # 빌드 후 실행
./scripts/native.sh debug --run -- djb-vm:/home   # CLI 인자 전달
./scripts/native.sh --help
```

## CLI 사용

```bash
ssh-editor user@host:/path/to/file    # user@host 에 접속 후 경로 열기
ssh-editor host:/path                 # 사용자명 생략 (현재 OS 사용자)
ssh-editor --profile <id> /path       # 저장된 프로필로 접속
```

## 프로젝트 구조

```
ssh-editor/
├── src/                          # React 프론트엔드
│   ├── components/
│   │   ├── SidePanel/            # 서버 헤더 + 파일 트리(FileTreePanel)
│   │   ├── EditorArea/           # 탭 + Monaco + 분할 + WelcomeScreen
│   │   ├── BottomPanel/          # 로그 패널 + 멀티세션 터미널
│   │   ├── ThemePicker/          # 테마(전역/서버/폴더) 드롭다운
│   │   └── Dialogs/              # 새 연결 / 환경설정
│   ├── stores/                   # zustand: connection/fileTree/editor/terminal/log/settings
│   ├── ipc/                      # invoke/listen 래퍼
│   └── types/
├── src-tauri/src/                # Rust 백엔드
│   ├── ssh/                      # connection(연결풀·ping), sftp, terminal
│   ├── commands/                 # #[tauri::command] 핸들러
│   ├── config/                   # ConnectionProfile, ~/.ssh/config 파싱
│   └── lib.rs                    # 앱 빌더, 메뉴바, 커맨드 등록
└── scripts/native.sh             # 네이티브 빌드 & .app 래핑
```

## 단축키 / 메뉴

- **⌘S** — 현재 파일 저장
- **⌘,** — 환경설정
- **⌘⇧N** — 새 창
- 파일 트리 우클릭 — 새 파일/폴더, 새로 고침, 삭제
- 상태바 — 새 창 버튼, 테마 전환(서버·폴더별)

## 라이선스

Private.
