'use client'

import { ClipboardCheck, DatabaseZap, Download, Plus, Warehouse } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  Drawer,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  StatusChip,
  TabPanel,
  Table,
  Tabs,
  formatDate,
  formatQuantity,
  useToast,
} from '@rasko/ui'

import { newId } from '../../data/ids.js'
import { useSyncedEffect } from '../../data/sync/useSyncedEffect.js'
import { ScopeBadge } from '../../screens/common.js'
import type { ScreenProps } from '../../screens/common.js'
import { downloadCsv } from '../../shell/download.js'
import { toCsv } from '../dashboard/dashboardRepository.js'
import { currentMonthRange } from '../ledger/useLedger.js'
import { useOrdersRepository } from '../orders/useOrders.js'
import { DeliveryForm } from './DeliveryForm.js'
import { IntakeForm } from './IntakeForm.js'
import { DELIVERY_STATUS_LABEL, canWritePackhouse, lineOutcome, rejectionLabel } from './types.js'
import type {
  DeliveryDetail,
  DeliveryStatus,
  DeliverySummary,
  QualityRow,
  ReasonRow,
} from './types.js'
import { usePackhouseRepository } from './usePackhouse.js'
import './packhouse.css'

type View = 'deliveries' | 'quality'

const TABS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'deliveries', label: 'Deliveries' },
  { id: 'quality', label: 'Quality report' },
]

const STATUS_FILTERS: ReadonlyArray<{ value: DeliveryStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All deliveries' },
  { value: 'dispatched', label: 'Awaiting intake' },
  { value: 'received', label: 'Intake recorded' },
  { value: 'cancelled', label: 'Cancelled' },
]

