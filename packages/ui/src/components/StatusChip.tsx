import type { ReactNode } from 'react'

import { cx } from '../utils/cx.js'

/**
 * Tones are limited to what docs/brand.md defines. There is no accent colour and
 * no "info" hue: anything neutral reads as neutral. Only `success` gets a filled
 * background, because the green tint is the one fill the palette provides —
 * warning and danger are outlined so black and colour stay text-and-icon only.
 */
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'muted'

export interface StatusChipProps {
  tone?: StatusTone
  children: ReactNode
  className?: string
}

export function StatusChip({ tone = 'neutral', children, className }: StatusChipProps) {
  return <span className={cx('rsk-chip', `rsk-chip--${tone}`, className)}>{children}</span>
}
