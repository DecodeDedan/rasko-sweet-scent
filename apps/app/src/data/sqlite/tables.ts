/**
 * The device-local mirror: one spec per table, used to generate BOTH the DDL and
 * the value codec.
 *
 * Deliberately a single source rather than hand-written DDL plus a separate
 * converter. Those two drift silently — a column added to the schema but missed
 * in the codec produces rows that sync but decode wrong, which surfaces weeks
 * later as a wrong number on an invoice.
 *
 * Type mapping is docs/architecture.md §9.1. SQLite has no uuid, timestamptz,
 * jsonb, numeric or boolean, so:
 *
 *   uuid        -> TEXT   lowercase canonical
 *   timestamptz -> TEXT   ISO-8601 UTC; lexicographic order == chronological,
 *                         which is what makes the cursor comparison work here too
 *   date        -> TEXT   YYYY-MM-DD
 *   bigint      -> INTEGER 64-bit, money in cents
 *   numeric     -> INTEGER thousandths; REAL would drift under repeated summation
 *   boolean     -> INTEGER 0/1
 *   jsonb       -> TEXT   serialised
 */

export type ColumnKind = 'uuid' | 'text' | 'ts' | 'date' | 'money' | 'int' | 'qty' | 'bool' | 'json'

export interface ColumnSpec {
  name: string
  kind: ColumnKind
}

export type SyncDirection = 'both' | 'pull' | 'push'

export interface TableSpec {
  name: string
  columns: ColumnSpec[]
  /**
   * Append-only tables (architecture.md §2.6, §5.4) have no updated_at, so the
   * pull cursor pages on created_at instead. They are insert-only, so the two
   * are equivalent.
   */
  appendOnly?: boolean
  /**
   * Overrides the cursor column. audit_log needs it: it is append-only but has
   * no created_at — it carries occurred_at (device time) and recorded_at
   * (server time), and only the server's clock is safe to page on.
   */
  cursor?: string
  /** `pull` for server-generated data; `push` for device-owned bookkeeping. */
  direction?: SyncDirection
  /**
   * The device only ever inserts these rows and the server then changes them
   * (outbound_emails: queued -> sent). Pushes use ignoreDuplicates like an
   * append-only table, so a retried push can never overwrite what the server
   * wrote, while pulls still overwrite local copies with the server's.
   */
  pushInsertOnly?: boolean
}

const c = (name: string, kind: ColumnKind): ColumnSpec => ({ name, kind })

/** Columns every mutable mirrored table carries (architecture.md §1.1). */
const MUTABLE_BASE: ColumnSpec[] = [
  c('created_at', 'ts'),
  c('updated_at', 'ts'),
  c('deleted_at', 'ts'),
  c('created_by', 'uuid'),
  c('updated_by', 'uuid'),
]

/** Append-only tables have no updated_at, updated_by or deleted_at by design. */
const APPEND_BASE: ColumnSpec[] = [c('created_at', 'ts'), c('created_by', 'uuid')]

