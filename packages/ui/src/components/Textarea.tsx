'use client'

import { forwardRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'

import { cx } from '../utils/cx.js'
import { useFieldControl } from './Field.js'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  isInvalid?: boolean
}

/**
 * Input's multi-line twin: same styling, same label and hint wiring from Field.
 * Forwards its ref so a caller can insert text at the cursor.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { isInvalid, className, rows = 4, ...rest },
  ref,
) {
  const field = useFieldControl()
  const invalid = isInvalid ?? field?.isInvalid ?? false

  return (
    <textarea
      ref={ref}
      id={rest.id ?? field?.controlId}
      aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
      aria-invalid={invalid || undefined}
      rows={rows}
      className={cx('rsk-input', className)}
      {...rest}
    />
  )
})
