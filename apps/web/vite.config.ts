import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // The package ships web workers and WASM: do not pre-bundle it.
  optimizeDeps: { exclude: ['@powersync/web'] },
  worker: { format: 'es' },
  // dev: one origin through Vite, like production
  server: { proxy: { '/api': 'http://127.0.0.1:8080', '/powersync': 'http://127.0.0.1:8080' } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024, // the SQLite WASM is over the 2 MiB default
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/powersync\//, /^\/\.well-known\//],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm,webmanifest}'],
        // No runtime caching for /api or /powersync: the service worker must never touch the sync stream.
      },
      manifest: {
        name: 'Day Planner',
        short_name: 'Planner',
        description: 'Plan your day.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f5f2',
        theme_color: '#f6f5f2',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