export const TABLES: readonly TableSpec[] = [
  {
    name: 'profiles',
    columns: [
      c('id', 'uuid'),
      c('full_name', 'text'),
      c('email', 'text'),
      c('phone', 'text'),
      c('role', 'text'),
      c('is_active', 'bool'),
      c('must_change_password', 'bool'),
      c('deactivated_at', 'ts'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'categories',
    columns: [
      c('id', 'uuid'),
      c('name', 'text'),
      c('slug', 'text'),
      c('is_vatable', 'bool'),
      c('position', 'int'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'clients',
    columns: [
      c('id', 'uuid'),
      c('name', 'text'),
      c('client_type', 'text'),
      c('phone', 'text'),
      c('email', 'text'),
      c('kra_pin', 'text'),
      c('address', 'text'),
      c('credit_terms_days', 'int'),
      c('notes', 'text'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'products',
    columns: [
      c('id', 'uuid'),
      c('sku', 'text'),
      c('name', 'text'),
      c('category_id', 'uuid'),
      // 'standard' | 'spray' (migration 20260926000100).
      c('stem_form', 'text'),
      c('unit', 'text'),
      c('cost_price_cents', 'money'),
      c('selling_price_cents', 'money'),
      c('low_stock_threshold', 'qty'),
      c('is_active', 'bool'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'product_prices',
    columns: [
      c('id', 'uuid'),
      c('product_id', 'uuid'),
      c('client_type', 'text'),
      c('price_cents', 'money'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'stock_movements',
    appendOnly: true,
    columns: [
      c('id', 'uuid'),
      c('product_id', 'uuid'),
      c('movement_type', 'text'),
      c('quantity', 'qty'),
      c('unit_cost_cents', 'money'),
      c('source_table', 'text'),
      c('source_id', 'uuid'),
      c('reason', 'text'),
      c('occurred_at', 'ts'),
      ...APPEND_BASE,
    ],
  },
  {
    name: 'orders',
    columns: [
      c('id', 'uuid'),
      c('order_number', 'text'),
      c('client_id', 'uuid'),
      c('is_walk_in', 'bool'),
      c('status', 'text'),
      c('order_type', 'text'),
      c('subtotal_cents', 'money'),
      c('discount_cents', 'money'),
      c('total_cents', 'money'),
      c('delivery_at', 'ts'),
      c('delivery_address', 'text'),
      c('event_date', 'date'),
      c('event_venue', 'text'),
      c('event_setup_notes', 'text'),
      c('notes', 'text'),
      c('taken_by', 'uuid'),
      c('confirmed_at', 'ts'),
      c('delivered_at', 'ts'),
      c('cancelled_at', 'ts'),
      c('cancelled_by', 'uuid'),
      c('cancellation_reason', 'text'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'order_items',
    columns: [
      c('id', 'uuid'),
      c('order_id', 'uuid'),
      c('product_id', 'uuid'),
      c('description', 'text'),
      c('quantity', 'qty'),
      c('unit_price_cents', 'money'),
      c('discount_cents', 'money'),
      c('line_total_cents', 'money'),
      c('position', 'int'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'invoices',
    columns: [
      c('id', 'uuid'),
      c('invoice_number', 'text'),
      c('order_id', 'uuid'),
      c('client_id', 'uuid'),
      c('client_snapshot', 'json'),
      c('company_snapshot', 'json'),
      c('status', 'text'),
      c('issue_date', 'date'),
      c('due_date', 'date'),
      c('subtotal_cents', 'money'),
      c('discount_cents', 'money'),
      c('vat_rate_bp', 'int'),
      c('vat_cents', 'money'),
      c('total_cents', 'money'),
      c('voided_at', 'ts'),
      c('voided_by', 'uuid'),
      c('void_reason', 'text'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'payments',
    appendOnly: true,
    columns: [
      c('id', 'uuid'),
      c('invoice_id', 'uuid'),
      c('amount_cents', 'money'),
      c('method', 'text'),
      c('reference', 'text'),
      c('paid_at', 'ts'),
      c('received_by', 'uuid'),
      c('notes', 'text'),
      ...APPEND_BASE,
    ],
  },
  {
    name: 'reversals',
    appendOnly: true,
    columns: [
      c('id', 'uuid'),
      c('payment_id', 'uuid'),
      c('amount_cents', 'money'),
      c('reason', 'text'),
      c('reversed_at', 'ts'),
      ...APPEND_BASE,
    ],
  },
  {
    name: 'suppliers',
    columns: [
      c('id', 'uuid'),
      c('name', 'text'),
      c('contact_person', 'text'),
      c('phone', 'text'),
      c('email', 'text'),
      c('payment_terms_days', 'int'),
      c('kra_pin', 'text'),
      c('notes', 'text'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'purchases',
    columns: [
      c('id', 'uuid'),
      c('purchase_number', 'text'),
      c('supplier_id', 'uuid'),
      c('status', 'text'),
      c('purchase_date', 'date'),
      c('due_date', 'date'),
      c('total_cents', 'money'),
      c('received_at', 'ts'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'purchase_items',
    columns: [
      c('id', 'uuid'),
      c('purchase_id', 'uuid'),
      c('product_id', 'uuid'),
      c('quantity', 'qty'),
      c('unit_cost_cents', 'money'),
      c('line_total_cents', 'money'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'supplier_payments',
    appendOnly: true,
    columns: [
      c('id', 'uuid'),
      c('purchase_id', 'uuid'),
      c('amount_cents', 'money'),
      c('method', 'text'),
      c('reference', 'text'),
      c('paid_at', 'ts'),
      ...APPEND_BASE,
    ],
  },
  {
    name: 'employees',
    columns: [
      c('id', 'uuid'),
      c('profile_id', 'uuid'),
      c('full_name', 'text'),
      c('national_id', 'text'),
      c('kra_pin', 'text'),
      c('nssf_number', 'text'),
      c('shif_number', 'text'),
      c('phone', 'text'),
      c('position', 'text'),
      c('salary_type', 'text'),
      c('basic_pay_cents', 'money'),
      c('allowances', 'json'),
      c('payment_method', 'text'),
      c('payment_details', 'json'),
      c('is_active', 'bool'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'advances',
    columns: [
      c('id', 'uuid'),
      c('employee_id', 'uuid'),
      c('amount_cents', 'money'),
      c('requested_at', 'ts'),
      c('requested_by', 'uuid'),
      c('status', 'text'),
      c('approved_at', 'ts'),
      c('approved_by', 'uuid'),
      c('recovered_in_run_id', 'uuid'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'payroll_runs',
    columns: [
      c('id', 'uuid'),
      c('period_year', 'int'),
      c('period_month', 'int'),
      c('status', 'text'),
      c('prepared_at', 'ts'),
      c('prepared_by', 'uuid'),
      c('approved_at', 'ts'),
      c('approved_by', 'uuid'),
      c('rates_snapshot', 'json'),
      c('totals', 'json'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'payroll_items',
    columns: [
      c('id', 'uuid'),
      c('payroll_run_id', 'uuid'),
      c('employee_id', 'uuid'),
      c('employee_snapshot', 'json'),
      c('days_worked', 'qty'),
      c('basic_pay_cents', 'money'),
      c('allowances', 'json'),
      c('gross_cents', 'money'),
      c('paye_cents', 'money'),
      c('nssf_cents', 'money'),
      c('shif_cents', 'money'),
      c('housing_levy_cents', 'money'),
      c('advance_deduction_cents', 'money'),
      c('other_deductions', 'json'),
      c('net_pay_cents', 'money'),
      c('paid_at', 'ts'),
      c('payment_method', 'text'),
      c('payment_reference', 'text'),
      ...MUTABLE_BASE,
    ],
  },
  {
    // M-Pesa B2C salary payouts (migration 20260927000100). The device names
    // the payslip line; the server sets the amount, the phone and every status
    // change, so the push is insert-only and pulls bring the outcome back.
    name: 'payroll_payouts',
    pushInsertOnly: true,
    columns: [
      c('id', 'uuid'),
      c('payroll_run_id', 'uuid'),
      c('payroll_item_id', 'uuid'),
      c('employee_id', 'uuid'),
      c('amount_cents', 'money'),
      c('remainder_cents', 'money'),
      c('msisdn', 'text'),
      c('status', 'text'),
      c('attempts', 'int'),
      c('conversation_id', 'text'),
      c('mpesa_receipt', 'text'),
      c('result_code', 'text'),
      c('result_desc', 'text'),
      c('recipient_name', 'text'),
      c('settled_at', 'ts'),
      // Migration 20260929000100: IntaSend and bank payouts.
      c('provider', 'text'),
      c('channel', 'text'),
      c('bank_code', 'text'),
      c('bank_account', 'text'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'company_settings',
    columns: [
      c('id', 'uuid'),
      c('company_name', 'text'),
      c('address', 'text'),
      c('phone', 'text'),
      c('email', 'text'),
      c('kra_pin', 'text'),
      c('logo_url', 'text'),
      c('is_vat_registered', 'bool'),
      c('mpesa_paybill', 'text'),
      c('mpesa_till', 'text'),
      c('bank_details', 'json'),
      c('stock_deduction_point', 'text'),
      c('update_cost_on_receipt', 'bool'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'tax_config',
    columns: [
      c('id', 'uuid'),
      c('is_vat_enabled', 'bool'),
      c('vat_rate_bp', 'int'),
      c('effective_from', 'date'),
      c('effective_to', 'date'),
      c('applies_to_category_ids', 'json'),
      ...MUTABLE_BASE,
    ],
  },
  {
    name: 'statutory_rates',
    columns: [
      c('id', 'uuid'),
      c('kind', 'text'),
      c('effective_from', 'date'),
      c('effective_to', 'date'),
      c('config', 'json'),
      ...MUTABLE_BASE,
    ],
  },
  {
    // Client email wording (migration 20260925000100). Edited in Settings by
    // the owner or a manager; mirrored so it can be edited offline.
    name: 'email_templates',
    columns: [
      c('id', 'uuid'),
      c('key', 'text'),
      c('label', 'text'),
      c('subject', 'text'),
      c('heading', 'text'),
      c('body', 'text'),
      ...MUTABLE_BASE,
    ],
  },
  {
    // An email is a queued row: composed offline, sent by the server once it
    // arrives, its delivery status synced back (migration 20260925000100).
    name: 'outbound_emails',
    pushInsertOnly: true,
    columns: [
      c('id', 'uuid'),
      c('template_key', 'text'),
      c('to_email', 'text'),
      c('to_name', 'text'),
      c('client_id', 'uuid'),
      c('related_table', 'text'),
      c('related_id', 'uuid'),
      c('personal_note', 'text'),
      c('status', 'text'),
      c('attempts', 'int'),
      c('last_error', 'text'),
      c('sent_at', 'ts'),
      ...MUTABLE_BASE,
    ],
  },
  {
    // FR-9.5: one row per verified nightly backup, written by backup.yml.
    // Owners only (RLS); every other role pulls nothing.
    name: 'backup_runs',
    appendOnly: true,
    direction: 'pull',
    columns: [
      c('id', 'uuid'),
      c('created_at', 'ts'),
      c('file_name', 'text'),
      c('size_bytes', 'int'),
    ],
  },
  {
    // Written by database triggers when a change reaches the server, never by a
    // client (architecture.md §7.2), so the device only ever reads it.
    name: 'audit_log',
    appendOnly: true,
    cursor: 'recorded_at',
    direction: 'pull',
    columns: [
      c('id', 'uuid'),
      c('actor_id', 'uuid'),
      c('actor_role', 'text'),
      c('action', 'text'),
      c('entity_table', 'text'),
      c('entity_id', 'uuid'),
      c('before', 'json'),
      c('after', 'json'),
      c('changed_fields', 'json'),
      c('reason', 'text'),
      c('device_id', 'uuid'),
      c('occurred_at', 'ts'),
      c('recorded_at', 'ts'),
    ],
  },
  {
    // This device's own bookkeeping row. It reports upward; it has no reason to
    // pull other devices' rows down.
    name: 'sync_devices',
    direction: 'push',
    columns: [
      c('id', 'uuid'),
      c('profile_id', 'uuid'),
      c('platform', 'text'),
      c('app_version', 'text'),
      c('last_seen_at', 'ts'),
      c('last_push_at', 'ts'),
      c('last_pull_at', 'ts'),
      c('pending_count', 'int'),
      c('created_at', 'ts'),
      c('updated_at', 'ts'),
    ],
  },
]

/**
 * `website_contact_messages` is deliberately NOT mirrored. It is website data
 * read online in an admin surface (architecture.md §2.25); no device screen
 * consumes it, and pulling it would replicate public form submissions onto every
 * phone for no benefit.
 */
export const UNMIRRORED_TABLES = ['website_contact_messages'] as const

export const TABLES_BY_NAME: ReadonlyMap<string, TableSpec> = new Map(
  TABLES.map((table) => [table.name, table]),
)

export function tableSpec(name: string): TableSpec {
  const spec = TABLES_BY_NAME.get(name)
  if (!spec) throw new Error(`Unknown mirrored table: ${name}`)
  return spec
}

/** The column a table's pull cursor pages on. */
export function cursorColumn(spec: TableSpec): string {
  if (spec.cursor) return spec.cursor
  return spec.appendOnly ? 'created_at' : 'updated_at'
}

export function isPullable(spec: TableSpec): boolean {
  return (spec.direction ?? 'both') !== 'push'
}

export function isPushable(spec: TableSpec): boolean {
  return (spec.direction ?? 'both') !== 'pull'
}
