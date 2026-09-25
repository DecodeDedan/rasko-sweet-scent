import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The installed version, shown in the shell and compared by the updater.
// tauri.conf.json reads the same package.json, so the two cannot differ.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string }

// Set by `tauri android dev` when serving to a physical device.
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],

  define: { __APP_VERSION__: JSON.stringify(version) },

  // The .env file lives at the repository root and is shared with the website,
  // so Vite has to look one level above the app.
  envDir: fileURLToPath(new URL('../..', import.meta.url)),

  // .env.example names the Supabase variables without a VITE_ prefix. Widen the
  // allowlist instead of renaming them, so the documented names keep working.
  // Only these prefixes are exposed to client code — nothing else leaks into the bundle.
  envPrefix: ['VITE_', 'SUPABASE_', 'APP_'],

  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    watch: {
      // src-tauri is watched by cargo, not Vite.
      ignored: ['**/src-tauri/**'],
    },
    ...(host ? { hmr: { protocol: 'ws' as const, host, port: 1421 } } : {}),
  },

  build: {
    // Split the vendor libraries out of the app chunk. Two reasons: an update
    // that only touches app code leaves the vendor chunk cached, and the split
    // makes it visible in the build output where the weight actually is.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
          icons: ['lucide-react'],
        },
      },
    },
    // Windows ships a Chromium-based WebView2; Android 8 ships an older WebView.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'es2020',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
})
