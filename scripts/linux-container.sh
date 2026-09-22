#!/usr/bin/env bash
# Rocky/RHEL 9 등 WebKitGTK 4.1이 없는 호스트용 개발/GUI 실행 환경.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="localhost/ssh-editor-dev:bookworm"
RUNTIME=0
if [ "${1:-}" = --runtime ]; then
  RUNTIME=1
  shift
fi

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman을 먼저 설치하세요 (Rocky/Fedora: sudo dnf install podman)." >&2
  exit 1
fi
if [ "${1:-}" = setup ]; then
  podman build -t "$IMAGE" -f "$ROOT/scripts/Containerfile.linux" "$ROOT/scripts"
  exit 0
fi
if ! podman image exists "$IMAGE"; then
  bash "$0" setup
fi
if [ "$RUNTIME" = 0 ] && [ ! -x "$HOME/.cargo/bin/rustup" ]; then
  echo "Rust가 필요합니다. 먼저 make env-setup을 실행하세요." >&2
  exit 1
fi

DOWNLOADS="$(xdg-user-dir DOWNLOAD 2>/dev/null || true)"
DOWNLOADS="${DOWNLOADS:-$HOME/Downloads}"
mkdir -p "$DOWNLOADS"

args=(--rm --userns=keep-id --security-opt label=disable --network host
  --shm-size=512m --env HOME=/home/dev
  # GPU 장치가 없는 컨테이너에서 Skia/Mesa swrast 충돌을 피한다.
  --env WEBKIT_SKIA_ENABLE_CPU_RENDERING=1
  --env WEBKIT_DISABLE_COMPOSITING_MODE=1
  --volume ssh-editor-linux-home:/home/dev:U
  --volume "$DOWNLOADS:/home/dev/Downloads"
  --volume "$ROOT/scripts/linux-user-dirs.dirs:/home/dev/.config/user-dirs.dirs:ro"
  --volume "$ROOT:/workspace"
  --volume /etc/localtime:/etc/localtime:ro
  --env CARGO_TARGET_DIR=/workspace/src-tauri/target/linux-container)
if [ -d "$HOME/.ssh" ]; then
  args+=(--volume "$HOME/.ssh:/home/dev/.ssh:ro")
fi
if [ "$RUNTIME" = 0 ]; then
  args+=(--volume "$HOME/.cargo:/home/dev/.cargo"
    --volume "$HOME/.rustup:/home/dev/.rustup:ro")
fi
if [ -n "${DISPLAY:-}" ]; then
  args+=(--env "DISPLAY=$DISPLAY" --volume /tmp/.X11-unix:/tmp/.X11-unix:ro)
  auth="${XAUTHORITY:-$HOME/.Xauthority}"
  if [ -f "$auth" ]; then
    args+=(--env XAUTHORITY=/tmp/ssh-editor.xauthority --volume "$auth:/tmp/ssh-editor.xauthority:ro")
  fi
fi
if [ -n "${SSH_AUTH_SOCK:-}" ] && [ -S "$SSH_AUTH_SOCK" ]; then
  args+=(--env SSH_AUTH_SOCK=/tmp/ssh-agent --volume "$SSH_AUTH_SOCK:/tmp/ssh-agent")
fi
# 파일 연결로 받은 호스트 경로를 컨테이너에서도 같은 절대 경로로 접근한다.
# 상위 폴더를 마운트해야 파일을 연 뒤 형제 파일 탐색/저장이 가능하다.
if [ "$RUNTIME" = 1 ] && [ "$#" -gt 1 ]; then
  runtime_args=("$1")
  shift
  declare -A mounted_dirs=()
  for file_arg in "$@"; do
    if [[ "$file_arg" == file://* ]]; then
      file_arg="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(urllib.parse.urlparse(sys.argv[1]).path))' "$file_arg")"
    fi
    if [ -f "$file_arg" ]; then
      file_arg="$(realpath -- "$file_arg")"
      file_dir="$(dirname -- "$file_arg")"
      if [ -z "${mounted_dirs[$file_dir]:-}" ]; then
        args+=(--volume "$file_dir:$file_dir")
        mounted_dirs[$file_dir]=1
      fi
    fi
    runtime_args+=("$file_arg")
  done
  set -- "${runtime_args[@]}"
fi
if [ "$#" -eq 0 ]; then
  set -- npm run native
fi
exec podman run "${args[@]}" "$IMAGE" "$@"
