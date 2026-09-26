import { useId } from 'react'

import signatureUrl from './assets/signature.png'

/**
 * The company's oval rubber stamp, redrawn in vector from the scanned original
 * so it prints sharp: the geometry below is measured off the scan (in its
 * pixels), and the lettering follows it — heavy grotesque name across the top,
 * "email:" inside the inner oval, stars at the waist, the dater's red date in
 * the middle, "Sign:" with its dotted rule, and the postal address across the
 * foot in the stamp's own mixed case. The signature is the real one, lifted
 * from the scan (`assets/signature.png`) — the only raster in the stamp.
 *
 * Stamp blue and dater red are the physical stamp's inks: artwork like the
 * logo, never UI palette tokens (docs/brand.md).
 */

const INK = '#2336b4'
const DATER_INK = '#d03a32'

/** Outer rim, measured off the scan. */
const OUTER = { cx: 545, cy: 322, rx: 500, ry: 282 }
/** Inner oval: lower than the rim's centre, so the name band is the deep one. */
const INNER = { cx: 540, cy: 350, rx: 392, ry: 176 }

type Ellipse = { cx: number; cy: number; rx: number; ry: number }

/** Left to right, through the top (sweep 1) or the bottom (sweep 0). */
function arc({ cx, cy, rx, ry }: Ellipse, overTop: boolean): string {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 ${overTop ? 1 : 0} ${cx + rx} ${cy}`
}

function Star({ x, y }: { x: number; y: number }) {
  const points = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? 17 : 7
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    return `${(x + r * Math.cos(angle)).toFixed(1)},${(y + r * Math.sin(angle)).toFixed(1)}`
  }).join(' ')
  return <polygon points={points} fill={INK} />
}

export interface InvoiceStampProps {
  /** Already formatted, "23 AUG 2026". */
  date: string
  email: string | null
}

export function InvoiceStamp({ date, email }: InvoiceStampProps) {
  const id = useId().replace(/:/g, '')
  const top = `${id}-top`
  const bottom = `${id}-bottom`
  const inner = `${id}-inner`
  const wear = `${id}-wear`

  return (
    <svg
      viewBox="24 24 1042 610"
      className="inv-stamp-art"
      role="img"
      aria-label={`Rasko Sweet Scent Ltd stamp, signed and dated ${date}`}
    >
      <defs>
        <path id={top} d={arc({ cx: 545, cy: 345, rx: 432, ry: 232 }, true)} />
        <path id={bottom} d={arc({ cx: 545, cy: 322, rx: 452, ry: 254 }, false)} />
        <path id={inner} d={arc({ cx: 540, cy: 360, rx: 334, ry: 140 }, true)} />
        {/* The faint unevenness of a rubber stamp, kept light so it stays crisp. */}
        <filter id={wear} x="-3%" y="-3%" width="106%" height="106%">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="11" />
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.5 1.3" />
          <feComposite in="SourceGraphic" operator="in" />
        </filter>
      </defs>

      <g filter={`url(#${wear})`} fill={INK}>
        <g fill="none" stroke={INK}>
          <ellipse {...OUTER} strokeWidth={11} />
          <ellipse {...OUTER} rx={OUTER.rx - 17} ry={OUTER.ry - 17} strokeWidth={4} />
          <ellipse {...INNER} strokeWidth={5} />
        </g>

        <text
          className="inv-stamp-name"
          fontSize={66}
          textLength={960}
          lengthAdjust="spacingAndGlyphs"
        >
          <textPath href={`#${top}`} startOffset="50%" textAnchor="middle">
            RASKO SWEET SCENT LTD.
          </textPath>
        </text>
        <text
          className="inv-stamp-sans"
          fontSize={46}
          textLength={700}
          lengthAdjust="spacingAndGlyphs"
        >
          <textPath href={`#${bottom}`} startOffset="50%" textAnchor="middle">
            P.O. Box 14369-00800. Nairobi
          </textPath>
        </text>
        <Star x={98} y={332} />
        <Star x={992} y={340} />

        {email ? (
          <text className="inv-stamp-sans" fontSize={27}>
            <textPath href={`#${inner}`} startOffset="50%" textAnchor="middle">
              email:{email}
            </textPath>
          </text>
        ) : null}

        <text
          className="inv-stamp-date"
          x={522}
          y={384}
          fill={DATER_INK}
          fontSize={80}
          textLength={430}
          lengthAdjust="spacing"
          textAnchor="middle"
        >
          {date}
        </text>

        <text className="inv-stamp-sans" x={306} y={474} fontSize={44}>
          Sign:...................
        </text>
      </g>

      <image
        href={signatureUrl}
        x={464}
        y={270}
        width={442}
        height={255}
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  )
}
