'use client'

import { WifiOff } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ComponentType } from 'react'

import { useAuth } from '../auth/AuthProvider.js'
import { ModuleGuard } from '../auth/guards.js'
import {
  AuditLogScreen,
  ClientsScreen,
  DashboardScreen,
  InvoicesScreen,
  OrdersScreen,
  PayrollScreen,
  ProductsScreen,
  SettingsScreen,
  SuppliersScreen,
  UsersScreen,
} from '../screens/index.js'
import type { ScreenProps } from '../screens/index.js'
import { BottomNav } from './BottomNav.js'
import { Sidebar } from './Sidebar.js'
import { TopBar } from './TopBar.js'
import { findModule, modulesForRole } from './navigation.js'
import type { ModuleId } from './navigation.js'

const SCREENS: Record<ModuleId, ComponentType<ScreenProps>> = {
  dashboard: DashboardScreen,
  clients: ClientsScreen,
  orders: OrdersScreen,
  invoices: InvoicesScreen,
  products: ProductsScreen,
  suppliers: SuppliersScreen,
  payroll: PayrollScreen,
  settings: SettingsScreen,
  users: UsersScreen,
  audit: AuditLogScreen,
}

/** Only reached when signed in — App gates on auth status before rendering it. */
export function AppShell() {
  const { identity, isOffline } = useAuth()
  const [activeId, setActiveId] = useState<ModuleId>('dashboard')

  if (!identity) throw new Error('AppShell rendered without an identity.')
  const role = identity.role

  const modules = useMemo(() => modulesForRole(role), [role])

  const activeModule = findModule(activeId)
  const Screen = SCREENS[activeId]

  return (
    <div className="shell">
      <Sidebar modules={modules} activeId={activeId} onSelect={setActiveId} />

      <div className="shell__main">
        <TopBar title={activeModule.label} />

        {isOffline ? (
          <p className="shell__offline-notice">
            <WifiOff size={13} aria-hidden="true" />
            Offline. Showing the last data this device synced; changes are saved locally.
          </p>
        ) : null}

        <main className="shell__content">
          <div className="shell__container">
            {/*
              Navigation already hides what this role cannot reach, so the guard
              fires only when hiding was not enough — a role changed while the
              screen was open. It renders a clear refusal rather than silently
              redirecting, which would leave the user wondering what happened.
            */}
            <ModuleGuard moduleId={activeId} role={role}>
              <Screen role={role} scope={activeModule.access[role].scope} />
            </ModuleGuard>
          </div>
        </main>
      </div>

      <BottomNav modules={modules} activeId={activeId} onSelect={setActiveId} />
    </div>
  )
}
