import type { Role } from '../../auth/session.js'

export type AccountKind = 'cash' | 'mpesa' | 'bank' | 'wallet'
export type EntryDirection = 'in' | 'out' | 'transfer'

export const ACCOUNT_KINDS: readonly AccountKind[] = ['cash', 'mpesa', 'bank', 'wallet']

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  cash: 'Cash',
  mpesa: 'M-Pesa',
  bank: 'Bank',
  wallet: 'Payout wallet',
}

export const DIRECTION_LABEL: Record<EntryDirection, string> = {
  in: 'Money in',
  out: 'Money out',
  transfer: 'Transfer',
}

export interface MoneyAccount {
  id: string
  name: string
  kind: AccountKind
  currency: string
  opening_balance_cents: number
  opening_date: string
  is_default: boolean
  details: string | null
}

export interface MoneyAccountBalance extends MoneyAccount {
  money_in_cents: number
  money_out_cents: number
  balance_cents: number
}

export interface LedgerCategory {
  id: string
  name: string
  direction: 'in' | 'out'
  position: number
  is_active: boolean
}

export interface LedgerEntry {
  id: string
  entry_date: string
  direction: EntryDirection
  account_id: string
  to_account_id: string | null
  category_id: string | null
  amount_cents: number
  currency: string
  party: string | null
  reference: string | null
  description: string
}

/** Where a cash-book line came from. Only `ledger` lines are edited here. */
export type CashSource =
  'payment' | 'reversal' | 'supplier_payment' | 'salary' | 'casual_labour' | 'payout_fee' | 'ledger'

export const CASH_SOURCE_LABEL: Record<CashSource, string> = {
  payment: 'Client payment',
  reversal: 'Payment reversal',
  supplier_payment: 'Supplier payment',
  salary: 'Salary',
  casual_labour: 'Casual labour',
  payout_fee: 'Payout fee',
  ledger: 'Ledger entry',
}

/**
 * One movement of money, from whichever module recorded it. `amount_cents` is
 * signed: positive into the account, negative out of it. `account_id` is null
 * when no default account exists for the payment's method and currency.
 */
export interface CashLine {
  id: string
  source: CashSource
  source_id: string
  entry_date: string
  currency: string
  account_id: string | null
  amount_cents: number
  party: string | null
  reference: string | null
  description: string
  category: string
}

export interface CashBookLine extends CashLine {
  balance_cents: number
}

export interface CashBook {
  account: MoneyAccount | null
  currency: string
  opening_cents: number
  closing_cents: number
  lines: CashBookLine[]
}

export interface CategoryTotal {
  category: string
  amount_cents: number
}

/** Income and expenditure for a period, in one currency (never mixed). */
export interface IncomeStatement {
  currency: string
  income: CategoryTotal[]
  expenditure: CategoryTotal[]
  total_income_cents: number
  total_expenditure_cents: number
  net_cents: number
}

export interface DateRange {
  from: string
  to: string
}

export interface NewLedgerEntry {
  id: string
  entryDate: string
  direction: EntryDirection
  accountId: string
  toAccountId?: string | null
  categoryId?: string | null
  amountCents: number
  party?: string | null
  reference?: string | null
  description: string
}

export interface MoneyAccountInput {
  id: string
  name: string
  kind: AccountKind
  currency: string
  openingBalanceCents: number
  openingDate: string
  isDefault: boolean
  details?: string | null
}

/** Mirrors the ledger RLS: finance roles see it and record entries. */
export function canSeeLedger(role: Role): boolean {
  return role === 'owner' || role === 'manager' || role === 'accountant'
}

export function canRecordLedger(role: Role): boolean {
  return canSeeLedger(role)
}

/** Owner and accountant correct or delete an entry, and manage categories. */
export function canCorrectLedger(role: Role): boolean {
  return role === 'owner' || role === 'accountant'
}

/** Accounts and their opening balances are the owner's. */
export function canManageAccounts(role: Role): boolean {
  return role === 'owner'
}
