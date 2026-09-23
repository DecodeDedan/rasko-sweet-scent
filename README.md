Rasko Sweet Scent — Business Management System
Offline-first business management app (Windows + Android) plus marketingwebsite. One React/TypeScript codebase, Tauri 2 shell, Supabase backend.

Layout
apps/app Tauri 2 + React desktop/mobile app
apps/website Next.js marketing site
packages/ui Shared design system
docs/ PRD, brand, architecture, progress — source of truth
Rules of engagement
All requirements live in docs/prd.md (FR-x.x / NFR-x.x IDs)
All visual decisions live in docs/brand.md
Build one module per session; check off docs/PROGRESS.md
See docs/prd.md section 6 for the offline/sync contract
