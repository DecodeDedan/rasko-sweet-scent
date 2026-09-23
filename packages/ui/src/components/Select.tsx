'use client'

import { ChevronDown } from 'lucide-react'
import type { SelectHTMLAttributes } from 'react'

import { cx } from '../utils/cx.js'
import { useFieldControl } from './Field.js'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: readonly SelectOption[]
  /** Leading blank option, e.g. "All statuses". */
  placeholder?: string
  isInvalid?: boolean
}

/**
 * Deliberately a native <select>. The platform control gets the mobile picker,
 * keyboard behaviour and screen-reader support right, and it works offline with
 * no JavaScript beyond React.
 */
export function Select({ options, placeholder, isInvalid, className, ...rest }: SelectProps) {
  const field = useFieldControl()
  const invalid = isInvalid ?? field?.isInvalid ?? false

  return (
    <div className={cx('rsk-select', className)}>
      <select
        id={rest.id ?? field?.controlId}
        aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
        aria-invalid={invalid || undefined}
        className="rsk-select__control"
        {...rest}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="rsk-select__icon" size={16} aria-hidden="true" />
    </div>
  )
}
