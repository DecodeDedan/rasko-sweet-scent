'use client'

import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

import { cx } from '../utils/cx.js'

export interface TooltipProps {
  /** Short, plain text. A tooltip adds a name or a hint; it never holds the only copy of something. */
  label: ReactNode
  /** One focusable element: a button or a link. */
  children: ReactElement<{ 'aria-describedby'?: string }>
  placement?: 'top' | 'bottom' | 'right'
  className?: string
}

/** Long enough that sweeping the pointer across a toolbar does not flicker. */
const OPEN_DELAY_MS = 350

/**
 * A hint on hover and on keyboard focus (WCAG 1.4.13: dismissible with Escape,
 * stays while hovered, never on a timer alone). The trigger is described by
 * the tip through aria-describedby, so a screen reader hears it too.
 *
 * Touch devices have no hover, so anything a tooltip says must also be
 * reachable another way. Use it for icon-only buttons and short hints.
 */
export function Tooltip({ label, children, placement = 'top', className }: TooltipProps) {
  const id = useId()
  const [isOpen, setIsOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const openSoon = () => {
    clear()
    timer.current = setTimeout(() => setIsOpen(true), OPEN_DELAY_MS)
  }
  const openNow = () => {
    clear()
    setIsOpen(true)
  }
  const close = () => {
    clear()
    setIsOpen(false)
  }

  useEffect(() => {
    if (!isOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen])

  useEffect(() => clear, [])

  const describedBy = isValidElement(children)
    ? cx(children.props['aria-describedby'], isOpen && id)
    : ''
  const trigger =
    isValidElement(children) && describedBy
      ? cloneElement(children, { 'aria-describedby': describedBy })
      : children

  return (
    <span
      className={cx('rsk-tooltip', className)}
      onPointerEnter={openSoon}
      onPointerLeave={close}
      onFocus={openNow}
      onBlur={close}
    >
      {trigger}
      {isOpen ? (
        <span
          id={id}
          role="tooltip"
          className={cx('rsk-tooltip__bubble', `rsk-tooltip__bubble--${placement}`)}
        >
          {label}
        </span>
      ) : null}
    </span>
  )
}
