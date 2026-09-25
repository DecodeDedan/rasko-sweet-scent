/// <reference types="vite/client" />

/**
 * Variables exposed to the bundle. Names match .env.example exactly; the
 * matching prefixes are allowlisted in vite.config.ts (`envPrefix`).
 *
 * Only the anon key ever reaches the client. The Supabase service key lives
 * exclusively in GitHub Actions secrets and must never appear here (PRD §7).
 */
interface ImportMetaEnv {
  readonly SUPABASE_URL: string
  readonly SUPABASE_ANON_KEY: string
  readonly APP_ENV: string
  readonly APP_PASSWORD_RESET_URL?: string
  readonly APP_STAFF_EMAIL_DOMAIN?: string
}

/** package.json version, injected by vite.config.ts. */
declare const __APP_VERSION__: string

interface ImportMeta {
  readonly env: ImportMetaEnv
}
