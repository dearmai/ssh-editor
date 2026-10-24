import { cpSync, mkdirSync } from 'node:fs';

// Bundle Monaco's AMD distribution, including language workers, for offline use.
mkdirSync('dist/monaco', { recursive: true });
cpSync('node_modules/monaco-editor/min/vs', 'dist/monaco/vs', { recursive: true });
