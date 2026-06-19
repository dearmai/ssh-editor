# SSH Editor

VSCode 스타일의 **SSH 원격 파일 에디터**. Tauri v2 + React + Monaco Editor + Rust(russh) 기반으로, 원격 서버의 파일을 로컬 에디터처럼 탐색·편집하고 통합 터미널을 사용할 수 있는 macOS 데스크탑 앱입니다.

## 주요 기능

- **SFTP 파일 탐색·편집** — 원격 디렉토리 트리 지연 로딩, Monaco 에디터로 열기/편집/저장(⌘S), 파일 생성·삭제·이름변경
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

- macOS (Apple Silicon/Intel)
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable) + Xcode Command Line Tools

```bash
npm install
```

## 개발

```bash
npm run tauri:dev      # 개발 모드 (HMR). custom-protocol 강제로 macOS 16 Tahoe 패닉 회피
```

> macOS 16(Tahoe)에서는 devUrl 모드(`--no-default-features`)로 실행 시 `tao`가 패닉합니다.
> `tauri:dev`는 `--features custom-protocol`을 강제하여 번들된 자산을 사용하므로 이 문제를 피합니다.

## 빌드 & 네이티브 실행

`scripts/native.sh`가 프론트엔드 + Rust를 빌드하고, **단일 바이너리를 최소 `.app`으로 래핑**하여 터미널창 없이 GUI로 실행되게 합니다.

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
