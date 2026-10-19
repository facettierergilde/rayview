import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'));

export default defineConfig({
  root: '.', // base directory
  base: './', // relative paths for NW.js file URLs
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000, // single three.js bundle loaded from disk by NW.js; splitting gains nothing
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  plugins: [
    {
      // Puts the app version from package.json into the window title (index.html)
      name: 'app-version',
      transformIndexHtml: html => html.replaceAll('%APP_VERSION%', version),
    },
    viteStaticCopy({
      targets: [
        {
          src: 'environments', // source folder
          dest: ''             // destination relative to dist/
        },
        {
          src: 'default.glb', // source folder
          dest: ''             // destination relative to dist/
        },
        {
          src: 'assets/icon.png', // source folder
          dest: ''             // keeps its assets/ folder -> dist/assets/icon.png (manifest window.icon)
        }
      ]
    })
  ],
});