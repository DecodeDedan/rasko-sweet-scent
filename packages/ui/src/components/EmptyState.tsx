import type { ReactNode } from 'react'

import { cx } from '../utils/cx.js'

export interface EmptyStateProps {
  title: string
  /**
   * What the screen is for and what happens next. PRD §7: empty states instruct
   * and link to the next action — they are not decoration.
   */
  description: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cx('rsk-empty', className)}>
      {icon ? (
        <div className="rsk-empty__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="rsk-empty__title">{title}</h3>
      <p className="rsk-empty__description">{description}</p>
      {action ? <div className="rsk-empty__action">{action}</div> : null}
    </div>
  )
}
