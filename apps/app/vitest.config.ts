import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
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
