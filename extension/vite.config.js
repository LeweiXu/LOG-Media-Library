import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// The popup is a normal Vite React app that imports the real frontend modals
// (AuthModal, EntryForm) from ../frontend so they stay in sync. `base: './'`
// keeps asset URLs relative, which is required under the chrome-extension://
// origin. manifest.json + icons live in public/ and are copied verbatim.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { popup: resolve(__dirname, 'popup.html') },
    },
  },
});
