'use client'

import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { cx } from '../utils/cx.js'
import { useDialogElement } from '../utils/useDialogElement.js'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  /** Action row, right-aligned. Confirm sits last. */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: ModalProps) {
  const ref = useDialogElement(isOpen, onClose)

  return (
    <dialog ref={ref} className={cx('rsk-modal', `rsk-modal--${size}`, className)}>
      <div className="rsk-modal__panel">
        <header className="rsk-modal__header">
          <div>
            <h2 className="rsk-modal__title">{title}</h2>
            {description ? <p className="rsk-modal__description">{description}</p> : null}
          </div>
          <button type="button" className="rsk-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {children ? <div className="rsk-modal__body">{children}</div> : null}
        {footer ? <footer className="rsk-modal__footer">{footer}</footer> : null}
      </div>
    </dialog>
  )
}
