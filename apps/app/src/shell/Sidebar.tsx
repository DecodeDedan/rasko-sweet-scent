import { cx } from '@rasko/ui'

import { BrandMark } from './BrandMark.js'
import type { ModuleDefinition, ModuleId } from './navigation.js'

export interface SidebarProps {
  modules: readonly ModuleDefinition[]
  activeId: ModuleId
  onSelect: (id: ModuleId) => void
}

/**
 * How the sidebar groups modules: by the job they do on the farm. A
 * presentation concern only, so it lives here rather than in navigation.ts,
 * which stays a transcription of the PRD §3.1 matrix.
 */
const GROUPS: ReadonlyArray<{ label: string; ids: readonly ModuleId[] }> = [
  { label: 'Sell', ids: ['dashboard', 'clients', 'orders', 'invoices'] },
  { label: 'Stock and supply', ids: ['products', 'suppliers'] },
  { label: 'People', ids: ['payroll'] },
  { label: 'Administration', ids: ['settings', 'users', 'audit'] },
]

/**
 * Desktop navigation. Lists only the modules the role can reach (PRD §3.1);
 * a group with nothing in it for this role is not drawn at all.
 */
export function Sidebar({ modules, activeId, onSelect }: SidebarProps) {
  const byId = new Map(modules.map((module) => [module.id, module]))

  return (
    <aside className="shell__sidebar">
      <div className="shell__brand">
        <BrandMark height={40} isReversed />
        <p className="shell__brand-name">Rasko Sweet Scent</p>
      </div>

      <nav className="shell__nav" aria-label="Modules">
        {GROUPS.map((group) => {
          const items = group.ids.flatMap((id) => {
            const module = byId.get(id)
            return module ? [module] : []
          })
          if (items.length === 0) return null
          return (
            <div key={group.label} className="shell__nav-group">
              <p className="shell__nav-heading">{group.label}</p>
              {items.map((module) => {
                const Icon = module.icon
                const isActive = module.id === activeId
                return (
                  <button
                    key={module.id}
                    type="button"
                    data-tour={`nav-${module.id}`}
                    className={cx('shell__nav-item', isActive && 'shell__nav-item--active')}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => onSelect(module.id)}
                  >
                    <Icon className="shell__nav-icon" size={18} aria-hidden="true" />
                    <span>{module.label}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>

      <div className="shell__sidebar-foot">
        <p className="shell__sidebar-slogan">All that nature gives.</p>
        <p className="shell__sidebar-version">Version {__APP_VERSION__}</p>
      </div>
    </aside>
  )
}
