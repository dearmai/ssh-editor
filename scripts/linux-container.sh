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

args=(--rm --userns=keep-id --security-opt label=disable --network host
  --shm-size=512m --env HOME=/home/dev
  --volume ssh-editor-linux-home:/home/dev:U
  --volume "$ROOT:/workspace"
  --volume /etc/localtime:/etc/localtime:ro
  --env CARGO_TARGET_DIR=/workspace/src-tauri/target/linux-container)
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
if [ "$#" -eq 0 ]; then
  set -- npm run native
fi
exec podman run "${args[@]}" "$IMAGE" "$@"
