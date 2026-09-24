'use client'

import { AlertTriangle, DatabaseZap, Download } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatusChip,
  Table,
  formatKes,
  formatQuantity,
  useToast,
} from '@rasko/ui'

import { useIdentity } from '../../auth/AuthProvider.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { useSyncedEffect } from '../../data/sync/useSyncedEffect.js'
import { ScopeBadge } from '../../screens/common.js'
import { SetupChecklist } from '../../onboarding/SetupChecklist.js'
import type { ScreenProps } from '../../screens/common.js'
import { DashboardRepository, toCsv } from './dashboardRepository.js'
import type {
  AgingBucket,
  DailySummary,
  RankedClient,
  RankedProduct,
  StockAlert,
  TrendPoint,
  WastageAlert,
} from './dashboardRepository.js'
import { SalesTrendChart } from './SalesTrendChart.js'

/** FR-2.7. A Blob download is the whole feature — no library, works offline. */
function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

interface DashboardData {
  summary: DailySummary
  trend: TrendPoint[]
  clients: RankedClient[]
  products: RankedProduct[]
  aging: AgingBucket[]
  payablesCents: number
  lowStock: StockAlert[]
  wastage: WastageAlert
}

export function DashboardScreen({ role, scope }: ScreenProps) {
  const { db } = useSync()
  const identity = useIdentity()
  const { showToast } = useToast()

  const repo = useMemo(
    () => (db ? new DashboardRepository(db, identity.role, identity.userId) : null),
    [db, identity.role, identity.userId],
  )

  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Sales never see payables or payroll, so those queries are not even run.
  const seesFinance = role !== 'sales'

  const load = useCallback(async () => {
    if (!repo) return
    try {
      setError(null)
      const [summary, trend, clients, products, aging, payablesCents, lowStock, wastage] =
        await Promise.all([
          repo.dailySummary(),
          repo.salesTrend(30),
          repo.topClients(5),
          repo.topProducts(5),
          repo.receivablesAging(),
          seesFinance ? repo.payablesTotalCents() : Promise.resolve(0),
          seesFinance ? repo.lowStockAlerts() : Promise.resolve([]),
          seesFinance
            ? repo.wastageAlert()
            : Promise.resolve({ totalCostCents: 0, occurrences: 0, topProduct: null }),
        ])
      setData({ summary, trend, clients, products, aging, payablesCents, lowStock, wastage })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not build the dashboard.')
    }
  }, [repo, seesFinance])

  useSyncedEffect(load)

  if (!repo) {
    return (
      <div className="rsk-stack">
        <PageHeader title="Dashboard" meta={<ScopeBadge scope={scope} />} />
        <Card>
          <EmptyState
            icon={<DatabaseZap size={20} aria-hidden="true" />}
            title="Local storage is not available here"
            description="The dashboard is built from the device database. Run the installed application to see it."
          />
        </Card>
      </div>
    )
  }

  function exportTrend() {
    if (!data) return
    downloadCsv(
      `rasko-sales-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ['Date', 'Orders', 'Sales (KES)'],
        data.trend.map((point) => [
          point.date,
          point.orderCount,
          (point.salesCents / 100).toFixed(2),
        ]),
      ),
    )
    showToast({ tone: 'success', title: 'Sales report downloaded' })
  }

  function exportAging() {
    if (!data) return
    downloadCsv(
      `rasko-receivables-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ['Age', 'Invoices', 'Outstanding (KES)'],
        data.aging.map((bucket) => [
          bucket.label,
          bucket.invoiceCount,
          (bucket.amountCents / 100).toFixed(2),
        ]),
      ),
    )
    showToast({ tone: 'success', title: 'Receivables report downloaded' })
  }

  const summary = data?.summary

  return (
    <div className="rsk-stack">
      <PageHeader
        title="Dashboard"
        description={
          role === 'sales'
            ? 'Your own orders, clients and receivables.'
            : 'Today at a glance, and where the money is.'
        }
        meta={<ScopeBadge scope={scope} />}
        actions={
          <>
            <Button
              leadingIcon={<Download size={15} aria-hidden="true" />}
              onClick={exportTrend}
              disabled={!data}
            >
              Export sales
            </Button>
            <Button variant="primary" onClick={() => window.print()} disabled={!data}>
              Print or save as PDF
            </Button>
          </>
        }
      />

      <SetupChecklist role={role} />

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      {/* FR-2.1 */}
      <div className="rsk-metrics">
        <Card>
          <p className="rsk-metric__label">Sales today</p>
          <p className="rsk-metric__value rsk-numeric">{formatKes(summary?.salesCents ?? 0)}</p>
        </Card>
        <Card>
          <p className="rsk-metric__label">Orders today</p>
          <p className="rsk-metric__value rsk-numeric">{summary?.orderCount ?? 0}</p>
        </Card>
        <Card>
          <p className="rsk-metric__label">Payments received</p>
          <p className="rsk-metric__value rsk-numeric">
            {formatKes(summary?.paymentsReceivedCents ?? 0)}
          </p>
        </Card>
        <Card>
          <p className="rsk-metric__label">Owed to us</p>
          <p className="rsk-metric__value rsk-numeric">
            {formatKes(summary?.outstandingReceivablesCents ?? 0)}
          </p>
        </Card>
      </div>

      {/* FR-2.2 */}
      <Card>
        <h2 className="rsk-section-title">Sales, last 30 days</h2>
        {data ? <SalesTrendChart points={data.trend} /> : null}
      </Card>

      {/* FR-2.4 */}
      <Card isFlush>
        <Table
          rows={data?.aging ?? []}
          getRowKey={(bucket) => bucket.label}
          caption="Receivables aging"
          empty={
            <EmptyState
              title="Nothing outstanding"
              description="Every issued invoice has been paid in full."
            />
          }
          columns={[
            { key: 'label', header: 'Age', render: (bucket) => bucket.label },
            {
              key: 'count',
              header: 'Invoices',
              isNumeric: true,
              render: (bucket) => String(bucket.invoiceCount),
            },
            {
              key: 'amount',
              header: 'Outstanding',
              isNumeric: true,
              render: (bucket) => formatKes(bucket.amountCents),
            },
          ]}
        />
        <div className="rsk-no-print" style={{ padding: '0.75rem' }}>
          <Button onClick={exportAging} disabled={!data}>
            Export receivables
          </Button>
        </div>
      </Card>

      {/* FR-2.3 */}
      <Card isFlush>
        <Table
          rows={data?.clients ?? []}
          getRowKey={(client) => client.id}
          caption="Top clients this month"
          empty={
            <EmptyState
              title="No orders this month"
              description="Top clients appear once orders are recorded."
            />
          }
          columns={[
            { key: 'name', header: 'Client', render: (client) => client.name },
            {
              key: 'orders',
              header: 'Orders',
              isNumeric: true,
              render: (client) => String(client.orderCount),
            },
            {
              key: 'total',
              header: 'Value',
              isNumeric: true,
              render: (client) => formatKes(client.totalCents),
            },
          ]}
        />
      </Card>

      <Card isFlush>
        <Table
          rows={data?.products ?? []}
          getRowKey={(product) => product.id}
          caption="Top products this month"
          empty={
            <EmptyState
              title="No products sold this month"
              description="Top products appear once orders with catalogue lines are recorded."
            />
          }
          columns={[
            { key: 'name', header: 'Product', render: (product) => product.name },
            {
              key: 'quantity',
              header: 'Quantity',
              isNumeric: true,
              render: (product) => formatQuantity(product.quantity),
            },
            {
              key: 'total',
              header: 'Value',
              isNumeric: true,
              render: (product) => formatKes(product.totalCents),
            },
          ]}
        />
      </Card>

      {seesFinance ? (
        <>
          {/* FR-2.5 */}
          <Card>
            <p className="rsk-metric__label">Owed to suppliers</p>
            <p className="rsk-metric__value rsk-numeric">{formatKes(data?.payablesCents ?? 0)}</p>
          </Card>

          {/* FR-2.6 */}
          <Card isFlush>
            <Table
              rows={data?.lowStock ?? []}
              getRowKey={(alert) => alert.id}
              caption="Low stock"
              empty={
                <EmptyState
                  title="Stock is healthy"
                  description="No product is at or below its low-stock threshold."
                />
              }
              columns={[
                { key: 'name', header: 'Product', render: (alert) => alert.name },
                {
                  key: 'stock',
                  header: 'In stock',
                  isNumeric: true,
                  render: (alert) => formatQuantity(alert.currentStock),
                },
                {
                  key: 'threshold',
                  header: 'Threshold',
                  isNumeric: true,
                  render: (alert) => formatQuantity(alert.threshold),
                },
                {
                  key: 'state',
                  header: 'State',
                  render: (alert) =>
                    alert.isNegative ? (
                      <StatusChip tone="danger">Negative</StatusChip>
                    ) : (
                      <StatusChip tone="warning">Low</StatusChip>
                    ),
                },
              ]}
            />
          </Card>

          {data && data.wastage.occurrences > 0 ? (
            <Card>
              <p className="rsk-metric__label">
                <AlertTriangle size={14} aria-hidden="true" /> Wastage, last 30 days
              </p>
              <p className="rsk-metric__value rsk-numeric">
                {formatKes(data.wastage.totalCostCents)}
              </p>
              <p>
                {data.wastage.occurrences} entries
                {data.wastage.topProduct ? `, most of it ${data.wastage.topProduct}` : ''}.
              </p>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
