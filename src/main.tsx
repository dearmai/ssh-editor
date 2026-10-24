import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import { loader } from '@monaco-editor/react';

if (import.meta.env.PROD) {
  loader.config({ paths: { vs: `${window.location.origin}/monaco/vs` } });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
