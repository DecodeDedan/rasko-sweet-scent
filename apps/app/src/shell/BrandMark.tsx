import { cx } from '@rasko/ui'

// The client's stacked RSS monogram, the one source file (docs/brand.md). Vite
// fingerprints and bundles it, so it works offline like every other asset.
import logoUrl from '../../../../docs/brand/logo.svg?url'

export interface BrandMarkProps {
  /** Rendered height in px. The mark is taller than wide: always size by height. */
  height?: number
  /** White, for green grounds. A filter, so there is still exactly one file. */
  isReversed?: boolean
  className?: string
}

const ASPECT = 3847 / 4537 // the logo's own viewBox, so the width never stretches it

export function BrandMark({ height = 40, isReversed = false, className }: BrandMarkProps) {
  return (
    <img
      src={logoUrl}
      alt=""
      aria-hidden="true"
      width={Math.round(height * ASPECT)}
      height={height}
      className={cx('brand-mark', isReversed && 'brand-mark--reversed', className)}
      draggable={false}
    />
  )
}
