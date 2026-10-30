import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/client/assets',
    emptyOutDir: false,
    sourcemap: true,
    minify: true,
    lib: {
      entry: fileURLToPath(new URL('./appearance.ts', import.meta.url)),
      name: 'DoctopusAppearance',
      formats: ['iife'],
      fileName: () => 'theme.js',
    },
  },
});
