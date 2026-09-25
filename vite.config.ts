import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // The dev server takes the port it is handed (the preview tooling assigns one), or Vite's default.
  server: { port: Number(process.env.PORT) || undefined, strictPort: !!process.env.PORT },
  build: {
    target: 'es2022',
    // three.js on its own is ~600 kB minified; the game code stays well under the default limit.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // three.js changes far less often than the game, so it gets its own long-lived chunk.
        advancedChunks: { groups: [{ name: 'three', test: /node_modules[\\/]three/ }] },
      },
    },
  },
});
