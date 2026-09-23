import type { HTMLAttributes, ReactNode } from 'react'

import { cx } from '../utils/cx.js'

// `title` is omitted from the DOM attributes: here it is the card heading, not
// the browser tooltip that HTMLAttributes declares as a string.
export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  /** Right-hand side of the card header. */
  action?: ReactNode
  footer?: ReactNode
  /** Removes body padding, for a card wrapping a full-bleed table. */
  isFlush?: boolean
}

/**
 * The mobile counterpart to Table: PRD §7 asks for tables on desktop and cards
 * on mobile, so list screens render both and let CSS choose.
 */
export function Card({
  title,
  action,
  footer,
  isFlush = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div className={cx('rsk-card', className)} {...rest}>
      {title || action ? (
        <div className="rsk-card__header">
          {typeof title === 'string' ? <h3 className="rsk-card__title">{title}</h3> : title}
          {action ? <div className="rsk-card__action">{action}</div> : null}
        </div>
      ) : null}
      <div className={cx('rsk-card__body', isFlush && 'rsk-card__body--flush')}>{children}</div>
      {footer ? <div className="rsk-card__footer">{footer}</div> : null}
    </div>
  )
}
