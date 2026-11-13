import React from 'react';
import ReactDOM from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App';
import SealWindow from './components/SealWindow';
import { takeCryptoRequest } from './ipc/commands';
import './styles/globals.css';
import './monaco';

/** 탐색기 "보관/해제"로 실행된 메인 창이면 에디터 대신 단독 보관/해제 화면을 그린다 */
async function cryptoRequest() {
  if (getCurrentWindow().label !== 'main') return null;
  try {
    return await takeCryptoRequest();
  } catch {
    return null;
  }
}

void cryptoRequest().then((req) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>{req ? <SealWindow paths={req.paths} /> : <App />}</React.StrictMode>,
  );
});
