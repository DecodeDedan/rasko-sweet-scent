// Copies the app icons `tauri icon` just generated into the website's app/
// directory, where Next's file conventions serve them at /favicon.ico,
// /icon.png and /apple-icon.png. Google shows a site's favicon in search only
// if it is square and at least 48px; logo.svg is taller than wide, so the
// website uses the same square tile as the app. Run as part of `pnpm icon`,
// never by hand, so the logo keeps one source.
import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const icons = fileURLToPath(new URL('../src-tauri/icons/', import.meta.url))
const websiteApp = fileURLToPath(new URL('../../website/app/', import.meta.url))

copyFileSync(`${icons}icon.ico`, `${websiteApp}favicon.ico`)
copyFileSync(`${icons}icon.png`, `${websiteApp}icon.png`) // 512x512
copyFileSync(`${icons}128x128@2x.png`, `${websiteApp}apple-icon.png`) // 256x256
