import {
  ClipboardList,
  FileText,
  LayoutDashboard,
  Package,
  ScrollText,
  Settings,
  Truck,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { Role } from '../auth/session.js'

export type ModuleId =
  | 'dashboard'
  | 'clients'
  | 'orders'
  | 'invoices'
  | 'products'
  | 'suppliers'
  | 'payroll'
  | 'settings'
  | 'users'
  | 'audit'

export interface ModuleAccess {
  canAccess: boolean
  /** The PRD §3.1 cell for this role, shown in the UI where the scope is narrowed. */
  scope: string
}

export interface ModuleDefinition {
  id: ModuleId
  label: string
  icon: LucideIcon
  /** The PRD capability row this module implements. */
  capability: string
  access: Record<Role, ModuleAccess>
}

const all = (scope = 'All'): ModuleAccess => ({ canAccess: true, scope })
const none = (): ModuleAccess => ({ canAccess: false, scope: 'No access' })

/**
 * Transcribed cell by cell from the PRD §3.1 permission matrix. When that table
 * changes, change this and nothing else.
 *
 * Hiding a module here is a usability decision, not a security one: the server
 * refuses the data regardless of what the navigation shows.
 */
export const MODULES: readonly ModuleDefinition[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    capability: 'Dashboard & full reports',
    access: {
      owner: all('Full'),
      manager: all('Full'),
      accountant: all('Financial only'),
      sales: all('Own performance only'),
    },
  },
  {
    id: 'clients',
    label: 'Clients',
    icon: Users,
    capability: 'Clients',
    access: {
      owner: all(),
      manager: all(),
      accountant: all(),
      sales: all('Own clients only'),
    },
  },
  {
    id: 'orders',
    label: 'Orders',
    icon: ClipboardList,
    capability: 'Orders',
    access: {
      owner: all(),
      manager: all(),
      accountant: all('View all'),
      sales: all('Create, no delete'),
    },
  },
  {
    id: 'invoices',
    label: 'Invoices',
    icon: FileText,
    capability: 'Invoices & payments',
    access: {
      owner: all(),
      manager: all(),
      accountant: all('Create/edit'),
      sales: all('Create invoice, record payment'),
    },
  },
  {
    id: 'products',
    label: 'Products',
    icon: Package,
    capability: 'Products & inventory',
    access: {
      owner: all(),
      manager: all(),
      accountant: all('View'),
      sales: all('View'),
    },
  },
  {
    id: 'suppliers',
    label: 'Suppliers',
    icon: Truck,
    capability: 'Suppliers & purchases',
    access: {
      owner: all(),
      manager: all(),
      accountant: all('View'),
      sales: none(),
    },
  },
  {
    id: 'payroll',
    label: 'Payroll',
    icon: Wallet,
    capability: 'Payroll',
    access: {
      owner: all('Full'),
      manager: all('View only'),
      accountant: all('Prepare only'),
      sales: none(),
    },
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    capability: 'Users & settings',
    access: {
      owner: all('Full'),
      manager: all('Limited'),
      accountant: none(),
      sales: none(),
    },
  },
  {
    // FR-1.4: user management is owner-only, so it is split out of the broader
    // "Users & settings" matrix row where the manager has Limited access.
    id: 'users',
    label: 'Users',
    icon: UserCog,
    capability: 'Users & settings',
    access: {
      owner: all('Full'),
      manager: none(),
      accountant: none(),
      sales: none(),
    },
  },
  {
    id: 'audit',
    label: 'Audit log',
    icon: ScrollText,
    capability: 'Audit log',
    access: {
      owner: all('Full'),
      manager: all('View'),
      accountant: none(),
      sales: none(),
    },
  },
]

export function modulesForRole(role: Role): ModuleDefinition[] {
  return MODULES.filter((module) => module.access[role].canAccess)
}

export function findModule(id: ModuleId): ModuleDefinition {
  const found = MODULES.find((module) => module.id === id)
  if (!found) throw new Error(`Unknown module: ${id}`)
  return found
}

export function scopeForRole(id: ModuleId, role: Role): string {
  return findModule(id).access[role].scope
}
