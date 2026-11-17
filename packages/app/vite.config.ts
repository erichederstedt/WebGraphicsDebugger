import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  // escaper's jsnext:main points to a file missing from its npm package.
  resolve: { alias: { escaper: 'escaper/dist/escaper.js' } },
  plugins: [nodePolyfills({ include: ['assert', 'events', 'stream', 'string_decoder'] })],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
});
