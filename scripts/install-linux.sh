#!/usr/bin/env bash
# 사용자 계정에 바이너리와 앱 메뉴 실행기를 설치한다. sudo 불필요.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_DIR="$DATA_DIR/ssh-editor"
BIN_DIR="$HOME/.local/bin"
CONTAINER=0
if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  CONTAINER=1
  # 기존 이미지에도 추가된 런타임/번들 의존성을 반영한다.
  bash "$ROOT/scripts/linux-container.sh" setup
fi

bash "$ROOT/scripts/native.sh" release
mkdir -p "$APP_DIR/build/release" "$APP_DIR/scripts" "$BIN_DIR" "$DATA_DIR/applications"
# 실행 중인 이전 바이너리를 덮어쓰지 않고 교체한다.
install -m 755 "$ROOT/build/release/ssh-editor" "$APP_DIR/build/release/ssh-editor.new"
mv -f "$APP_DIR/build/release/ssh-editor.new" "$APP_DIR/build/release/ssh-editor"
install -m 644 "$ROOT/src-tauri/icons/128x128.png" "$APP_DIR/icon.png"
install -m 644 "$ROOT/scripts/linux-container.sh" "$ROOT/scripts/Containerfile.linux" "$APP_DIR/scripts/"

{
  printf '#!/usr/bin/env bash\nset -euo pipefail\n'
  if [ "$CONTAINER" = 1 ]; then
    printf 'exec bash %q --runtime /workspace/build/release/ssh-editor "$@"\n' "$APP_DIR/scripts/linux-container.sh"
  else
    printf 'exec %q "$@"\n' "$APP_DIR/build/release/ssh-editor"
  fi
} > "$BIN_DIR/ssh-editor.new"
chmod 755 "$BIN_DIR/ssh-editor.new"
mv -f "$BIN_DIR/ssh-editor.new" "$BIN_DIR/ssh-editor"

# Desktop Entry의 문자열/Exec 인용 규칙에 맞게 경로를 이스케이프한다.
desktop_string() { local s="$1"; s="${s//\\/\\\\}"; printf '%s' "$s"; }
desktop_exec() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//\$/\\\$}"; s="${s//\`/\\\`}"
  s="${s//%/%%}"
  desktop_string "$s"
}
cat > "$DATA_DIR/applications/io.rinjae.ssh-editor.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=SSH Editor
Comment=SSH remote file editor
Exec="$(desktop_exec "$BIN_DIR/ssh-editor")"
Icon=$(desktop_string "$APP_DIR/icon.png")
Terminal=false
Categories=Development;TextEditor;
StartupWMClass=Ssh-editor
EOF
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DATA_DIR/applications"
fi
echo "설치 완료: $BIN_DIR/ssh-editor"
echo "앱 메뉴의 SSH Editor 또는 위 경로로 실행하세요."
