# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code(및 개발자)를 위한 가이드입니다.

## 프로젝트 개요

VSCode 스타일 SSH 원격 파일 에디터. **Tauri v2 + React 19 + TypeScript** 프론트엔드와 **Rust(russh)** 백엔드. macOS 대상.

자세한 기능/구조는 `README.md` 참고.

## 자주 쓰는 명령어

```bash
npm run tauri:dev        # 개발 모드 (HMR) — custom-protocol 강제 필수 (아래 Tahoe 패닉 참고)
npm run native           # debug 네이티브 빌드 + .app 실행 (터미널창 없음)
npm run native:release   # release 빌드 → build/release/
npm run build            # 프론트엔드만 (tsc + vite) — 타입 검증용
cd src-tauri && cargo check   # Rust 타입 검증
```

빌드 산출물: `build/debug/` · `build/release/` (`SSH Editor.app` + `ssh-editor` 바이너리).

## 아키텍처

- **IPC 경계**: 프론트는 `src/ipc/commands.ts`(invoke)·`events.ts`(listen)만 통해 Rust와 통신. 새 백엔드 기능은 ① `src-tauri/src/commands/*`에 `#[tauri::command]` 추가 → ② `lib.rs`의 `generate_handler!`에 등록 → ③ `ipc/commands.ts`에 래퍼 추가 순서.
- **상태관리(zustand)**: `connectionStore`(연결/프로필/디렉토리), `fileTreeStore`(트리 캐시·rootPath), `editorStore`(탭·분할), `terminalStore`(터미널 세션), `logStore`(동작 로그), `settingsStore`(폰트·테마, persist).
- **연결 풀**: Rust `SshConnectionPool`(DashMap)이 백엔드 프로세스에 sessionId로 세션 보관. **여러 창이 같은 백엔드를 공유**하므로 sessionId는 전역.
- **로그**: 스토어 밖에서도 `import { log } from 'stores/logStore'` → `log.info/warn/error(...)`. 주요 동작(연결, 파일 열기/저장, 터미널 생성)에 이미 연결됨.

## ⚠️ 핵심 주의사항 (반복 실수 방지)

### macOS 16 (Tahoe) 패닉
- `tao` 0.35.x는 devUrl 모드(`--no-default-features`)에서 `applicationDidFinishLaunching` 패닉.
- **해결**: 항상 `custom-protocol` feature 사용 → 번들 자산 사용. `tauri:dev`와 `native.sh`는 이미 강제함. devUrl 모드로 돌리지 말 것.

### russh 0.61 (AFIT)
- `client::Handler` 구현에 **`#[async_trait]` 쓰지 말 것** — russh 0.61은 AFIT(네이티브 async trait, Rust 1.75+). `async_trait` 매크로와 충돌.
- 공개키 인증: **`russh::keys::PrivateKeyWithHashAlg`** 사용 (`russh_keys::key::...`와 다른 타입). `russh::keys::load_secret_key` + `PrivateKeyWithHashAlg::new(Arc::new(key), None)` (이 `new`는 `Result`가 아니라 `Self` 반환).
- `AuthMethod::Agent`는 에이전트 대신 `~/.ssh/id_ed25519`, `id_ecdsa`, `id_rsa` … 순서로 기본 키 파일 시도.

### russh-sftp `FileAttributes`
- `mtime: Option<u32>` (u64 아님) → `FileEntry.modified`로 변환 시 `.map(|t| t as u64)`.
- `permissions: Option<u32>` — 메서드가 아니라 필드.

### Tauri v2 세부
- `app.emit(...)` 쓰려면 **`use tauri::Emitter;`** 필요.
- 다중 창: 새 창 라벨은 `win-<uuid>`. `capabilities/default.json`의 `"windows"`에 **`"win-*"` 글로브**가 있어야 새 창 프론트가 invoke 가능.
- 메뉴 이벤트를 전역 `emit`하면 **모든 창이 수신** → 새 창 생성은 메뉴 핸들러(`lib.rs`)에서 직접 `WebviewWindowBuilder`로 처리(이벤트 라운드트립 금지).

### 네이티브 실행 = .app 래핑
- macOS는 `.app`이 아닌 단일 바이너리를 더블클릭하면 Terminal.app을 띄움. `native.sh`가 바이너리를 최소 `.app`(Info.plist + ad-hoc 서명)으로 감싸 터미널 없이 실행되게 함.
- `main.rs`의 `windows_subsystem = "windows"`는 **Windows 전용**, macOS 무관.

## 설정·테마 모델 (`settingsStore.ts`)

- zustand `persist`(localStorage, key `ssh-editor-settings`). `resolvedTheme`는 런타임 전용이라 `partialize`로 영속 제외.
- **테마 해석 순서**: 폴더 오버라이드 → 서버 오버라이드 → 전역. 스코프 키: `srv:<profileId>`, `dir:<profileId>:<path>`.
- 적용: `applyTheme()`가 `<html data-theme="dark|light">` 설정 → `globals.css`의 `:root[data-theme='light']` 변수 오버라이드. Monaco/xterm은 `resolvedTheme`로 테마 prop 전환.
- 시작 디렉토리 변경/추가는 `connectionStore.saveActiveDirectories` → 활성 스냅샷 갱신 + `saveProfile` 영속화.

## 코드 컨벤션

- UI 텍스트·주석·로그는 **한국어**.
- 스타일은 **CSS Modules** + `globals.css`의 CSS 변수(`--bg-*`, `--text-*`, `--accent`, `--font-*`). 색을 하드코딩하지 말고 변수 사용(테마 전환 위해).
- 에러: Rust `AppError`가 String으로 Serialize → 프론트는 `catch (e) { String(e) }`.

## 검증

변경 후 최소한:
```bash
npm run build                 # 프론트 타입
cd src-tauri && cargo check   # Rust 타입
```
가능하면 `npm run native`로 실제 실행(패닉 없는지) 스모크 테스트.
