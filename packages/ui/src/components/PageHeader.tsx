import type { ReactNode } from 'react'

import { cx } from '../utils/cx.js'

export interface PageHeaderProps {
  title: string
  description?: string
  /** Primary and secondary actions for the screen. */
  actions?: ReactNode
  /** Counts or status shown beside the title. */
  meta?: ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, meta, className }: PageHeaderProps) {
  return (
    <header className={cx('rsk-page-header', className)}>
      <div className="rsk-page-header__text">
        <div className="rsk-page-header__title-row">
          <h1 className="rsk-page-header__title">{title}</h1>
          {meta}
        </div>
        {description ? <p className="rsk-page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="rsk-page-header__actions">{actions}</div> : null}
    </header>
  )
}
