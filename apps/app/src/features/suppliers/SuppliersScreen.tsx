'use client'

import { DatabaseZap, PackageCheck, Plus, Receipt, Truck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  StatusChip,
  TabPanel,
  Table,
  Tabs,
  formatDate,
  formatKes,
  formatPhone,
  useToast,
} from '@rasko/ui'

import { ScopeBadge } from '../../screens/common.js'
import type { ScreenProps } from '../../screens/common.js'
import { PurchaseForm } from './PurchaseForm.js'
import type { ProductOption } from './PurchaseForm.js'
import { SupplierForm } from './SupplierForm.js'
import type { SupplierFormValues } from './SupplierForm.js'
import { SupplierPaymentForm } from './SupplierPaymentForm.js'
import { canWriteSuppliers, nextPurchaseStatuses } from './types.js'
import type { AgingBucket, PurchaseStatus, PurchaseSummary, SupplierSummary } from './types.js'
import { usePurchaseList, useSupplierList, useSuppliersRepository } from './useSuppliers.js'

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  )
}

type View = 'suppliers' | 'purchases' | 'payables'

const TABS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'purchases', label: 'Purchases' },
  { id: 'payables', label: 'Payables' },
]

function statusChip(purchase: PurchaseSummary) {
  if (purchase.status === 'paid') return <StatusChip tone="success">Paid</StatusChip>
  if (purchase.daysOverdue > 0) {
    return <StatusChip tone="danger">{purchase.daysOverdue} days overdue</StatusChip>
  }
  if (purchase.status === 'received') return <StatusChip tone="warning">Received</StatusChip>
  return <StatusChip tone="neutral">Ordered</StatusChip>
}

