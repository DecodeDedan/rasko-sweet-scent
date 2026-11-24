import { Repository } from '../../data/repositories/repository.js'
import type { WriteContext } from '../../data/repositories/repository.js'
import type { SqlDatabase } from '../../data/sqlite/types.js'
import type { Role } from '../../auth/session.js'
import { canCorrectLedger, canManageAccounts, canRecordLedger, canSeeLedger } from './types.js'
import { reconcileWallet } from './reconcile.js'
import type { BookMovement, Reconciliation, StatementLine } from './reconcile.js'
import type {
  CashBook,
  CashLine,
  CashSource,
  CategoryTotal,
  DateRange,
  IncomeStatement,
  LedgerCategory,
  LedgerEntry,
  MoneyAccount,
  MoneyAccountBalance,
  MoneyAccountInput,
  NewLedgerEntry,
} from './types.js'

/**
 * The books: money accounts, the cash book and income and expenditure.
 *
 * ## Nothing here stores a balance
 *
 * Every figure is derived on read from the rows each module already writes
 * (payments, reversals, supplier payments, paid payslips, paid casual labour)
 * plus `ledger_entries` for everything else. A stored balance would be a
 * second source of truth that drifts on the next sync, the same rule that
 * keeps invoice balances (FR-5.4) and stock (FR-6.2) derived.
 *
 * ## Which account a payment lands in
 *
 * Payments carry a method, not an account, so a line from another module is
 * placed in the default account for its kind (cash / M-Pesa / bank) and
 * currency. With no such default it has no account and is reported as
 * unassigned rather than silently dropped.
 * ponytail: method-to-default mapping; add money_account_id to the payment
 * forms if the farm ever runs two bank accounts in one currency.
 */

export class LedgerRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LedgerRuleError'
  }
}

/** Africa/Nairobi is UTC+3 all year, so a stored UTC time maps to its local day. */
const LOCAL_DAY = (column: string): string => `date(${column}, '+3 hours')`

const KIND_OF_METHOD = (column: string): string =>
  `CASE ${column} WHEN 'cash' THEN 'cash' WHEN 'mpesa' THEN 'mpesa' ELSE 'bank' END`

/**
 * Every movement of money, one row each, signed into or out of an account.
 * Raw SELECTs bypass the codec, so quantities are still thousandths here.
 */
