import { beforeEach, describe, expect, it } from 'vitest'

import { openNodeDatabase } from '../../../data/sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../../../data/sqlite/schema.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { LedgerRepository, LedgerRuleError } from '../ledgerRepository.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const TS = '2026-10-01T00:00:00.000Z'

const ACCOUNT = {
  cash: 'ac000000-0000-4000-8000-000000000001',
  mpesa: 'ac000000-0000-4000-8000-000000000002',
  bank: 'ac000000-0000-4000-8000-000000000003',
} as const
const CATEGORY = {
  fuel: 'lc000000-0000-4000-8000-000000000001',
  capital: 'lc000000-0000-4000-8000-000000000002',
} as const
const CLIENT = 'c0000000-0000-4000-8000-000000000001'
const INVOICE_KES = 'i0000000-0000-4000-8000-000000000001'
const INVOICE_USD = 'i0000000-0000-4000-8000-000000000002'

async function seeded(): Promise<SqlDatabase> {
  const db = openNodeDatabase()
  await migrateLocalSchema(db)

  const account = (id: string, name: string, kind: string, opening: number, date: string) =>
    db.execute(
      `INSERT INTO money_accounts (id, name, kind, currency, opening_balance_cents, opening_date,
                                   is_default, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, 'KES', ?, ?, 1, ?, ?, 'synced')`,
      [id, name, kind, opening, date, TS, TS],
    )
  await account(ACCOUNT.cash, 'Cash on hand', 'cash', 500_000, '2026-11-01')
  await account(ACCOUNT.mpesa, 'M-Pesa', 'mpesa', 0, '2026-11-01')
  await account(ACCOUNT.bank, 'Bank', 'bank', 0, '2026-11-01')

  const category = (id: string, name: string, direction: string) =>
    db.execute(
      `INSERT INTO ledger_categories (id, name, direction, position, is_active,
                                      created_at, updated_at, sync_status)
       VALUES (?, ?, ?, 1, 1, ?, ?, 'synced')`,
      [id, name, direction, TS, TS],
    )
  await category(CATEGORY.fuel, 'Transport and fuel', 'out')
  await category(CATEGORY.capital, 'Owner capital', 'in')

  await db.execute(
    `INSERT INTO clients (id, name, client_type, created_at, updated_at, sync_status)
     VALUES (?, 'Kabuku Packhouse', 'corporate', ?, ?, 'synced')`,
    [CLIENT, TS, TS],
  )
  const invoice = (id: string, number: string, currency: string) =>
    db.execute(
      `INSERT INTO invoices (id, invoice_number, client_id, status, total_cents, currency,
                             created_at, updated_at, sync_status)
       VALUES (?, ?, ?, 'issued', 10000000, ?, ?, ?, 'synced')`,
      [id, number, CLIENT, currency, TS, TS],
    )
  await invoice(INVOICE_KES, 'INV-2026-0001', 'KES')
  await invoice(INVOICE_USD, 'INV-2026-0002', 'USD')

  const payment = (id: string, invoiceId: string, amount: number, method: string, at: string) =>
    db.execute(
      `INSERT INTO payments (id, invoice_id, amount_cents, method, reference, paid_at,
                             created_at, sync_status)
       VALUES (?, ?, ?, ?, 'REF', ?, ?, 'synced')`,
      [id, invoiceId, amount, method, at, at],
    )
  // 23:30 UTC on 1 Nov is 02:30 on 2 Nov in Nairobi.
  await payment('p1', INVOICE_KES, 2_000_000, 'mpesa', '2026-11-01T23:30:00.000Z')
  await payment('p2', INVOICE_USD, 50_000, 'bank_transfer', '2026-11-03T08:00:00.000Z')
  // Before the M-Pesa account's opening date: already inside its opening balance.
  await payment('p0', INVOICE_KES, 999_900, 'mpesa', '2026-10-20T08:00:00.000Z')
  await db.execute(
    `INSERT INTO reversals (id, payment_id, amount_cents, reason, reversed_at, created_at, sync_status)
     VALUES ('r1', 'p1', 200000, 'Duplicate entry', '2026-11-04T08:00:00.000Z', ?, 'synced')`,
    [TS],
  )

  await db.execute(
    `INSERT INTO employees (id, full_name, salary_type, created_at, updated_at, sync_status)
     VALUES ('e1', 'Mary Wanjiru', 'casual', ?, ?, 'synced')`,
    [TS, TS],
  )
  // 1,200 stems (stored as thousandths) at KES 2.50 a stem.
  await db.execute(
    `INSERT INTO casual_work_entries (id, employee_id, work_date, work_type, unit, quantity,
                                      rate_cents, paid_at, payment_method, payment_reference,
                                      created_at, updated_at, sync_status)
     VALUES ('w1', 'e1', '2026-11-05', 'Harvesting', 'stem', 1200000, 250,
             '2026-11-05T15:00:00.000Z', 'mpesa', 'QX1', ?, ?, 'synced')`,
    [TS, TS],
  )
  return db
}

