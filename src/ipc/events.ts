import { listen } from '@tauri-apps/api/event';
import type { TerminalDataEvent, TransferProgressEvent } from '../types';

export const onTerminalData = (handler: (payload: TerminalDataEvent) => void) =>
  listen<TerminalDataEvent>('terminal-data', (e) => handler(e.payload));

export const onTransferProgress = (handler: (payload: TransferProgressEvent) => void) =>
  listen<TransferProgressEvent>('transfer-progress', (e) => handler(e.payload));

export const onConnectionStateChanged = (
  handler: (payload: { sessionId: string; state: 'connected' | 'disconnected' | 'error'; error?: string }) => void
) =>
  listen('connection-state-changed', (e) =>
    handler(e.payload as { sessionId: string; state: 'connected' | 'disconnected' | 'error'; error?: string })
  );