const CASH_LINES_SQL = `
  SELECT 'payment:' || p.id AS id, 'payment' AS source, p.id AS source_id,
         ${LOCAL_DAY('p.paid_at')} AS entry_date, p.paid_at AS sort_at,
         CASE WHEN i.id IS NULL THEN NULL ELSE COALESCE(i.currency, 'KES') END AS currency,
         ${KIND_OF_METHOD('p.method')} AS kind,
         NULL AS account_id, p.amount_cents AS amount_cents,
         COALESCE(c.name, json_extract(i.client_snapshot, '$.name')) AS party,
         p.reference AS reference,
         'Payment for ' || COALESCE(i.invoice_number, 'an invoice') AS description,
         'Sales receipts' AS category, 'in' AS flow
  FROM payments p
  LEFT JOIN invoices i ON i.id = p.invoice_id
  LEFT JOIN clients c ON c.id = i.client_id

  UNION ALL
  SELECT 'reversal:' || r.id, 'reversal', r.id,
         ${LOCAL_DAY('r.reversed_at')}, r.reversed_at,
         CASE WHEN i.id IS NULL THEN NULL ELSE COALESCE(i.currency, 'KES') END,
         ${KIND_OF_METHOD('p.method')},
         NULL, -r.amount_cents,
         COALESCE(c.name, json_extract(i.client_snapshot, '$.name')),
         p.reference,
         'Reversal: ' || COALESCE(r.reason, 'payment reversed'),
         'Sales receipts', 'in'
  FROM reversals r
  JOIN payments p ON p.id = r.payment_id
  LEFT JOIN invoices i ON i.id = p.invoice_id
  LEFT JOIN clients c ON c.id = i.client_id

  UNION ALL
  SELECT 'supplier_payment:' || sp.id, 'supplier_payment', sp.id,
         ${LOCAL_DAY('sp.paid_at')}, sp.paid_at,
         'KES', ${KIND_OF_METHOD('sp.method')},
         NULL, -sp.amount_cents,
         s.name, sp.reference,
         'Payment for ' || COALESCE(pu.purchase_number, 'a purchase'),
         'Supplier payments', 'out'
  FROM supplier_payments sp
  LEFT JOIN purchases pu ON pu.id = sp.purchase_id
  LEFT JOIN suppliers s ON s.id = pu.supplier_id

  UNION ALL
  SELECT 'salary:' || pi.id, 'salary', pi.id,
         ${LOCAL_DAY('pi.paid_at')}, pi.paid_at,
         'KES',
         -- Paid through IntaSend: the money left the IntaSend wallet.
         CASE WHEN po.provider = 'intasend' THEN 'wallet'
              ELSE ${KIND_OF_METHOD('pi.payment_method')} END,
         NULL, -pi.net_pay_cents,
         json_extract(pi.employee_snapshot, '$.full_name'), pi.payment_reference,
         'Salary ' || printf('%02d/%d', pr.period_month, pr.period_year),
         'Salaries', 'out'
  FROM payroll_items pi
  LEFT JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
  LEFT JOIN payroll_payouts po
    ON po.payroll_item_id = pi.id AND po.status = 'paid' AND po.deleted_at IS NULL
  WHERE pi.paid_at IS NOT NULL AND pi.deleted_at IS NULL

  UNION ALL
  SELECT 'payout-fee:' || po.id, 'payout_fee', po.id,
         ${LOCAL_DAY('po.settled_at')}, po.settled_at,
         'KES', CASE WHEN po.provider = 'intasend' THEN 'wallet' ELSE 'mpesa' END,
         NULL, -po.fee_cents,
         po.recipient_name, po.mpesa_receipt,
         'Payout charge, ' || COALESCE(json_extract(pi.employee_snapshot, '$.full_name'), 'salary'),
         'Bank and M-Pesa charges', 'out'
  FROM payroll_payouts po
  LEFT JOIN payroll_items pi ON pi.id = po.payroll_item_id
  WHERE po.status = 'paid' AND po.fee_cents > 0 AND po.deleted_at IS NULL

  UNION ALL
  SELECT 'casual:' || w.id, 'casual_labour', w.id,
         ${LOCAL_DAY('w.paid_at')}, w.paid_at,
         'KES', ${KIND_OF_METHOD('w.payment_method')},
         NULL, -CAST(ROUND(w.quantity * w.rate_cents / 1000.0) AS INTEGER),
         e.full_name, w.payment_reference,
         'Casual labour: ' || w.work_type,
         'Casual labour', 'out'
  FROM casual_work_entries w
  LEFT JOIN employees e ON e.id = w.employee_id
  WHERE w.paid_at IS NOT NULL AND w.deleted_at IS NULL

  UNION ALL
  SELECT 'ledger:' || le.id, 'ledger', le.id,
         le.entry_date, le.created_at,
         le.currency, NULL,
         le.account_id,
         CASE le.direction WHEN 'in' THEN le.amount_cents ELSE -le.amount_cents END,
         le.party, le.reference, le.description,
         COALESCE(lc.name, 'Uncategorised'), le.direction
  FROM ledger_entries le
  LEFT JOIN ledger_categories lc ON lc.id = le.category_id
  WHERE le.deleted_at IS NULL AND le.direction IN ('in', 'out')

  UNION ALL
  SELECT 'transfer-out:' || le.id, 'ledger', le.id,
         le.entry_date, le.created_at,
         le.currency, NULL, le.account_id, -le.amount_cents,
         le.party, le.reference, le.description, 'Transfer', 'transfer'
  FROM ledger_entries le
  WHERE le.deleted_at IS NULL AND le.direction = 'transfer'

  UNION ALL
  SELECT 'transfer-in:' || le.id, 'ledger', le.id,
         le.entry_date, le.created_at,
         le.currency, NULL, le.to_account_id, le.amount_cents,
         le.party, le.reference, le.description, 'Transfer', 'transfer'
  FROM ledger_entries le
  WHERE le.deleted_at IS NULL AND le.direction = 'transfer'
`