describe('ledger', () => {
  let db: SqlDatabase
  let repo: LedgerRepository

  beforeEach(async () => {
    db = await seeded()
    repo = new LedgerRepository(db, 'owner', { userId: OWNER })
  })

  it('builds a running cash book from payments, reversals, labour and typed entries', async () => {
    await repo.recordEntry({
      id: 'le1',
      entryDate: '2026-11-06',
      direction: 'out',
      accountId: ACCOUNT.mpesa,
      categoryId: CATEGORY.fuel,
      amountCents: 150_000,
      description: 'Diesel for the pickup',
    })
    await repo.recordEntry({
      id: 'le2',
      entryDate: '2026-11-07',
      direction: 'transfer',
      accountId: ACCOUNT.mpesa,
      toAccountId: ACCOUNT.bank,
      amountCents: 1_000_000,
      description: 'Sweep to bank',
    })

    const book = await repo.cashBook(ACCOUNT.mpesa, { from: '2026-11-01', to: '2026-11-30' })

    expect(book.opening_cents).toBe(0)
    expect(
      book.lines.map((line) => [line.entry_date, line.amount_cents, line.balance_cents]),
    ).toEqual([
      ['2026-11-02', 2_000_000, 2_000_000],
      ['2026-11-04', -200_000, 1_800_000],
      ['2026-11-05', -300_000, 1_500_000],
      ['2026-11-06', -150_000, 1_350_000],
      ['2026-11-07', -1_000_000, 350_000],
    ])
    expect(book.closing_cents).toBe(350_000)
  })

  it('carries the period opening balance and ignores lines before the account opened', async () => {
    const book = await repo.cashBook(ACCOUNT.mpesa, { from: '2026-11-05', to: '2026-11-30' })
    expect(book.opening_cents).toBe(1_800_000)
    expect(book.lines).toHaveLength(1)

    const balances = await repo.accountBalances()
    const cash = balances.find((account) => account.id === ACCOUNT.cash)
    expect(cash?.balance_cents).toBe(500_000)
    expect(balances.find((account) => account.id === ACCOUNT.mpesa)?.balance_cents).toBe(1_500_000)
  })

  it('reports money in a currency no account holds instead of dropping it', async () => {
    expect(await repo.unassigned()).toEqual([{ currency: 'USD', count: 1, net_cents: 50_000 }])
  })

  it('never adds currencies in income and expenditure, and leaves transfers out', async () => {
    await repo.recordEntry({
      id: 'le3',
      entryDate: '2026-11-08',
      direction: 'in',
      accountId: ACCOUNT.cash,
      categoryId: CATEGORY.capital,
      amountCents: 4_000_000,
      description: 'Owner top-up',
    })
    await repo.recordEntry({
      id: 'le4',
      entryDate: '2026-11-08',
      direction: 'transfer',
      accountId: ACCOUNT.cash,
      toAccountId: ACCOUNT.bank,
      amountCents: 100_000,
      description: 'Banked',
    })

    const statements = await repo.incomeStatement({ from: '2026-11-01', to: '2026-11-30' })
    expect(statements.map((s) => s.currency)).toEqual(['KES', 'USD'])

    const kes = statements[0]!
    expect(kes.income).toEqual([
      { category: 'Owner capital', amount_cents: 4_000_000 },
      { category: 'Sales receipts', amount_cents: 1_800_000 },
    ])
    expect(kes.expenditure).toEqual([{ category: 'Casual labour', amount_cents: 300_000 }])
    expect(kes.net_cents).toBe(5_500_000)
  })

  it('refuses an entry whose category faces the other way', async () => {
    await expect(
      repo.recordEntry({
        id: 'bad',
        entryDate: '2026-11-08',
        direction: 'in',
        accountId: ACCOUNT.cash,
        categoryId: CATEGORY.fuel,
        amountCents: 100,
        description: 'Wrong way',
      }),
    ).rejects.toBeInstanceOf(LedgerRuleError)
  })

  it('keeps one default account per kind and currency', async () => {
    await repo.saveAccount({
      id: 'ac000000-0000-4000-8000-000000000009',
      name: 'Equity Bank',
      kind: 'bank',
      currency: 'KES',
      openingBalanceCents: 0,
      openingDate: '2026-11-01',
      isDefault: true,
    })
    const defaults = (await repo.listAccounts()).filter((a) => a.kind === 'bank' && a.is_default)
    expect(defaults.map((a) => a.name)).toEqual(['Equity Bank'])
  })

  it('takes an IntaSend salary and its charge out of the payout wallet, not M-Pesa', async () => {
    // As the sandbox paid it on 2026-11-24: KES 625 by M-Pesa, KES 10 charge.
    await db.execute(
      `INSERT INTO money_accounts (id, name, kind, currency, opening_balance_cents, opening_date,
                                   is_default, created_at, updated_at, sync_status)
       VALUES ('wallet', 'IntaSend wallet', 'wallet', 'KES', 0, '2026-11-01', 1, ?, ?, 'synced')`,
      [TS, TS],
    )
    await db.execute(
      `INSERT INTO payroll_runs (id, period_year, period_month, status, created_at, updated_at, sync_status)
       VALUES ('run', 2026, 11, 'approved', ?, ?, 'synced')`,
      [TS, TS],
    )
    await db.execute(
      `INSERT INTO payroll_items (id, payroll_run_id, employee_id, employee_snapshot, net_pay_cents,
                                  paid_at, payment_method, payment_reference, created_at, updated_at, sync_status)
       VALUES ('slip', 'run', 'e1', '{"full_name":"Mary Wanjiru"}', 62500,
               '2026-11-06T08:00:00.000Z', 'mpesa', 'SBX123', ?, ?, 'synced')`,
      [TS, TS],
    )
    await db.execute(
      `INSERT INTO payroll_payouts (id, payroll_run_id, payroll_item_id, employee_id, amount_cents,
                                    status, provider, channel, mpesa_receipt, recipient_name, fee_cents,
                                    settled_at, created_at, updated_at, sync_status)
       VALUES ('payout', 'run', 'slip', 'e1', 62500, 'paid', 'intasend', 'mpesa', 'SBX123',
               'Mary Wanjiru', 1000, '2026-11-06T08:00:00.000Z', ?, ?, 'synced')`,
      [TS, TS],
    )

    const balances = await repo.accountBalances('2026-11-30')
    expect(balances.find((a) => a.id === 'wallet')?.balance_cents).toBe(-63_500)
    // M-Pesa carries only its own movements, as before the payout.
    expect(balances.find((a) => a.id === ACCOUNT.mpesa)?.balance_cents).toBe(1_500_000)

    const [kes] = await repo.incomeStatement({ from: '2026-11-01', to: '2026-11-30' })
    expect(kes?.expenditure).toEqual(
      expect.arrayContaining([
        { category: 'Salaries', amount_cents: 62_500 },
        { category: 'Bank and M-Pesa charges', amount_cents: 1_000 },
      ]),
    )

    // IntaSend's statement: a KES 1,000 top-up the books lack, then the payout
    // as one debit of amount plus charge.
    const statement = (id: string, value: number, balance: number, narrative: string, at: string) =>
      db.execute(
        `INSERT INTO intasend_wallet_transactions (id, transaction_id, trans_type, value_cents,
           running_balance_cents, currency, narrative, status, occurred_at, created_at, updated_at,
           sync_status)
         VALUES (?, ?, ?, ?, ?, 'KES', ?, 'AVAILABLE', ?, ?, ?, 'synced')`,
        [id, id, value > 0 ? 'SALE' : 'PAYOUT', value, balance, narrative, at, TS, TS],
      )
    await statement('T1', 100_000, 100_000, 'Direct Bill', '2026-11-05T07:00:00.000Z')
    await statement('T2', -63_500, 36_500, 'Payout: #LQPLOOR', '2026-11-06T08:00:01.000Z')

    const wallet = await repo.walletReconciliation('2026-11-30')
    expect(wallet?.intasendBalanceCents).toBe(36_500)
    expect(wallet?.bookBalanceCents).toBe(-63_500)
    expect(wallet?.differenceCents).toBe(100_000)
    expect(wallet?.lines.map((line) => [line.transaction_id, line.match.kind])).toEqual([
      ['T1', 'not_in_books'],
      ['T2', 'matched'],
    ])
  })

  it('lets a manager record but not correct, and keeps sales out', async () => {
    const manager = new LedgerRepository(db, 'manager', { userId: OWNER })
    await expect(manager.removeEntry('x')).rejects.toThrow(/owner or accountant/)
    const sales = new LedgerRepository(db, 'sales', { userId: OWNER })
    await expect(sales.listAccounts()).rejects.toThrow(/cannot see/)
  })
})