function percent(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—'
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function statusChip(delivery: DeliverySummary) {
  if (delivery.status === 'cancelled') return <StatusChip tone="neutral">Cancelled</StatusChip>
  if (delivery.status === 'dispatched')
    return <StatusChip tone="warning">Awaiting intake</StatusChip>
  if (delivery.order_id) return <StatusChip tone="success">Settled</StatusChip>
  return <StatusChip tone="warning">Ready to settle</StatusChip>
}

export function PackhouseScreen({ role, scope }: ScreenProps) {
  const repo = usePackhouseRepository()
  const orders = useOrdersRepository()
  const { showToast } = useToast()

  const [view, setView] = useState<View>('deliveries')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<DeliveryStatus | 'all'>('all')
  const [range, setRange] = useState(currentMonthRange)

  const [deliveries, setDeliveries] = useState<DeliverySummary[]>([])
  const [quality, setQuality] = useState<QualityRow[]>([])
  const [reasons, setReasons] = useState<ReasonRow[]>([])
  const [options, setOptions] = useState<{
    clients: Array<{ id: string; name: string }>
    products: Array<{ id: string; name: string }>
  }>({ clients: [], products: [] })
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const [isCreating, setIsCreating] = useState(false)
  const [selected, setSelected] = useState<DeliveryDetail | null>(null)
  const [intakeFor, setIntakeFor] = useState<DeliveryDetail | null>(null)
  const [isSettling, setIsSettling] = useState(false)

  const load = useCallback(async () => {
    if (!repo) {
      setIsLoading(false)
      return
    }
    try {
      setError(null)
      const [rows, nextQuality, nextReasons] = await Promise.all([
        repo.list({ search, status }),
        repo.quality(range.from, range.to),
        repo.reasons(range.from, range.to),
      ])
      setDeliveries(rows)
      setQuality(nextQuality)
      setReasons(nextReasons)
    } catch (cause) {
      setError(message(cause, 'Could not read pack house deliveries.'))
    } finally {
      setIsLoading(false)
    }
  }, [repo, search, status, range])

  useSyncedEffect(load)

  useEffect(() => {
    if (!repo) return
    let cancelled = false
    Promise.all([repo.clients(), repo.products()])
      .then(([clients, products]) => {
        if (!cancelled) setOptions({ clients, products })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(message(cause, 'Could not read clients and varieties.'))
      })
    return () => {
      cancelled = true
    }
  }, [repo])

  if (!repo) {
    return (
      <div className="rsk-stack">
        <PageHeader title="Pack house" meta={<ScopeBadge scope={scope} />} />
        <Card>
          <EmptyState
            icon={<DatabaseZap size={20} aria-hidden="true" />}
            title="Local storage is not available here"
            description="Pack house deliveries are held on the device. Run the installed application to see them."
          />
        </Card>
      </div>
    )
  }

  const packhouse = repo
  const canWrite = canWritePackhouse(role)
  const today = currentMonthRange().to

  async function open(id: string): Promise<DeliveryDetail | null> {
    try {
      return await packhouse.detail(id)
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not open the delivery',
        description: message(cause, ''),
      })
      return null
    }
  }

  async function refreshSelected(id: string) {
    await load()
    setSelected(await open(id))
  }

  async function settle(delivery: DeliveryDetail) {
    if (!orders) return
    setIsSettling(true)
    try {
      const result = await packhouse.settle(delivery.id, orders)
      showToast({
        tone: 'success',
        title: 'Delivery settled',
        description: `${result.orderId ? 'An order for the accepted stems is in Orders as a draft. ' : ''}${
          result.wastageLines > 0 ? 'Rejected and short stems were booked as wastage.' : ''
        }`,
      })
      await refreshSelected(delivery.id)
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not settle the delivery',
        description: message(cause, ''),
      })
    } finally {
      setIsSettling(false)
    }
  }

  async function cancel(delivery: DeliveryDetail) {
    if (!window.confirm('Cancel this delivery? It stays on record as cancelled.')) return
    try {
      await packhouse.cancel(delivery.id)
      showToast({ tone: 'success', title: 'Delivery cancelled' })
      await refreshSelected(delivery.id)
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not cancel the delivery',
        description: message(cause, ''),
      })
    }
  }

  function exportQuality() {
    downloadCsv(
      `packhouse-quality-${range.from}-to-${range.to}.csv`,
      toCsv(
        [
          'Variety',
          'Sent',
          'Received',
          'Rejected primary',
          'Rejected secondary',
          'Accepted',
          'Acceptance',
        ],
        quality.map((row) => [
          row.product_name,
          row.sent,
          row.received,
          row.rejected_primary,
          row.rejected_secondary,
          row.accepted,
          percent(row.accepted, row.received),
        ]),
      ),
    )
    showToast({ tone: 'success', title: 'Quality report downloaded' })
  }

  const totals = quality.reduce(
    (sum, row) => ({
      sent: sum.sent + row.sent,
      received: sum.received + row.received,
      rejected: sum.rejected + row.rejected_primary + row.rejected_secondary,
      accepted: sum.accepted + row.accepted,
    }),
    { sent: 0, received: 0, rejected: 0, accepted: 0 },
  )

  return (
    <div className="rsk-stack">
      <PageHeader
        title="Pack house"
        description="Deliveries to buyers' pack houses and their intake QC. Only accepted stems are invoiced."
        meta={<ScopeBadge scope={scope} />}
        actions={
          canWrite ? (
            <Button
              variant="primary"
              leadingIcon={<Plus size={15} aria-hidden="true" />}
              onClick={() => setIsCreating(true)}
              disabled={options.clients.length === 0 || options.products.length === 0}
            >
              Record delivery
            </Button>
          ) : null
        }
      />

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <Tabs
        items={TABS}
        activeId={view}
        onChange={(id) => setView(id as View)}
        aria-label="Pack house views"
      />

      <TabPanel id="deliveries" activeId={view}>
        <div className="rsk-stack">
          <div className="rsk-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Search">
              <Input
                type="search"
                value={search}
                placeholder="Pack house, delivery note, gate pass or GRN"
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            <Field label="Status">
              <Select
                value={status}
                onChange={(event) => setStatus(event.target.value as DeliveryStatus | 'all')}
                options={STATUS_FILTERS.map((filter) => ({
                  value: filter.value,
                  label: filter.label,
                }))}
              />
            </Field>
          </div>

          <Card isFlush>
            <Table
              rows={deliveries}
              getRowKey={(delivery) => delivery.id}
              caption="Pack house deliveries"
              onRowSelect={(delivery) => void open(delivery.id).then(setSelected)}
              empty={
                <EmptyState
                  icon={<Warehouse size={20} aria-hidden="true" />}
                  title={isLoading ? 'Reading deliveries' : 'No pack house deliveries yet'}
                  description="Record a delivery when stems leave for a pack house, then key in its intake report when it comes back."
                />
              }
              columns={[
                { key: 'week', header: 'Week', isNumeric: true, render: (d) => d.week },
                { key: 'date', header: 'Date', render: (d) => formatDate(d.delivery_date) },
                { key: 'packhouse', header: 'Pack house', render: (d) => d.client_name },
                {
                  key: 'note',
                  header: 'Delivery note',
                  render: (d) => d.delivery_note_number ?? d.gatepass_number ?? '',
                },
                {
                  key: 'sent',
                  header: 'Sent',
                  isNumeric: true,
                  render: (d) => formatQuantity(d.sent),
                },
                {
                  key: 'accepted',
                  header: 'Accepted',
                  isNumeric: true,
                  render: (d) => (d.status === 'received' ? formatQuantity(d.accepted) : ''),
                },
                {
                  key: 'rate',
                  header: 'Acceptance',
                  isNumeric: true,
                  render: (d) => (d.status === 'received' ? percent(d.accepted, d.received) : ''),
                },
                { key: 'status', header: 'Status', render: statusChip },
              ]}
            />
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="quality" activeId={view}>
        <div className="rsk-stack">
          <div className="rsk-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="From">
              <Input
                type="date"
                value={range.from}
                onChange={(event) => setRange({ ...range, from: event.target.value })}
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={range.to}
                onChange={(event) => setRange({ ...range, to: event.target.value })}
              />
            </Field>
            <Button
              variant="secondary"
              leadingIcon={<Download size={15} aria-hidden="true" />}
              onClick={exportQuality}
              disabled={quality.length === 0}
            >
              Export CSV
            </Button>
          </div>

          <div className="rsk-metrics">
            <Card>
              <p className="rsk-metric__label">Stems sent</p>
              <p className="rsk-metric__value rsk-numeric">{formatQuantity(totals.sent)}</p>
            </Card>
            <Card>
              <p className="rsk-metric__label">Accepted</p>
              <p className="rsk-metric__value rsk-numeric">{formatQuantity(totals.accepted)}</p>
            </Card>
            <Card>
              <p className="rsk-metric__label">Rejected</p>
              <p className="rsk-metric__value rsk-numeric">{formatQuantity(totals.rejected)}</p>
            </Card>
            <Card>
              <p className="rsk-metric__label">Acceptance rate</p>
              <p className="rsk-metric__value rsk-numeric">
                {percent(totals.accepted, totals.received)}
              </p>
            </Card>
          </div>

          <Card isFlush>
            <Table
              rows={quality}
              getRowKey={(row) => row.product_id}
              caption="Acceptance by variety"
              empty={
                <EmptyState
                  icon={<ClipboardCheck size={20} aria-hidden="true" />}
                  title="No intake reports in this period"
                  description="Quality figures appear once a delivery's intake is recorded."
                />
              }
              columns={[
                { key: 'variety', header: 'Variety', render: (row) => row.product_name },
                {
                  key: 'sent',
                  header: 'Sent',
                  isNumeric: true,
                  render: (row) => formatQuantity(row.sent),
                },
                {
                  key: 'received',
                  header: 'Received',
                  isNumeric: true,
                  render: (row) => formatQuantity(row.received),
                },
                {
                  key: 'primary',
                  header: 'Primary QC',
                  isNumeric: true,
                  render: (row) => formatQuantity(row.rejected_primary),
                },
                {
                  key: 'secondary',
                  header: 'Secondary QC',
                  isNumeric: true,
                  render: (row) => formatQuantity(row.rejected_secondary),
                },
                {
                  key: 'accepted',
                  header: 'Accepted',
                  isNumeric: true,
                  render: (row) => formatQuantity(row.accepted),
                },
                {
                  key: 'rate',
                  header: 'Acceptance',
                  isNumeric: true,
                  render: (row) => percent(row.accepted, row.received),
                },
              ]}
            />
          </Card>

          <Card isFlush>
            <Table
              rows={reasons}
              getRowKey={(row) => String(row.code)}
              caption="Rejection reasons"
              empty={
                <EmptyState
                  icon={<ClipboardCheck size={20} aria-hidden="true" />}
                  title="No rejections in this period"
                  description="Reason codes given by the pack house are counted here."
                />
              }
              columns={[
                { key: 'code', header: 'Code', isNumeric: true, render: (row) => row.code },
                { key: 'reason', header: 'Reason', render: (row) => row.label },
                {
                  key: 'lines',
                  header: 'Times given',
                  isNumeric: true,
                  render: (row) => row.lines,
                },
              ]}
            />
          </Card>
        </div>
      </TabPanel>

      {selected ? (
        <Drawer
          isOpen
          onClose={() => setSelected(null)}
          title={`${selected.client_name}, week ${selected.week}`}
          description={`${formatDate(selected.delivery_date)} · ${DELIVERY_STATUS_LABEL[selected.status]}`}
          footer={
            canWrite && selected.status !== 'cancelled' ? (
              <>
                {!selected.order_id && !selected.wastage_recorded_at ? (
                  <Button variant="ghost" onClick={() => void cancel(selected)}>
                    Cancel delivery
                  </Button>
                ) : null}
                {!selected.order_id && !selected.wastage_recorded_at ? (
                  <Button variant="secondary" onClick={() => setIntakeFor(selected)}>
                    {selected.status === 'received' ? 'Correct intake' : 'Record intake'}
                  </Button>
                ) : null}
                {selected.status === 'received' &&
                (!selected.order_id || !selected.wastage_recorded_at) ? (
                  <Button
                    variant="primary"
                    isLoading={isSettling}
                    onClick={() => void settle(selected)}
                  >
                    Raise order and book wastage
                  </Button>
                ) : null}
              </>
            ) : null
          }
        >
          <div className="rsk-stack">
            <dl className="packhouse-facts">
              <div>
                <dt className="rsk-metric__label">Delivery note / gate pass</dt>
                <dd>
                  {selected.delivery_note_number ?? '—'} / {selected.gatepass_number ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="rsk-metric__label">GRN · arrival temperature</dt>
                <dd>
                  {selected.grn_number ?? '—'} ·{' '}
                  {selected.arrival_temp_c === null ? '—' : `${selected.arrival_temp_c} °C`}
                </dd>
              </div>
              <div>
                <dt className="rsk-metric__label">QC officer · pack house manager</dt>
                <dd>
                  {selected.qc_officer ?? '—'} · {selected.packhouse_manager ?? '—'}
                </dd>
              </div>
              {selected.order_number || selected.order_id ? (
                <div>
                  <dt className="rsk-metric__label">Order for accepted stems</dt>
                  <dd>{selected.order_number ?? 'Number assigned on sync'}</dd>
                </div>
              ) : null}
            </dl>

            <section className="rsk-stack" aria-labelledby="packhouse-lines-title">
              <h3 id="packhouse-lines-title" className="rsk-section-title">
                Varieties
              </h3>
              {selected.lines.map((line) => {
                const outcome = lineOutcome(line)
                const isCounted = line.quantity_received !== null
                const figures: Array<[string, string]> = [
                  ['Sent', formatQuantity(line.quantity_sent)],
                  ['Received', isCounted ? formatQuantity(outcome.received) : 'Not counted'],
                  ['Rejected', isCounted ? formatQuantity(outcome.rejected) : '—'],
                  ['Accepted', isCounted ? formatQuantity(outcome.accepted) : '—'],
                ]
                if (outcome.short > 0) figures.push(['Short', formatQuantity(outcome.short)])
                return (
                  <article key={line.id} className="packhouse-line">
                    <p className="packhouse-line__name">
                      {line.product_name}
                      {line.stem_length_cm ? `, ${line.stem_length_cm} cm` : ''}
                    </p>
                    <dl className="packhouse-line__figures">
                      {figures.map(([label, value]) => (
                        <div key={label}>
                          <dt className="rsk-metric__label">{label}</dt>
                          <dd className="rsk-numeric">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    {line.rejection_codes.length > 0 ? (
                      <p className="packhouse-line__reasons">
                        Reasons:{' '}
                        {line.rejection_codes
                          .map((code) => `${code} ${rejectionLabel(code)}`)
                          .join(', ')}
                      </p>
                    ) : null}
                  </article>
                )
              })}
            </section>
            {selected.notes ? <p>{selected.notes}</p> : null}
          </div>
        </Drawer>
      ) : null}

      {isCreating ? (
        <DeliveryForm
          clients={options.clients}
          products={options.products}
          today={today}
          onClose={() => setIsCreating(false)}
          onSubmit={async (values) => {
            try {
              await packhouse.create({ ...values, id: newId() })
              showToast({ tone: 'success', title: 'Delivery recorded' })
              await load()
              return {}
            } catch (cause) {
              return { error: message(cause, 'Could not record the delivery.') }
            }
          }}
        />
      ) : null}

      {intakeFor ? (
        <IntakeForm
          delivery={intakeFor}
          onClose={() => setIntakeFor(null)}
          onSubmit={async (report) => {
            try {
              await packhouse.recordIntake(intakeFor.id, report)
              showToast({ tone: 'success', title: 'Intake recorded' })
              await refreshSelected(intakeFor.id)
              return {}
            } catch (cause) {
              return { error: message(cause, 'Could not record the intake.') }
            }
          }}
        />
      ) : null}
    </div>
  )
}
