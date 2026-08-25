import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Builds the single-file bundle meant to be <script>-injected into third-party
// pages, e.g.:
//   var s = document.createElement('script');
//   s.onload = () => new window.WGD.Debugger().displayUI();
//   document.head.appendChild(s);
//   s.src = 'https://.../wgd.bundle.js';
export default defineConfig({
  build: {
    outDir: 'dist-inject',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/inject.ts'),
      name: 'WGD',
      formats: ['iife'],
      fileName: () => 'wgd.bundle.js',
    },
  },
});
