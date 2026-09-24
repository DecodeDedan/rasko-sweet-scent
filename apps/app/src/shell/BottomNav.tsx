'use client'

import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { Drawer, cx } from '@rasko/ui'

import type { ModuleDefinition, ModuleId } from './navigation.js'

export interface BottomNavProps {
  modules: readonly ModuleDefinition[]
  activeId: ModuleId
  onSelect: (id: ModuleId) => void
}

/** Four tabs fit comfortably on a phone; anything further goes behind "More". */
const VISIBLE_LIMIT = 4

export function BottomNav({ modules, activeId, onSelect }: BottomNavProps) {
  const [isMoreOpen, setIsMoreOpen] = useState(false)

  const needsMore = modules.length > VISIBLE_LIMIT + 1
  const visible = needsMore ? modules.slice(0, VISIBLE_LIMIT) : modules
  const overflow = needsMore ? modules.slice(VISIBLE_LIMIT) : []
  const isOverflowActive = overflow.some((module) => module.id === activeId)

  function select(id: ModuleId) {
    onSelect(id)
    setIsMoreOpen(false)
  }

  return (
    <>
      <nav className="shell__bottom-nav" aria-label="Modules">
        {visible.map((module) => {
          const Icon = module.icon
          return (
            <button
              key={module.id}
              data-tour={`nav-${module.id}`}
              type="button"
              className={cx(
                'shell__bottom-item',
                module.id === activeId && 'shell__bottom-item--active',
              )}
              aria-current={module.id === activeId ? 'page' : undefined}
              onClick={() => select(module.id)}
            >
              <Icon size={19} aria-hidden="true" />
              <span>{module.label}</span>
            </button>
          )
        })}

        {overflow.length > 0 ? (
          <button
            type="button"
            className={cx('shell__bottom-item', isOverflowActive && 'shell__bottom-item--active')}
            onClick={() => setIsMoreOpen(true)}
            aria-haspopup="dialog"
          >
            <MoreHorizontal size={19} aria-hidden="true" />
            <span>More</span>
          </button>
        ) : null}
      </nav>

      <Drawer
        isOpen={isMoreOpen}
        onClose={() => setIsMoreOpen(false)}
        title="All modules"
        side="bottom"
      >
        <div className="shell__more-list">
          {modules.map((module) => {
            const Icon = module.icon
            return (
              <button
                key={module.id}
                data-tour={`nav-${module.id}`}
                type="button"
                className={cx(
                  'shell__nav-item',
                  module.id === activeId && 'shell__nav-item--active',
                )}
                onClick={() => select(module.id)}
              >
                <Icon className="shell__nav-icon" size={17} aria-hidden="true" />
                <span>{module.label}</span>
              </button>
            )
          })}
        </div>
      </Drawer>
    </>
  )
}
