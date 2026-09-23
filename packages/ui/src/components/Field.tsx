'use client'

import { createContext, useContext, useId } from 'react'
import type { ReactNode } from 'react'

import { cx } from '../utils/cx.js'

interface FieldContextValue {
  controlId: string
  describedBy: string | undefined
  isInvalid: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

/**
 * Lets Input and Select wire themselves to the surrounding Field — id, invalid
 * state, and the hint/error they are described by — so a caller cannot forget
 * the accessibility plumbing.
 */
export function useFieldControl(): FieldContextValue | null {
  return useContext(FieldContext)
}

export interface FieldProps {
  label: string
  children: ReactNode
  /** Guidance shown under the control. Not a placeholder — placeholders vanish on focus. */
  hint?: string
  error?: string
  isRequired?: boolean
  className?: string
}

export function Field({ label, children, hint, error, isRequired = false, className }: FieldProps) {
  const id = useId()
  const controlId = `${id}-control`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  const describedBy = cx(hint ? hintId : '', error ? errorId : '').trim() || undefined

  return (
    <FieldContext.Provider value={{ controlId, describedBy, isInvalid: Boolean(error) }}>
      <div className={cx('rsk-field', className)}>
        <label className="rsk-field__label" htmlFor={controlId}>
          {label}
          {isRequired ? (
            <span className="rsk-field__required" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>

        {children}

        {hint && !error ? (
          <p className="rsk-field__hint" id={hintId}>
            {hint}
          </p>
        ) : null}

        {error ? (
          <p className="rsk-field__error" id={errorId}>
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}
