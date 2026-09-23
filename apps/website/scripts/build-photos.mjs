/**
 * Builds the website's photography from the originals.
 *
 * next.config.mjs sets `output: 'export'` with `images: { unoptimized: true }`,
 * so there is no server to resize anything at request time. Every size the site
 * serves has to exist as a file before the export runs. That is what this does.
 *
 * Input:  photos.manifest.json (authored: which original, what alt text)
 * Output: public/photos/<name>-<width>.webp   and   content/photos.ts
 *
 * WebP rather than JPEG because the subject is foliage: thousands of small
 * high-contrast leaf edges are close to the worst case for a DCT codec, and
 * these originals are phone JPEGs that have already been through one lossy
 * pass. WebP holds that detail at roughly a third of the bytes.
 *
 * Run: pnpm --filter @rasko/website photos
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')

const manifest = JSON.parse(await readFile(join(appRoot, 'photos.manifest.json'), 'utf8'))
const sourceDir = resolve(appRoot, manifest.source)
// Licensed reference photography lives apart from the farm's own originals, so
// that provenance is a directory boundary and not a naming convention somebody
// has to remember. A photo carrying a `credit` comes from here.
const referenceDir = resolve(appRoot, manifest.referenceSource)
const dirFor = (photo) => (photo.credit ? referenceDir : sourceDir)
const outDir = join(appRoot, 'public', 'photos')

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

// Fail loudly on a missing original rather than silently exporting a site with
// holes in it. A typo in the manifest is otherwise invisible until production.
const present = {
  [sourceDir]: new Set(await readdir(sourceDir)),
  [referenceDir]: new Set(await readdir(referenceDir)),
}
const missing = manifest.photos.filter((p) => !present[dirFor(p)].has(p.file))
if (missing.length > 0) {
  console.error('Originals not found:')
  for (const p of missing) console.error('  %s/%s  (wanted by "%s")', dirFor(p), p.file, p.name)
  process.exit(1)
}

const entries = []
let totalBytes = 0

for (const photo of manifest.photos) {
  const input = sharp(join(dirFor(photo), photo.file)).rotate()
  const { width: srcWidth, height: srcHeight } = await input.metadata()

  // Never upscale. A 1200px original gets a 1200px top size, not a 1280px one
  // that invents detail and costs bytes to do it.
  const widths = manifest.widths
    .map((w) => Math.min(w, srcWidth))
    .filter((w, i, all) => all.indexOf(w) === i)
    .sort((a, b) => a - b)

  for (const width of widths) {
    const file = `${photo.name}-${width}.webp`
    const { size } = await input
      .clone()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: manifest.quality, effort: 6 })
      .toFile(join(outDir, file))
    totalBytes += size
  }

  entries.push({
    name: photo.name,
    alt: photo.alt,
    credit: photo.credit ?? null,
    widths,
    width: srcWidth,
    height: srcHeight,
  })

  console.log('%s  %dx%d  ->  %s', photo.name.padEnd(18), srcWidth, srcHeight, widths.join(', '))
}

const ts = `/**
 * GENERATED FILE. Do not edit.
 *
 * Written by scripts/build-photos.mjs from photos.manifest.json.
 * To change a photograph or its alt text, edit the manifest and re-run:
 *   pnpm --filter @rasko/website photos
 */

export type Photo = {
  /** Basename of the exported files in /public/photos. */
  readonly name: string
  /** Describes what is in the frame, for people who cannot see it. */
  readonly alt: string
  /** Exported widths, ascending. Used to build the srcset. */
  readonly widths: readonly number[]
  /** Intrinsic size of the original, so the browser can reserve the space. */
  readonly width: number
  readonly height: number
  /**
   * Set only on licensed reference photography that the farm did not shoot.
   * Null on the farm's own originals. Any component rendering a photo with a
   * credit must display it: that is the licence condition, not a nicety.
   */
  readonly credit: {
    readonly license: string
    readonly artist: string
    readonly url: string
  } | null
}

export const photos = {
${entries
  .map(
    (e) => `  '${e.name}': {
    name: '${e.name}',
    alt: ${JSON.stringify(e.alt)},
    credit: ${e.credit === null ? 'null' : JSON.stringify(e.credit)},
    widths: [${e.widths.join(', ')}],
    width: ${e.width},
    height: ${e.height},
  },`,
  )
  .join('\n')}
} as const satisfies Record<string, Photo>

export type PhotoName = keyof typeof photos
`

await writeFile(join(appRoot, 'content', 'photos.ts'), ts, 'utf8')

console.log(
  '\n%d photographs, %d files, %s total',
  entries.length,
  entries.reduce((n, e) => n + e.widths.length, 0),
  `${(totalBytes / 1024 / 1024).toFixed(2)} MB`,
)
