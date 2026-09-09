import type { IMarker, Terminal } from '@xterm/xterm';

/** 터미널별 스크롤 위치. 마커는 출력 추가·스크롤백 삭제·줄 재배치에 따라 이동한다. */
export class TerminalViewport {
  private atBottom = true;
  private line = 0;
  private marker: IMarker | undefined;
  private readonly terminal: Terminal;

  constructor(terminal: Terminal) {
    this.terminal = terminal;
  }

  capture() {
    const buffer = this.terminal.buffer.active;
    // 전체 화면 앱의 alternate buffer는 스크롤백이 없다. 일반 버퍼의 위치를 덮어쓰지 않는다.
    if (buffer.type !== 'normal') return;
    this.marker?.dispose();
    this.marker = undefined;
    this.line = buffer.viewportY;
    this.atBottom = buffer.viewportY >= buffer.baseY;
    if (!this.atBottom) {
      this.marker = this.terminal.registerMarker(buffer.viewportY - buffer.baseY - buffer.cursorY);
    }
  }

  restore() {
    const buffer = this.terminal.buffer.active;
    if (buffer.type !== 'normal') return;
    if (this.atBottom) {
      this.terminal.scrollToBottom();
    } else {
      // 저장한 줄이 스크롤백 한도로 삭제됐다면 남아 있는 가장 오래된 줄을 보여준다.
      const line = this.marker ? (this.marker.isDisposed ? 0 : this.marker.line) : this.line;
      this.terminal.scrollToLine(Math.max(0, Math.min(line, buffer.baseY)));
    }
  }

  dispose() {
    this.marker?.dispose();
    this.marker = undefined;
  }
}
