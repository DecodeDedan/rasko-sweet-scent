import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every `rsk-` class a component references must be defined in the stylesheets.
 *
 * Regression guard. base.css once defined `.rasko-numeric` while every component
 * asked for `.rsk-numeric`, so money columns silently lost their tabular
 * numerals and right alignment — a binding brand rule — in every table in the
 * app. Nothing caught it: typecheck cannot see CSS, and jsdom loads no
 * stylesheet, so component tests pass either way.
 */
// fileURLToPath, not .pathname: on Windows .pathname is '/D:/a/...', which
// join() turns into 'D:\D:\a\...'.
const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function readAll(dir: string, extension: string): string {
  let text = ''
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) text += readAll(path, extension)
    else if (entry.name.endsWith(extension)) text += readFileSync(path, 'utf8')
  }
  return text
}

describe('design system class names', () => {
  it('defines every rsk- class the components use', () => {
    const css = readAll(join(ROOT, 'src/styles'), '.css')
    const source = readAll(join(ROOT, 'src/components'), '.tsx')

    const defined = new Set(
      [...css.matchAll(/\.(rsk-[a-z0-9-]+)/g)].map((match) => match[1] as string),
    )
    // Only literal class names can be checked; `rsk-btn--${variant}` templates
    // cannot. Literals are enough to catch a prefix typo.
    const used = new Set(
      [...source.matchAll(/'(rsk-[a-z0-9-]+)'/g)].map((match) => match[1] as string),
    )

    const missing = [...used].filter((name) => !defined.has(name))
    expect(missing, 'classes used by components but never defined in CSS').toEqual([])
  })

  it('defines the numeric helper the money columns depend on', () => {
    const css = readAll(join(ROOT, 'src/styles'), '.css')
    expect(css).toMatch(/\.rsk-numeric\s*\{[^}]*tabular-nums/)
    expect(css).toMatch(/\.rsk-numeric\s*\{[^}]*text-align:\s*right/)
  })
})
