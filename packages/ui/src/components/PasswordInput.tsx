'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

import { Input } from './Input.js'
import type { InputProps } from './Input.js'

export type PasswordInputProps = Omit<InputProps, 'type'>

/**
 * A password field with a show/hide toggle, so a long password can be checked
 * before it is sent, which matters most on a phone keyboard.
 *
 * The toggle is a real button: keyboard reachable, named by what it will do
 * ("Show password"), with aria-pressed carrying its state, so the state is
 * never shown by the icon alone. It is type="button" so it never submits the
 * form. Nothing here persists the choice: every field starts hidden.
 */
export function PasswordInput({ className, disabled, ...rest }: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false)
  const Icon = isVisible ? EyeOff : Eye

  return (
    <span className="rsk-password">
      <Input
        {...rest}
        type={isVisible ? 'text' : 'password'}
        {...(disabled === undefined ? {} : { disabled })}
        className={className ? `rsk-password__input ${className}` : 'rsk-password__input'}
        // A visible password must not be autocorrected or capitalised.
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="rsk-password__toggle"
        aria-label={isVisible ? 'Hide password' : 'Show password'}
        aria-pressed={isVisible}
        {...(disabled === undefined ? {} : { disabled })}
        onClick={() => setIsVisible((current) => !current)}
      >
        <Icon size={18} aria-hidden="true" />
      </button>
    </span>
  )
}