/** Places each line in its own account, or the default account for its method. */
const RESOLVED_SQL = `
  SELECT x.*, COALESCE(x.account_id, ma.id) AS resolved_account_id
  FROM (${CASH_LINES_SQL}) x
  LEFT JOIN money_accounts ma
    ON x.account_id IS NULL
   AND ma.kind = x.kind
   AND ma.currency = x.currency
   AND ma.is_default = 1
   AND ma.deleted_at IS NULL
`

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function requireRange(range: DateRange): void {
  if (!ISO_DATE.test(range.from) || !ISO_DATE.test(range.to) || range.from > range.to) {
    throw new LedgerRuleError('Choose a start date on or before the end date.')
  }
}

function toAccount(row: Record<string, unknown>): MoneyAccount {
  return {
    id: String(row['id']),
    name: String(row['name']),
    kind: row['kind'] as MoneyAccount['kind'],
    currency: String(row['currency']),
    opening_balance_cents: Number(row['opening_balance_cents'] ?? 0),
    opening_date: String(row['opening_date']),
    is_default: Number(row['is_default']) === 1 || row['is_default'] === true,
    details: (row['details'] as string | null) ?? null,
  }
}

function toCashLine(row: Record<string, unknown>): CashLine & { flow: string } {
  return {
    id: String(row['id']),
    source: row['source'] as CashSource,
    source_id: String(row['source_id']),
    entry_date: String(row['entry_date']),
    currency: row['currency'] == null ? '' : String(row['currency']),
    account_id: (row['resolved_account_id'] as string | null) ?? null,
    amount_cents: Number(row['amount_cents'] ?? 0),
    party: (row['party'] as string | null) ?? null,
    reference: (row['reference'] as string | null) ?? null,
    description: String(row['description'] ?? ''),
    category: String(row['category'] ?? ''),
    flow: String(row['flow']),
  }
}

function totalsByCategory(lines: ReadonlyArray<CashLine>, sign: 1 | -1): CategoryTotal[] {
  const totals = new Map<string, number>()
  for (const line of lines) {
    totals.set(line.category, (totals.get(line.category) ?? 0) + line.amount_cents * sign)
  }
  return [...totals.entries()]
    .map(([category, amount_cents]) => ({ category, amount_cents }))
    .sort((a, b) => b.amount_cents - a.amount_cents)
}

export interface WalletReconciliation extends Reconciliation {
  account: MoneyAccountBalance
  bookBalanceCents: number
  /** IntaSend's running balance after its latest movement; null before the first sync. */
  intasendBalanceCents: number | null
  differenceCents: number | null
  lastMovementAt: string | null
}

export class LedgerRepository {
  private readonly accounts: Repository<Record<string, unknown>>
  private readonly categoryRows: Repository<Record<string, unknown>>
  private readonly entries: Repository<Record<string, unknown>>

  constructor(
    private readonly db: SqlDatabase,
    private readonly role: Role,
    context: WriteContext,
  ) {
    this.accounts = new Repository(db, 'money_accounts', context)
    this.categoryRows = new Repository(db, 'ledger_categories', context)
    this.entries = new Repository(db, 'ledger_entries', context)
  }

  private requireSee(): void {
    if (!canSeeLedger(this.role)) {
      throw new LedgerRuleError('This role cannot see the books.')
    }
  }

  // ------------------------------------------------------------- accounts

