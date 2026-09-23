'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cx } from '../utils/cx.js'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
  isFullWidth?: boolean
  /** Lucide icon element. One icon library, consistent stroke weight (PRD §7). */
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  isLoading = false,
  isFullWidth = false,
  leadingIcon,
  trailingIcon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'rsk-btn',
        `rsk-btn--${variant}`,
        `rsk-btn--${size}`,
        isFullWidth && 'rsk-btn--block',
        className,
      )}
      disabled={disabled === true || isLoading}
      aria-busy={isLoading || undefined}
      {...rest}
    >
      {isLoading ? <span className="rsk-spinner" aria-hidden="true" /> : leadingIcon}
      <span>{children}</span>
      {isLoading ? null : trailingIcon}
    </button>
  )
}
