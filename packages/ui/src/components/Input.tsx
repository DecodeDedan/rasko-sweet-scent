'use client'

import type { InputHTMLAttributes } from 'react'

import { cx } from '../utils/cx.js'
import { useFieldControl } from './Field.js'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  isInvalid?: boolean
  /** Right-aligns and applies tabular numerals — for money and quantity (docs/brand.md). */
  isNumeric?: boolean
}

export function Input({ isInvalid, isNumeric = false, className, ...rest }: InputProps) {
  const field = useFieldControl()
  const invalid = isInvalid ?? field?.isInvalid ?? false

  return (
    <input
      id={rest.id ?? field?.controlId}
      aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
      aria-invalid={invalid || undefined}
      className={cx('rsk-input', isNumeric && 'rsk-numeric', className)}
      {...rest}
    />
  )
}
