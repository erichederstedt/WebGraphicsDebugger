import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Builds the single-file bundle meant to be <script>-injected into third-party
// pages, e.g.:
//   var s = document.createElement('script');
//   s.onload = () => new window.WGD.Debugger().displayUI();
//   document.head.appendChild(s);
//   s.src = 'https://.../wgd.bundle.js';
export default defineConfig({
  // escaper's jsnext:main points to a file missing from its npm package.
  resolve: { alias: { escaper: 'escaper/dist/escaper.js' } },
  plugins: [nodePolyfills({ include: ['assert', 'events', 'stream', 'string_decoder'] })],
  build: {
    copyPublicDir: false, // Demo models are not part of the injected debugger.
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
