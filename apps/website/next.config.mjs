import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// One .env at the repository root serves the app and the site (CLAUDE.md). CI
// sets the variables directly, so a missing file is not an error; a missing
// variable is.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

// /reset-password completes invitations and password resets (FR-1.5, FR-1.6)
// against Supabase with the anon key, which is public by design. Without these
// the page would build and then fail for every invited user, so the build fails.
for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is not set. See .env.example.`)
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    SUPABASE_URL: process.env.SUPABASE_URL.trim(),
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY.trim(),
  },

  // Static-first: the site exports to plain files. The one page that talks to
  // Supabase, /reset-password, does so from the browser, so no server runtime
  // is required.
  output: 'export',

  // next/image optimisation needs a server; static export cannot use it.
  images: { unoptimized: true },

  // @rasko/ui ships TypeScript source rather than a build artifact.
  transpilePackages: ['@rasko/ui'],

  // @rasko/ui imports its own modules as './Button.js' (NodeNext style) while
  // the files are .tsx. tsc maps the extension; webpack only does when told.
  webpack(config) {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return config
  },

  reactStrictMode: true,
  trailingSlash: true,
}

export default nextConfig
