import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

/**
 * jsdom does not implement the <dialog> top layer, so showModal and close are
 * missing. Modal and Drawer drive a real <dialog>, so without this shim any
 * screen containing one throws on render.
 */
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false
    }
  }
}

/** navigator.onLine is read-only in jsdom; tests need to drive it. */
export function setOnline(isOnline: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => isOnline,
  })
}

beforeEach(() => {
  setOnline(true)
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
