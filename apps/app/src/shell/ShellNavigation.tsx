'use client'

import { createContext, useContext } from 'react'

import type { ModuleId } from './navigation.js'

/**
 * Lets a screen send the user to another module, e.g. the dashboard's setup
 * list opening Settings. AppShell owns the active module; this only exposes
 * the setter. Navigation still respects the role: AppShell ignores a module
 * the role cannot reach.
 */
export const ShellNavigationContext = createContext<(id: ModuleId) => void>(() => undefined)

export function useShellNavigate(): (id: ModuleId) => void {
  return useContext(ShellNavigationContext)
}
