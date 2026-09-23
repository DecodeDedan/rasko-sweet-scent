/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static-first: the site exports to plain files. The contact form posts
  // straight to Supabase with the anon key against an insert-only,
  // captcha-protected table (PRD §7), so no server runtime is required.
  output: 'export',

  // next/image optimisation needs a server; static export cannot use it.
  images: { unoptimized: true },

  // @rasko/ui ships TypeScript source rather than a build artifact.
  transpilePackages: ['@rasko/ui'],

  reactStrictMode: true,
  trailingSlash: true,
}

export default nextConfig
