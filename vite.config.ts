import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), {
    name: 'verify-monaco-sanitizer',
    generateBundle() {
      const modules = [...this.getModuleIds()].map((id) => id.replaceAll('\\', '/'));
      if (modules.some((id) => id.includes('/monaco-editor/') && id.endsWith('/dompurify/dompurify.js'))) {
        this.error('Monaco vendored DOMPurify must not enter the production bundle');
      }
      if (!modules.some((id) => id.endsWith('/dompurify/dist/purify.es.mjs'))) {
        this.error('Patched DOMPurify module is missing from the production bundle');
      }
    },
  }],
  resolve: {
    alias: [{
      // Monaco vendors DOMPurify in its ESM sources as well as its prebuilt AMD
      // files. A package override alone does not replace that embedded code.
      find: /^(?:.*\/)?dompurify\/dompurify\.js$/,
      replacement: 'dompurify',
    }],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