  async listAccounts(): Promise<MoneyAccount[]> {
    this.requireSee()
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT * FROM money_accounts WHERE deleted_at IS NULL
       ORDER BY currency, CASE kind WHEN 'cash' THEN 0 WHEN 'mpesa' THEN 1 WHEN 'bank' THEN 2 ELSE 3 END, name`,
    )
    return rows.map(toAccount)
  }

  /** Each account's balance today: opening balance plus everything since its opening date. */
  async accountBalances(
    today: string = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10),
  ): Promise<MoneyAccountBalance[]> {
    const accounts = await this.listAccounts()
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT a.id AS id,
              COALESCE(SUM(CASE WHEN l.amount_cents > 0 THEN l.amount_cents END), 0) AS money_in,
              COALESCE(SUM(CASE WHEN l.amount_cents < 0 THEN -l.amount_cents END), 0) AS money_out
       FROM money_accounts a
       JOIN (${RESOLVED_SQL}) l
         ON l.resolved_account_id = a.id AND l.entry_date >= a.opening_date
        AND l.entry_date <= ?
       WHERE a.deleted_at IS NULL
       GROUP BY a.id`,
      [today],
    )
    const flows = new Map(rows.map((row) => [String(row['id']), row]))
    return accounts.map((account) => {
      const flow = flows.get(account.id)
      const moneyIn = Number(flow?.['money_in'] ?? 0)
      const moneyOut = Number(flow?.['money_out'] ?? 0)
      return {
        ...account,
        money_in_cents: moneyIn,
        money_out_cents: moneyOut,
        balance_cents: account.opening_balance_cents + moneyIn - moneyOut,
      }
    })
  }

  /** Money recorded with a method and currency that no default account covers. */
  async unassigned(): Promise<Array<{ currency: string; count: number; net_cents: number }>> {
    this.requireSee()
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT COALESCE(currency, 'unknown currency') AS currency, COUNT(*) AS count,
              SUM(amount_cents) AS net
       FROM (${RESOLVED_SQL}) WHERE resolved_account_id IS NULL
       GROUP BY 1 ORDER BY 1`,
    )
    return rows.map((row) => ({
      currency: String(row['currency']),
      count: Number(row['count']),
      net_cents: Number(row['net'] ?? 0),
    }))
  }

  async saveAccount(input: MoneyAccountInput): Promise<void> {
    if (!canManageAccounts(this.role)) {
      throw new LedgerRuleError('Only the owner can set up money accounts.')
    }
    const name = input.name.trim()
    const currency = input.currency.trim().toUpperCase()
    if (!name) throw new LedgerRuleError('Enter the account name.')
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new LedgerRuleError('Enter the currency as a three-letter code, for example KES.')
    }
    if (!ISO_DATE.test(input.openingDate)) {
      throw new LedgerRuleError('Enter the date the opening balance was counted.')
    }
    if (!Number.isInteger(input.openingBalanceCents)) {
      throw new LedgerRuleError('Enter a valid opening balance.')
    }

    const existing = await this.accounts.findById(input.id)
    if (existing && String(existing['currency']) !== currency) {
      const used = await this.entries.count('(account_id = ? OR to_account_id = ?)', [
        input.id,
        input.id,
      ])
      if (used > 0) {
        throw new LedgerRuleError(
          'This account already has entries in its currency. Open a new account instead.',
        )
      }
    }

    // One default per kind and currency (unique index on the server). The old
    // default is cleared first so the outbox pushes the two in a valid order.
    if (input.isDefault) {
      const others = await this.db.select<{ id: string }>(
        `SELECT id FROM money_accounts
         WHERE kind = ? AND currency = ? AND is_default = 1 AND deleted_at IS NULL AND id <> ?`,
        [input.kind, currency, input.id],
      )
      for (const other of others) await this.accounts.update(other.id, { is_default: false })
    }

    const values = {
      name,
      kind: input.kind,
      currency,
      opening_balance_cents: input.openingBalanceCents,
      opening_date: input.openingDate,
      is_default: input.isDefault,
      details: input.details?.trim() || null,
    }
    if (existing) await this.accounts.update(input.id, values)
    else await this.accounts.insert({ id: input.id, ...values })
  }

  async removeAccount(id: string): Promise<void> {
    if (!canManageAccounts(this.role)) {
      throw new LedgerRuleError('Only the owner can remove a money account.')
    }
    const used = await this.entries.count('(account_id = ? OR to_account_id = ?)', [id, id])
    if (used > 0) {
      throw new LedgerRuleError('This account has entries. It can be renamed but not removed.')
    }
    const account = await this.accounts.findById(id)
    if (account && Number(account['is_default']) === 1) {
      throw new LedgerRuleError(
        'Payments land in this default account. Make another account the default first.',
      )
    }
    await this.accounts.softDelete(id)
  }

  // ----------------------------------------------------------- categories

  async listCategories(includeInactive = false): Promise<LedgerCategory[]> {
    this.requireSee()
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT id, name, direction, position, is_active FROM ledger_categories
       WHERE deleted_at IS NULL ${includeInactive ? '' : 'AND is_active = 1'}
       ORDER BY direction DESC, position, name COLLATE NOCASE`,
    )
    return rows.map((row) => ({
      id: String(row['id']),
      name: String(row['name']),
      direction: row['direction'] as 'in' | 'out',
      position: Number(row['position'] ?? 0),
      is_active: Number(row['is_active']) === 1,
    }))
  }

  async addCategory(id: string, name: string, direction: 'in' | 'out'): Promise<void> {
    if (!canCorrectLedger(this.role)) {
      throw new LedgerRuleError('Only the owner or accountant can add a category.')
    }
    const trimmed = name.trim()
    if (!trimmed) throw new LedgerRuleError('Enter the category name.')
    const clash = await this.categoryRows.count('direction = ? AND LOWER(name) = LOWER(?)', [
      direction,
      trimmed,
    ])
    if (clash > 0) throw new LedgerRuleError('That category already exists.')
    await this.categoryRows.insert({ id, name: trimmed, direction, position: 500, is_active: true })
  }

  async setCategoryActive(id: string, isActive: boolean): Promise<void> {
    if (!canCorrectLedger(this.role)) {
      throw new LedgerRuleError('Only the owner or accountant can change categories.')
    }
    await this.categoryRows.update(id, { is_active: isActive })
  }

  // -------------------------------------------------------------- entries

  private async validateEntry(input: NewLedgerEntry): Promise<{ currency: string }> {
    if (!ISO_DATE.test(input.entryDate)) throw new LedgerRuleError('Enter the date.')
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new LedgerRuleError('Enter an amount greater than zero.')
    }
    if (!input.description.trim()) {
      throw new LedgerRuleError('Describe what the money was for.')
    }
    const account = await this.accounts.findById(input.accountId)
    if (!account || account['deleted_at']) throw new LedgerRuleError('Choose an account.')
    const currency = String(account['currency'])

    if (input.direction === 'transfer') {
      if (!input.toAccountId || input.toAccountId === input.accountId) {
        throw new LedgerRuleError('Choose a different account to move the money into.')
      }
      const target = await this.accounts.findById(input.toAccountId)
      if (!target || target['deleted_at'])
        throw new LedgerRuleError('Choose the receiving account.')
      if (String(target['currency']) !== currency) {
        throw new LedgerRuleError('A transfer must stay in one currency.')
      }
      return { currency }
    }

    if (!input.categoryId) throw new LedgerRuleError('Choose a category.')
    const category = await this.categoryRows.findById(input.categoryId)
    if (!category || category['direction'] !== input.direction) {
      throw new LedgerRuleError('Choose a category for this kind of entry.')
    }
    return { currency }
  }

  private entryValues(input: NewLedgerEntry, currency: string): Record<string, unknown> {
    const isTransfer = input.direction === 'transfer'
    return {
      entry_date: input.entryDate,
      direction: input.direction,
      account_id: input.accountId,
      to_account_id: isTransfer ? input.toAccountId : null,
      category_id: isTransfer ? null : input.categoryId,
      amount_cents: input.amountCents,
      currency,
      party: input.party?.trim() || null,
      reference: input.reference?.trim() || null,
      description: input.description.trim(),
    }
  }

  async recordEntry(input: NewLedgerEntry): Promise<void> {
    if (!canRecordLedger(this.role)) {
      throw new LedgerRuleError('This role cannot record money in or out.')
    }
    const { currency } = await this.validateEntry(input)
    await this.entries.insert({ id: input.id, ...this.entryValues(input, currency) })
  }

  async correctEntry(input: NewLedgerEntry): Promise<void> {
    if (!canCorrectLedger(this.role)) {
      throw new LedgerRuleError('Only the owner or accountant can correct an entry.')
    }
    const { currency } = await this.validateEntry(input)
    await this.entries.update(input.id, this.entryValues(input, currency))
  }

  async removeEntry(id: string): Promise<void> {
    if (!canCorrectLedger(this.role)) {
      throw new LedgerRuleError('Only the owner or accountant can delete an entry.')
    }
    await this.entries.softDelete(id)
  }

  async findEntry(id: string): Promise<LedgerEntry | null> {
    this.requireSee()
    const row = await this.entries.findById(id)
    if (!row || row['deleted_at']) return null
    return row as unknown as LedgerEntry
  }

  // ------------------------------------------------------------ cash book

  /** Every movement in a period, newest last, optionally for one account. */
  async cashLines(range: DateRange, accountId?: string): Promise<CashLine[]> {
    this.requireSee()
    requireRange(range)
    const params: unknown[] = [range.from, range.to]
    let where = 'entry_date BETWEEN ? AND ?'
    if (accountId) {
      where += ' AND resolved_account_id = ?'
      params.push(accountId)
    }
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT * FROM (${RESOLVED_SQL}) WHERE ${where} ORDER BY entry_date, sort_at, id`,
      params,
    )
    return rows.map((row) => {
      const { flow: _flow, ...line } = toCashLine(row)
      return line
    })
  }

  /** One account's cash book with an opening and a running balance. */
  async cashBook(accountId: string, range: DateRange): Promise<CashBook> {
    requireRange(range)
    const account = (await this.listAccounts()).find((candidate) => candidate.id === accountId)
    if (!account) throw new LedgerRuleError('Choose an account.')

    const [before] = await this.db.select<{ total: number | null }>(
      `SELECT SUM(amount_cents) AS total FROM (${RESOLVED_SQL})
       WHERE resolved_account_id = ? AND entry_date >= ? AND entry_date < ?`,
      [accountId, account.opening_date, range.from],
    )
    // Lines dated before the opening balance was counted are already in it.
    const from = range.from > account.opening_date ? range.from : account.opening_date
    const inRange = from > range.to ? [] : await this.cashLines({ from, to: range.to }, accountId)

    const opening = account.opening_balance_cents + Number(before?.total ?? 0)
    let balance = opening
    const lines = inRange.map((line) => {
      balance += line.amount_cents
      return { ...line, balance_cents: balance }
    })
    return {
      account,
      currency: account.currency,
      opening_cents: opening,
      closing_cents: balance,
      lines,
    }
  }

  /**
   * Cash-basis income and expenditure: what came in and went out in the
   * period, by category, one statement per currency. Transfers between the
   * farm's own accounts are neither.
   */
  async incomeStatement(range: DateRange): Promise<IncomeStatement[]> {
    this.requireSee()
    requireRange(range)
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT * FROM (${RESOLVED_SQL})
       WHERE entry_date BETWEEN ? AND ? AND flow <> 'transfer'`,
      [range.from, range.to],
    )
    const lines = rows.map(toCashLine)
    // Money whose invoice is not on this device has no known currency; it is
    // reported by unassigned() rather than guessed into shillings.
    const currencies = [
      ...new Set(lines.filter((line) => line.currency !== '').map((line) => line.currency)),
    ].sort()

    return currencies.map((currency) => {
      const own = lines.filter((line) => line.currency === currency)
      const income = totalsByCategory(
        own.filter((line) => line.flow === 'in'),
        1,
      )
      const expenditure = totalsByCategory(
        own.filter((line) => line.flow === 'out'),
        -1,
      )
      const totalIncome = income.reduce((sum, row) => sum + row.amount_cents, 0)
      const totalExpenditure = expenditure.reduce((sum, row) => sum + row.amount_cents, 0)
      return {
        currency,
        income,
        expenditure,
        total_income_cents: totalIncome,
        total_expenditure_cents: totalExpenditure,
        net_cents: totalIncome - totalExpenditure,
      }
    })
  }

  // ------------------------------------------------------ IntaSend wallet

  /**
   * IntaSend's statement against the books' IntaSend wallet account. Null
   * when the farm has no KES wallet account to reconcile to.
   */
  async walletReconciliation(
    today: string = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10),
  ): Promise<WalletReconciliation | null> {
    const balances = await this.accountBalances(today)
    const wallet =
      balances.find((a) => a.kind === 'wallet' && a.currency === 'KES' && a.is_default) ??
      balances.find((a) => a.kind === 'wallet' && a.currency === 'KES')
    if (!wallet) return null

    const statement = (
      await this.db.select<Record<string, unknown>>(
        `SELECT transaction_id, trans_type, value_cents, running_balance_cents, narrative,
                occurred_at, ${LOCAL_DAY('occurred_at')} AS day
         FROM intasend_wallet_transactions
         WHERE deleted_at IS NULL AND currency = 'KES'
         ORDER BY occurred_at, transaction_id`,
      )
    ).map((row): StatementLine => ({
      transaction_id: String(row['transaction_id']),
      trans_type: String(row['trans_type']),
      value_cents: Number(row['value_cents']),
      running_balance_cents: Number(row['running_balance_cents']),
      narrative: row['narrative'] == null ? null : String(row['narrative']),
      occurred_at: String(row['occurred_at']),
      day: String(row['day']),
    }))

    // A salary leaves the wallet as one debit: the amount plus IntaSend's fee.
    const payouts = (
      await this.db.select<Record<string, unknown>>(
        `SELECT id, ${LOCAL_DAY('settled_at')} AS day, amount_cents, COALESCE(fee_cents, 0) AS fee,
                recipient_name, mpesa_receipt
         FROM payroll_payouts
         WHERE provider = 'intasend' AND status = 'paid' AND deleted_at IS NULL`,
      )
    ).map((row): BookMovement => ({
      id: `payout:${String(row['id'])}`,
      day: String(row['day']),
      amount_cents: -(Number(row['amount_cents']) + Number(row['fee'])),
      label: ['Salary', row['recipient_name'], row['mpesa_receipt']].filter(Boolean).join(' · '),
    }))
    const others = (await this.cashLines({ from: wallet.opening_date, to: today }, wallet.id))
      .filter((line) => line.source !== 'salary' && line.source !== 'payout_fee')
      .map((line): BookMovement => ({
        id: line.id,
        day: line.entry_date,
        amount_cents: line.amount_cents,
        label: [line.category, line.party, line.reference].filter(Boolean).join(' · '),
      }))

    const latest = statement[statement.length - 1] ?? null
    const intasendBalance = latest ? latest.running_balance_cents : null
    return {
      account: wallet,
      bookBalanceCents: wallet.balance_cents,
      intasendBalanceCents: intasendBalance,
      differenceCents: intasendBalance === null ? null : intasendBalance - wallet.balance_cents,
      lastMovementAt: latest?.occurred_at ?? null,
      ...reconcileWallet(statement, [...payouts, ...others], wallet.opening_date),
    }
  }
}
