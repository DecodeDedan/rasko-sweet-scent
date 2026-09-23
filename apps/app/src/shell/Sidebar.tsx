import { cx } from '@rasko/ui'

import type { ModuleDefinition, ModuleId } from './navigation.js'

export interface SidebarProps {
  modules: readonly ModuleDefinition[]
  activeId: ModuleId
  onSelect: (id: ModuleId) => void
}

/**
 * Desktop navigation. Lists only the modules the role can reach (PRD §3.1).
 * How much of a module the role sees is stated on each screen's header rather
 * than here — the scope phrases are sentences, not labels.
 */
export function Sidebar({ modules, activeId, onSelect }: SidebarProps) {
  return (
    <aside className="shell__sidebar">
      <div className="shell__brand">
        {/* Placeholder monogram, matching docs/brand/logo.svg. */}
        <span className="shell__brand-mark" aria-hidden="true">
          RSS
        </span>
        <div>
          <p className="shell__brand-name">Rasko Sweet Scent</p>
          <p className="shell__brand-sub">Nakuru</p>
        </div>
      </div>

      <nav className="shell__nav" aria-label="Modules">
        {modules.map((module) => {
          const Icon = module.icon
          return (
            <button
              key={module.id}
              type="button"
              className={cx('shell__nav-item', module.id === activeId && 'shell__nav-item--active')}
              aria-current={module.id === activeId ? 'page' : undefined}
              onClick={() => onSelect(module.id)}
            >
              <Icon className="shell__nav-icon" size={17} aria-hidden="true" />
              <span>{module.label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
