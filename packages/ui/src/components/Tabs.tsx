'use client'

import { useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import { cx } from '../utils/cx.js'

export interface TabItem {
  id: string
  label: string
  /** A count, typically. Never an emoji. */
  badge?: ReactNode
}

export interface TabsProps {
  items: readonly TabItem[]
  activeId: string
  onChange: (id: string) => void
  className?: string
  'aria-label'?: string
}

export function Tabs({ items, activeId, onChange, className, ...rest }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Arrow-key roving focus, per the WAI-ARIA tabs pattern.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = items.findIndex((item) => item.id === activeId)
    if (currentIndex < 0) return

    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % items.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + items.length) % items.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = items.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const next = items[nextIndex]
    if (!next) return
    onChange(next.id)
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus()
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={rest['aria-label'] ?? 'Sections'}
      className={cx('rsk-tabs', className)}
      onKeyDown={handleKeyDown}
    >
      {items.map((item) => {
        const isActive = item.id === activeId
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={isActive}
            aria-controls={`panel-${item.id}`}
            tabIndex={isActive ? 0 : -1}
            className={cx('rsk-tabs__tab', isActive && 'rsk-tabs__tab--active')}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {item.badge === undefined ? null : (
              <span className="rsk-tabs__badge">{item.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export interface TabPanelProps {
  id: string
  activeId: string
  children: ReactNode
  className?: string
}

export function TabPanel({ id, activeId, children, className }: TabPanelProps) {
  if (id !== activeId) return null
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className={className}>
      {children}
    </div>
  )
}