export function SuppliersScreen({ role, scope }: ScreenProps) {
  const repo = useSuppliersRepository()
  const { showToast } = useToast()

  const [view, setView] = useState<View>('suppliers')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<PurchaseStatus | 'all'>('all')

  const { suppliers, error: supplierError, reload: reloadSuppliers } = useSupplierList({ search })
  const {
    purchases,
    error: purchaseError,
    reload: reloadPurchases,
  } = usePurchaseList({ search, status })

  const [aging, setAging] = useState<AgingBucket[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [editing, setEditing] = useState<SupplierSummary | null>(null)
  const [isAddingSupplier, setIsAddingSupplier] = useState(false)
  const [isAddingPurchase, setIsAddingPurchase] = useState(false)
  const [payingFor, setPayingFor] = useState<PurchaseSummary | null>(null)

  const canWrite = canWriteSuppliers(role)
  // supplier_payments_insert admits the accountant, unlike every other write here.
  const canPay = role === 'owner' || role === 'manager' || role === 'accountant'

  const [loadError, setLoadError] = useState<string | null>(null)

  const loadAging = useCallback(async () => {
    if (!repo || view !== 'payables') return
    try {
      setAging(await repo.payablesAging())
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not build the payables report.')
    }
  }, [repo, view])

  useEffect(() => {
    void loadAging()
  }, [loadAging])

  useEffect(() => {
    if (!repo) return
    let cancelled = false
    repo
      .products()
      .then((rows) => {
        if (!cancelled) setProducts(rows)
      })
      .catch((cause: unknown) => {
        // Without this the catalogue silently stays empty and "Record purchase"
        // sits disabled with nothing telling anyone why.
        if (!cancelled) {
          setLoadError(cause instanceof Error ? cause.message : 'Could not read the catalogue.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [repo])

  if (!repo) {
    return (
      <div className="rsk-stack">
        <PageHeader title="Suppliers" meta={<ScopeBadge scope={scope} />} />
        <Card>
          <EmptyState
            icon={<DatabaseZap size={20} aria-hidden="true" />}
            title="Local storage is not available here"
            description="Suppliers and purchases are held on the device. Run the installed application to see them."
          />
        </Card>
      </div>
    )
  }

  async function reloadAll() {
    await Promise.all([reloadSuppliers(), reloadPurchases()])
    await loadAging()
  }

  async function saveSupplier(values: SupplierFormValues) {
    try {
      if (editing) await repo!.updateSupplier(editing.id, values)
      else await repo!.createSupplier({ id: newId(), ...values })
      showToast({ tone: 'success', title: editing ? 'Supplier updated' : 'Supplier added' })
      await reloadAll()
      return {}
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Could not save the supplier.' }
    }
  }

  async function savePurchase(input: {
    supplierId: string
    purchaseDate: string
    dueDate: string
    lines: Array<{ productId: string; quantity: number; unitCostCents: number }>
  }) {
    try {
      await repo!.createPurchase({ id: newId(), ...input })
      showToast({
        tone: 'success',
        title: 'Purchase recorded',
        description: 'Confirm receipt when the delivery arrives to move it into stock.',
      })
      await reloadAll()
      return {}
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Could not save the purchase.' }
    }
  }

  async function move(purchase: PurchaseSummary, to: PurchaseStatus) {
    try {
      await repo!.transition(purchase.id, to)
      showToast({
        tone: 'success',
        title: to === 'received' ? 'Received into stock' : 'Marked paid',
        ...(to === 'received'
          ? { description: 'Stock movements are written by the server on the next sync.' }
          : {}),
      })
      await reloadAll()
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not update the purchase',
        ...(cause instanceof Error ? { description: cause.message } : {}),
      })
    }
  }

  async function recordPayment(values: {
    amountCents: number
    method: 'mpesa' | 'cash' | 'bank_transfer' | 'cheque'
    reference: string | null
    paidAt: string
  }) {
    if (!payingFor) return { error: 'No purchase selected.' }
    try {
      await repo!.recordPayment({ id: newId(), purchaseId: payingFor.id, ...values })
      showToast({ tone: 'success', title: 'Payment recorded' })
      await reloadAll()
      return {}
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Could not record the payment.' }
    }
  }

  const error = loadError ?? (view === 'suppliers' ? supplierError : purchaseError)

  return (
    <div className="rsk-stack">
      <PageHeader
        title="Suppliers"
        description="Who the business buys from, what is owed, and when purchases were received into stock."
        meta={<ScopeBadge scope={scope} />}
        actions={
          canWrite ? (
            <>
              <Button
                variant="secondary"
                leadingIcon={<Receipt size={15} aria-hidden="true" />}
                onClick={() => setIsAddingPurchase(true)}
                disabled={suppliers.length === 0 || products.length === 0}
              >
                Record purchase
              </Button>
              <Button
                variant="primary"
                leadingIcon={<Plus size={15} aria-hidden="true" />}
                onClick={() => setIsAddingSupplier(true)}
              >
                Add supplier
              </Button>
            </>
          ) : null
        }
      />

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <Tabs
        items={TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
        activeId={view}
        onChange={(id) => setView(id as View)}
      />

      <Input
        value={search}
        placeholder={view === 'suppliers' ? 'Search suppliers' : 'Search purchases'}
        onChange={(event) => setSearch(event.target.value)}
        aria-label="Search"
      />

      <TabPanel id="suppliers" activeId={view}>
        <Card isFlush>
          <Table
            rows={suppliers}
            getRowKey={(supplier) => supplier.id}
            empty={
              <EmptyState
                icon={<Truck size={20} aria-hidden="true" />}
                title="No suppliers yet"
                description="Add the farms and vendors you buy from. Purchases only affect stock once you confirm they were received."
                action={
                  canWrite ? (
                    <Button variant="primary" onClick={() => setIsAddingSupplier(true)}>
                      Add supplier
                    </Button>
                  ) : undefined
                }
              />
            }
            columns={[
              { key: 'name', header: 'Supplier', render: (supplier) => supplier.name },
              {
                key: 'contact',
                header: 'Contact',
                render: (supplier) => supplier.contact_person ?? '—',
              },
              {
                key: 'phone',
                header: 'Phone',
                render: (supplier) => (supplier.phone ? formatPhone(supplier.phone) : '—'),
              },
              {
                key: 'terms',
                header: 'Terms',
                isNumeric: true,
                render: (supplier) => `${supplier.payment_terms_days} days`,
              },
              {
                key: 'payable',
                header: 'Owed',
                isNumeric: true,
                render: (supplier) => formatKes(supplier.payableCents),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (supplier) =>
                  canWrite ? (
                    <Button variant="ghost" onClick={() => setEditing(supplier)}>
                      Edit
                    </Button>
                  ) : null,
              },
            ]}
          />
        </Card>
      </TabPanel>

      <TabPanel id="purchases" activeId={view}>
        <div className="rsk-stack">
          <Select
            value={status}
            aria-label="Filter by status"
            onChange={(event) => setStatus(event.target.value as PurchaseStatus | 'all')}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'ordered', label: 'Ordered' },
              { value: 'received', label: 'Received' },
              { value: 'paid', label: 'Paid' },
            ]}
          />

          <Card isFlush>
            <Table
              rows={purchases}
              getRowKey={(purchase) => purchase.id}
              empty={
                <EmptyState
                  icon={<PackageCheck size={20} aria-hidden="true" />}
                  title="No purchases recorded"
                  description="Record what you buy so stock and payables stay accurate. Stock moves only on receipt."
                  action={
                    canWrite && suppliers.length > 0 ? (
                      <Button variant="primary" onClick={() => setIsAddingPurchase(true)}>
                        Record purchase
                      </Button>
                    ) : undefined
                  }
                />
              }
              columns={[
                {
                  key: 'number',
                  header: 'Purchase',
                  render: (purchase) => purchase.purchase_number ?? 'Awaiting number',
                },
                {
                  key: 'supplier',
                  header: 'Supplier',
                  render: (purchase) => purchase.supplierName,
                },
                {
                  key: 'date',
                  header: 'Date',
                  render: (purchase) => formatDate(purchase.purchase_date),
                },
                { key: 'status', header: 'Status', render: statusChip },
                {
                  key: 'total',
                  header: 'Total',
                  isNumeric: true,
                  render: (purchase) => formatKes(purchase.total_cents),
                },
                {
                  key: 'balance',
                  header: 'Owed',
                  isNumeric: true,
                  render: (purchase) => formatKes(purchase.balanceCents),
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (purchase) => {
                    const next = nextPurchaseStatuses(purchase.status)[0]
                    return (
                      <>
                        {canWrite && next ? (
                          <Button variant="ghost" onClick={() => void move(purchase, next)}>
                            {next === 'received' ? 'Confirm received' : 'Mark paid'}
                          </Button>
                        ) : null}
                        {canPay && purchase.balanceCents > 0 && purchase.status !== 'ordered' ? (
                          <Button variant="ghost" onClick={() => setPayingFor(purchase)}>
                            Record payment
                          </Button>
                        ) : null}
                      </>
                    )
                  },
                },
              ]}
            />
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="payables" activeId={view}>
        <Card isFlush>
          <Table
            rows={aging}
            getRowKey={(bucket) => bucket.label}
            empty={
              <EmptyState
                icon={<Receipt size={20} aria-hidden="true" />}
                title="Nothing is owed"
                description="Every purchase recorded has been paid in full."
              />
            }
            columns={[
              { key: 'label', header: 'Age', render: (bucket) => bucket.label },
              {
                key: 'count',
                header: 'Purchases',
                isNumeric: true,
                render: (bucket) => String(bucket.purchaseCount),
              },
              {
                key: 'amount',
                header: 'Owed',
                isNumeric: true,
                render: (bucket) => formatKes(bucket.amountCents),
              },
            ]}
          />
        </Card>
      </TabPanel>

      {isAddingSupplier || editing ? (
        <SupplierForm
          isOpen
          supplier={editing}
          onClose={() => {
            setIsAddingSupplier(false)
            setEditing(null)
          }}
          onSubmit={saveSupplier}
        />
      ) : null}

      {isAddingPurchase ? (
        <PurchaseForm
          isOpen
          suppliers={suppliers}
          products={products}
          onClose={() => setIsAddingPurchase(false)}
          onSubmit={savePurchase}
        />
      ) : null}

      {payingFor ? (
        <SupplierPaymentForm
          isOpen
          purchase={payingFor}
          onClose={() => setPayingFor(null)}
          onSubmit={recordPayment}
        />
      ) : null}
    </div>
  )
}
