'use client'

import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { cx } from '../utils/cx.js'
import { useDialogElement } from '../utils/useDialogElement.js'

export interface DrawerProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  /** `end` is the right edge on desktop; `bottom` is the mobile sheet. */
  side?: 'end' | 'bottom'
  className?: string
}

/**
 * Same dialog mechanics as Modal, anchored to an edge. Used for record detail
 * and filter panels, where the list behind should stay visible for context.
 */
export function Drawer({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  side = 'end',
  className,
}: DrawerProps) {
  const ref = useDialogElement(isOpen, onClose)

  return (
    <dialog ref={ref} className={cx('rsk-drawer', `rsk-drawer--${side}`, className)}>
      <div className="rsk-drawer__panel">
        <header className="rsk-drawer__header">
          <div>
            <h2 className="rsk-drawer__title">{title}</h2>
            {description ? <p className="rsk-drawer__description">{description}</p> : null}
          </div>
          <button type="button" className="rsk-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="rsk-drawer__body">{children}</div>
        {footer ? <footer className="rsk-drawer__footer">{footer}</footer> : null}
      </div>
    </dialog>
  )
}
