// Standalone single-file build (P13 step 2): one self-contained HTML file
// for hosts that serve a single file, or for opening directly. No service
// worker and no manifest: the PWA build in dist/ is the primary artifact.
// The virtual:pwa-register module is stubbed so main.tsx builds unchanged.
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

function pwaStub(): Plugin {
  return {
    name: 'zanshin-standalone-pwa-stub',
    resolveId(id) {
      if (id === 'virtual:pwa-register') return '\0virtual:pwa-register';
      return null;
    },
    load(id) {
      if (id === '\0virtual:pwa-register') {
        return 'export function registerSW() { return async () => {}; }';
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), viteSingleFile(), pwaStub()],
  build: {
    outDir: 'dist-standalone',
  },
});
