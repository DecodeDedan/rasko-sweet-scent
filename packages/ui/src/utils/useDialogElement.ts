'use client'

import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Drives a native <dialog> from React state.
 *
 * Native <dialog> is used rather than a hand-rolled overlay because it provides
 * focus trapping, background inerting, Esc-to-dismiss and the top layer for
 * free — all things a custom implementation tends to get subtly wrong.
 */
export function useDialogElement(
  isOpen: boolean,
  onClose: () => void,
): RefObject<HTMLDialogElement> {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    if (isOpen && !dialog.open) dialog.showModal()
    else if (!isOpen && dialog.open) dialog.close()
  }, [isOpen])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    // Esc fires `cancel`; intercept so React state stays the single source of truth.
    function handleCancel(event: Event) {
      event.preventDefault()
      onClose()
    }

    // A click landing on the dialog element itself is a backdrop click — the
    // content sits in a child element, so it never reports as the target.
    function handleClick(event: MouseEvent) {
      if (event.target === dialog) onClose()
    }

    dialog.addEventListener('cancel', handleCancel)
    dialog.addEventListener('click', handleClick)
    return () => {
      dialog.removeEventListener('cancel', handleCancel)
      dialog.removeEventListener('click', handleClick)
    }
  }, [onClose])

  return ref
}
