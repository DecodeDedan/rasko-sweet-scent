/**
 * Configuration read at startup from the repository-root .env
 * (see .env.example). Validated eagerly so a misconfigured build fails
 * immediately and visibly, rather than at the first sync attempt.
 */

export type AppEnvironment = 'development' | 'staging' | 'production'

export interface AppConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  environment: AppEnvironment
  /**
   * Where a password-reset email sends the user (FR-1.5). A desktop app has no
   * URL to land on, so the link goes to a page on the marketing site that
   * completes the reset; the user then signs in here with the new password.
   */
  passwordResetUrl: string
}

const ENVIRONMENTS: readonly AppEnvironment[] = ['development', 'staging', 'production']

function required(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env at the repository root and fill it in.`,
    )
  }
  return value.trim()
}

function readEnvironment(): AppEnvironment {
  const value = import.meta.env.APP_ENV?.trim()
  if (!value) return 'development'
  const match = ENVIRONMENTS.find((candidate) => candidate === value)
  if (!match) {
    throw new Error(`APP_ENV must be one of ${ENVIRONMENTS.join(', ')} — received "${value}".`)
  }
  return match
}

/**
 * Plaintext is allowed only for a loopback address.
 *
 * The anon key and every JWT travel over this URL, so http to a remote host
 * would put them on the wire in the clear. Loopback is the local Supabase stack
 * (`supabase start`), which serves http on 127.0.0.1 and never leaves the
 * machine — refusing it would make local development impossible.
 */
function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

export function loadConfig(): AppConfig {
  const supabaseUrl = required('SUPABASE_URL')
  if (!supabaseUrl.startsWith('https://') && !isLoopback(supabaseUrl)) {
    throw new Error(
      'SUPABASE_URL must be an https:// URL, or http on localhost for local development.',
    )
  }

  return {
    supabaseUrl,
    supabaseAnonKey: required('SUPABASE_ANON_KEY'),
    environment: readEnvironment(),
    passwordResetUrl:
      import.meta.env.APP_PASSWORD_RESET_URL?.trim() ||
      'https://raskosweetscent.co.ke/reset-password',
  }
}

export interface ConfigStatus {
  config: AppConfig | null
  /** Why configuration is unavailable, for display. Null when it loaded. */
  problem: string | null
}

/**
 * Non-throwing variant for UI that must render regardless. The shell has to
 * boot with no .env at all — there is no backend yet — so a missing value is a
 * state to display, not a crash.
 */
export function readConfigStatus(): ConfigStatus {
  try {
    return { config: loadConfig(), problem: null }
  } catch (cause) {
    return { config: null, problem: cause instanceof Error ? cause.message : String(cause) }
  }
}
