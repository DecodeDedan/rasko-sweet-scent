import type { ReactNode } from 'react'

import { Plate } from './Plate'
import type { PhotoName } from '../content/photos'

/**
 * Every photograph below the hero sits in one of these, at one ratio and one
 * column width (`.rw-cards`), so no image on the page is larger than another.
 *
 * The card is white on the green page and restores the dark text tokens
 * inside itself, so anything placed in `children` reads as it would on white.
 */

/** A card is one column of the four-column `.rw-cards` grid at every breakpoint. */
const CARD_SIZES = '(min-width: 64rem) 18rem, (min-width: 40rem) 45vw, 100vw'

type Props = {
  photo: PhotoName
  children: ReactNode
  className?: string
}

export function PhotoCard({ photo, children, className }: Props) {
  const classes = className === undefined ? 'rw-card' : `rw-card ${className}`

  return (
    <div className={classes}>
      <Plate photo={photo} shape="portrait" sizes={CARD_SIZES} />
      <div className="rw-card__body">{children}</div>
    </div>
  )
}
