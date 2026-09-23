'use client'

import { useCallback, useMemo, useState } from 'react'

import { useIdentity } from '../../auth/AuthProvider.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { useSyncedEffect } from '../../data/sync/useSyncedEffect.js'
import { PayrollRepository } from './payrollRepository.js'
import type { Advance, Employee, PayrollRun } from './types.js'

export function usePayrollRepository(): PayrollRepository | null {
  const { db, notifyLocalWrite } = useSync()
  const identity = useIdentity()

  return useMemo(() => {
    if (!db) return null
    return new PayrollRepository(db, identity.role, identity.userId, {
      userId: identity.userId,
      onLocalWrite: notifyLocalWrite,
    })
  }, [db, identity.role, identity.userId, notifyLocalWrite])
}

export function usePayrollData() {
  const repo = usePayrollRepository()
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [advances, setAdvances] = useState<Advance[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!repo) {
      setIsLoading(false)
      return
    }
    try {
      setError(null)
      const [runRows, employeeRows, advanceRows] = await Promise.all([
        repo.listRuns(),
        repo.listEmployees({ includeInactive: true }),
        repo.listAdvances(),
      ])
      setRuns(runRows)
      setEmployees(employeeRows)
      setAdvances(advanceRows)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read payroll.')
    } finally {
      setIsLoading(false)
    }
  }, [repo])

  useSyncedEffect(load)

  return { runs, employees, advances, isLoading, error, reload: load }
}
