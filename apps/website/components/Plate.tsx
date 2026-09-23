import type { PhotoName } from '../content/photos'
import { photos } from '../content/photos'

/**
 * A photograph in its frame.
 *
 * next/image is unavailable here: next.config.mjs exports the site as static
 * files with `images: { unoptimized: true }`, so there is no server to resize
 * anything on request. scripts/build-photos.mjs pre-renders every width
 * instead, and this builds the srcset over them.
 *
 * `sizes` is the part that actually saves the bytes. Without it the browser
 * assumes the image fills the viewport and downloads the largest file for a
 * plate that may be a quarter of the screen wide, so every caller states the
 * width the plate really occupies at each breakpoint.
 */

export type PlateShape = 'portrait' | 'landscape' | 'wide' | 'square'

export type PlateProps = {
  photo: PhotoName
  /** Crop ratio of the frame. The photograph is covered into it. */
  shape: PlateShape
  /** CSS `sizes`. Required, because guessing it wastes a visitor's bandwidth. */
  sizes: string
  /**
   * Set on the hero only. Everything below the fold stays lazy, which is what
   * keeps the first load to one photograph rather than ten.
   */
  priority?: boolean
  /** Keeps the sky in frame when a tall photograph is cropped to a band. */
  focusSky?: boolean
  className?: string
}

export function Plate({
  photo,
  shape,
  sizes,
  priority = false,
  focusSky = false,
  className,
}: PlateProps) {
  const source = photos[photo]
  const widths = source.widths
  const largest = widths[widths.length - 1]

  const srcSet = widths.map((w) => `/photos/${photo}-${w}.webp ${w}w`).join(', ')

  const classes = ['rw-plate', `rw-plate--${shape}`, focusSky ? 'rw-plate--sky' : null, className]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <img
        src={`/photos/${photo}-${largest}.webp`}
        srcSet={srcSet}
        sizes={sizes}
        alt={source.alt}
        /* Intrinsic dimensions, so the browser reserves the right box before
         * the file arrives and the page never jumps while loading. */
        width={source.width}
        height={source.height}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'sync' : 'async'}
        fetchPriority={priority ? 'high' : 'auto'}
      />
    </div>
  )
}
