import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The RSS monogram as inline SVG, so GSAP can draw it (ScrollMotion.tsx).
 *
 * A server component: the path is read from docs/brand/logo.svg at build
 * time, so there is still exactly one logo file and the path data ships as
 * HTML rather than inside a JavaScript bundle.
 *
 * Two paths share the outline. `__fill` is the logo as it always appears.
 * `__line` has no stroke in the markup; GSAP gives it one only for the
 * length of the drawing animation, so without script the mark is simply
 * there, filled, with nothing hidden.
 */

const LOGO_FILE = join(process.cwd(), '..', '..', 'docs', 'brand', 'logo.svg')

function readLogo(): { viewBox: string; d: string } {
  const source = readFileSync(LOGO_FILE, 'utf8')
  const viewBox = /viewBox="([^"]+)"/.exec(source)?.[1]
  const d = /<path[^>]*\sd="([^"]+)"/.exec(source)?.[1]
  if (viewBox === undefined || d === undefined) {
    throw new Error(`${LOGO_FILE} has no viewBox or path; BrandMark cannot render it`)
  }
  return { viewBox, d }
}

type Props = {
  className?: string
  /** Accessible name. Omit when the name is already given in text beside the mark. */
  label?: string
}

export function BrandMark({ className, label }: Props) {
  const { viewBox, d } = readLogo()
  const classes = className === undefined ? 'rw-brandmark' : `rw-brandmark ${className}`

  return (
    <svg
      className={classes}
      viewBox={viewBox}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      <path className="rw-brandmark__fill" d={d} fill="currentColor" fillRule="evenodd" />
      <path className="rw-brandmark__line" d={d} fill="none" />
    </svg>
  )
}
