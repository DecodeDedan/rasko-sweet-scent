import type { Role } from '../auth/session.js'
import type { SqlDatabase } from '../data/sqlite/types.js'
import type { ModuleId } from '../shell/navigation.js'

/**
 * The setup list on the dashboard. Every item is derived from the records on
 * this device each time it is drawn, never stored as "done": adding the first
 * product ticks it, and deleting the last one unticks it. A stored checklist
 * would be a second source of truth that drifts (CLAUDE.md: the dashboard
 * stores nothing).
 */

export interface SetupFacts {
  hasCompanyDetails: boolean
  hasPaymentDetails: boolean
  categoryCount: number
  productCount: number
  clientCount: number
  activeUserCount: number
}

export interface SetupItem {
  id: string
  label: string
  detail: string
  isDone: boolean
  module: ModuleId
  action: string
}

export function setupItems(facts: SetupFacts, role: Role): SetupItem[] {
  const items: SetupItem[] = [
    {
      id: 'company',
      label: 'Add your company details',
      detail: 'The address and phone number printed on every invoice, receipt and email.',
      isDone: facts.hasCompanyDetails,
      module: 'settings',
      action: 'Open settings',
    },
    {
      id: 'payment',
      label: 'Add how clients pay you',
      detail: 'Your M-Pesa paybill or till, or bank details, shown on invoices and invoice emails.',
      isDone: facts.hasPaymentDetails,
      module: 'settings',
      action: 'Open settings',
    },
    // The four varieties arrive with the database (migration 20260926000100),
    // so there is no "create a variety" step; a device that has not synced yet
    // still shows it, because an empty list really does block adding products.
    ...(facts.categoryCount > 0
      ? []
      : [
          {
            id: 'category',
            label: 'Sync your varieties',
            detail:
              'Connect once so Baby Blue, Gunni, Parvifolia and Globulus arrive on this device.',
            isDone: false,
            module: 'products' as const,
            action: 'Open products',
          },
        ]),
    {
      id: 'product',
      label: 'Add your first product',
      detail: 'A variety as standard or spray, with its own price and low-stock level.',
      isDone: facts.productCount > 0,
      module: 'products',
      action: 'Open products',
    },
    {
      id: 'client',
      label: 'Add your first client',
      detail: 'A florist, decorator or wholesaler you supply.',
      isDone: facts.clientCount > 0,
      module: 'clients',
      action: 'Open clients',
    },
  ]
  // Only the owner manages users (FR-1.4), so only the owner is asked to.
  if (role === 'owner') {
    items.push({
      id: 'team',
      label: 'Invite your team',
      detail: 'Each person signs in with their own account and sees what their role allows.',
      isDone: facts.activeUserCount > 1,
      module: 'users',
      action: 'Open users',
    })
  }
  return items
}

/** Reads the facts from the local mirror in one round of small counts. */
export async function readSetupFacts(db: SqlDatabase): Promise<SetupFacts> {
  const [company] = await db.select<Record<string, unknown>>(
    `SELECT address, phone, mpesa_paybill, mpesa_till, bank_details
       FROM company_settings WHERE deleted_at IS NULL LIMIT 1`,
  )
  const count = async (table: string, extra = '') => {
    const [row] = await db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NULL ${extra}`,
    )
    return Number(row?.n ?? 0)
  }

  const bank = parseBank(company?.['bank_details'])
  return {
    hasCompanyDetails: Boolean(company?.['address'] && company?.['phone']),
    hasPaymentDetails: Boolean(
      company?.['mpesa_paybill'] ||
      company?.['mpesa_till'] ||
      Object.values(bank).some((value) => String(value ?? '').trim()),
    ),
    categoryCount: await count('categories'),
    productCount: await count('products'),
    clientCount: await count('clients'),
    activeUserCount: await count('profiles', 'AND is_active = 1'),
  }
}

function parseBank(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
