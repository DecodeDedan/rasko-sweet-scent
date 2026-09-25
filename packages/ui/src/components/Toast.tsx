'use client'

import { AlertTriangle, Check, Info, X } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { cx } from '../utils/cx.js'
import { Button } from './Button.js'

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger'

export interface ToastInput {
  title: string
  description?: string
  tone?: ToastTone
  /** Milliseconds before auto-dismiss. `null` keeps it until dismissed. */
  duration?: number | null
  /** One follow-up, such as installing an update. Dismisses the toast when chosen. */
  action?: { label: string; onClick: () => void }
  /** False keeps it on screen until its action is taken, such as a pending update. */
  isDismissible?: boolean
}

interface ToastRecord extends ToastInput {
  id: string
  tone: ToastTone
}

interface ToastContextValue {
  showToast: (input: ToastInput) => string
  dismissToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within a ToastProvider.')
  return context
}

const TONE_ICON = {
  neutral: Info,
  success: Check,
  warning: AlertTriangle,
  danger: AlertTriangle,
} as const

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  // A counter rather than crypto.randomUUID(): older Android WebViews do not
  // reliably expose it, and these ids never leave the process.
  const nextId = useRef(0)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const showToast = useCallback(
    (input: ToastInput) => {
      nextId.current += 1
      const id = `toast-${nextId.current}`
      setToasts((current) => [...current, { ...input, id, tone: input.tone ?? 'neutral' }])

      const duration = input.duration === undefined ? 6000 : input.duration
      if (duration !== null) {
        timers.current.set(
          id,
          setTimeout(() => dismissToast(id), duration),
        )
      }
      return id
    },
    [dismissToast],
  )

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="rsk-toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => {
          const Icon = TONE_ICON[toast.tone]
          return (
            <div
              key={toast.id}
              className={cx('rsk-toast', `rsk-toast--${toast.tone}`)}
              role={toast.tone === 'danger' ? 'alert' : 'status'}
            >
              <Icon className="rsk-toast__icon" size={16} aria-hidden="true" />
              <div className="rsk-toast__text">
                <p className="rsk-toast__title">{toast.title}</p>
                {toast.description ? (
                  <p className="rsk-toast__description">{toast.description}</p>
                ) : null}
                {toast.action ? (
                  <Button
                    size="sm"
                    variant="primary"
                    className="rsk-toast__action"
                    onClick={() => {
                      dismissToast(toast.id)
                      toast.action?.onClick()
                    }}
                  >
                    {toast.action.label}
                  </Button>
                ) : null}
              </div>
              {toast.isDismissible === false ? null : (
                <button
                  type="button"
                  className="rsk-icon-btn rsk-icon-btn--sm"
                  onClick={() => dismissToast(toast.id)}
                  aria-label="Dismiss"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
