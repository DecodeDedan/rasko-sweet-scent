import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The installed version, shown in the shell and compared by the updater.
// tauri.conf.json reads the same package.json, so the two cannot differ.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string }

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  envPrefix: ['VITE_', 'SUPABASE_', 'APP_'],
  test: {
    environment: 'jsdom',
    // Vite's built-in module list predates node:sqlite, so without this the
    // integration tests fail with "Failed to load url sqlite".
    server: { deps: { external: ['node:sqlite'] } },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
