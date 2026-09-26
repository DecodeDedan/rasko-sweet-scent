'use client'

import { CalendarDays, ClipboardList, DatabaseZap, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  StatusChip,
  TabPanel,
  Table,
  Tabs,
  formatDate,
  formatDateTime,
  formatMoney,
  useToast,
} from '@rasko/ui'

import { useIdentity } from '../../auth/AuthProvider.js'
import { ScopeBadge } from '../../screens/common.js'
import type { ScreenProps } from '../../screens/common.js'
import { OrderDetailDrawer } from './OrderDetailDrawer.js'
import { OrderForm } from './OrderForm.js'
import type { OrderFormValues } from './OrderForm.js'
import { OrderSummaryDocument } from './OrderSummaryDocument.js'
import { ORDER_STATUS_LABEL } from './statusPipeline.js'
import type { OrderStatus } from './statusPipeline.js'
import type { DeliveryGroup, OrderDetail, OrderSummary } from './types.js'
import { useClientOptions, useOrderList, useOrdersRepository, useProducts } from './useOrders.js'

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  )
}

function toneFor(status: OrderStatus) {
  if (status === 'delivered' || status === 'closed') return 'success' as const
  if (status === 'cancelled') return 'danger' as const
  if (status === 'draft') return 'muted' as const
  return 'neutral' as const
}

const TABS = [
  { id: 'open', label: 'Open' },
  { id: 'deliveries', label: 'Upcoming deliveries' },
  { id: 'all', label: 'All' },
] as const

export function OrdersScreen({ role, scope }: ScreenProps) {
  const repo = useOrdersRepository()
  const identity = useIdentity()
  const products = useProducts()
  const clients = useClientOptions()
  const { showToast } = useToast()

  const [tab, setTab] = useState<string>('open')
  const [search, setSearch] = useState('')
  const { orders, isLoading, error, reload } = useOrderList({
    search,
    status: tab === 'all' ? 'all' : 'open',
  })

  const [deliveries, setDeliveries] = useState<DeliveryGroup[]>([])
  const [detailId, setDetailId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [printing, setPrinting] = useState<OrderDetail | null>(null)
  const [pendingDelete, setPendingDelete] = useState<OrderDetail | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const loadDeliveries = useCallback(async () => {
    if (!repo) return
    setDeliveries(await repo.upcomingDeliveries())
  }, [repo])

  useEffect(() => {
    if (tab === 'deliveries') void loadDeliveries()
  }, [tab, loadDeliveries])

  if (!repo) {
    return (
      <div className="rsk-stack">
        <PageHeader title="Orders" meta={<ScopeBadge scope={scope} />} />
        <Card>
          <EmptyState
            icon={<DatabaseZap size={20} aria-hidden="true" />}
            title="Local storage is not available here"
            description="Orders are stored on the device. Run the installed application to see and edit them."
          />
        </Card>
      </div>
    )
  }

  async function handleCreate(values: OrderFormValues) {
    try {
      // FR-4.1: taken_by is who took the order, which may differ from who types
      // it in later. Defaulting to the signed-in user is right for the common case.
      await repo!.create({ id: newId(), takenBy: identity.userId, ...values })
      showToast({
        tone: 'success',
        title: 'Order created',
        description: 'Saved on this device. It syncs when you are online.',
      })
      await reload()
      return {}
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Could not save the order.' }
    }
  }

  async function handleInvoice(detail: OrderDetail) {
    try {
      await repo!.convertToInvoice(detail.order.id, newId())
      showToast({
        tone: 'success',
        title: 'Draft invoice created',
        description: 'It is numbered when it is issued from the Invoices screen.',
      })
      await reload()
      // Tell the open drawer to re-read: it is showing the order as it was
      // before the invoice existed.
      setRefreshToken((n) => n + 1)
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not create the invoice',
        description: cause instanceof Error ? cause.message : 'Unknown error.',
      })
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return
    try {
      await repo!.softDelete(pendingDelete.order.id)
      showToast({ tone: 'success', title: 'Order deleted' })
      setPendingDelete(null)
      setDetailId(null)
      await reload()
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not delete the order',
        description: cause instanceof Error ? cause.message : 'Unknown error.',
      })
    }
  }

  const columns = [
    {
      key: 'number',
      header: 'Order',
      render: (o: OrderSummary) => o.order_number ?? 'Not yet numbered',
    },
    { key: 'client', header: 'Client', render: (o: OrderSummary) => o.clientName },
    {
      key: 'delivery',
      header: 'Delivery',
      render: (o: OrderSummary) => (o.delivery_at ? formatDateTime(o.delivery_at) : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      render: (o: OrderSummary) => (
        <StatusChip tone={toneFor(o.status)}>{ORDER_STATUS_LABEL[o.status]}</StatusChip>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      isNumeric: true,
      render: (o: OrderSummary) => formatMoney(o.total_cents, o.currency),
    },
  ]

  const empty = (
    <EmptyState
      icon={<ClipboardList size={20} aria-hidden="true" />}
      title={search ? 'No orders match' : 'No orders yet'}
      description={
        search
          ? 'Search by order number or client name.'
          : 'Take an order to see it here. It moves through production to delivery as you update it.'
      }
      action={
        search ? (
          <Button onClick={() => setSearch('')}>Clear search</Button>
        ) : (
          <Button variant="primary" onClick={() => setIsCreating(true)}>
            New order
          </Button>
        )
      }
    />
  )

  return (
    <div className="rsk-stack">
      <PageHeader
        title="Orders"
        description="Orders from draft through production to delivery."
        meta={<ScopeBadge scope={scope} />}
        actions={
          <Button
            variant="primary"
            leadingIcon={<Plus size={15} aria-hidden="true" />}
            onClick={() => setIsCreating(true)}
          >
            New order
          </Button>
        }
      />

      <Tabs
        items={TABS.map((t) => ({ id: t.id, label: t.label }))}
        activeId={tab}
        onChange={setTab}
        aria-label="Order views"
      />

      {tab === 'deliveries' ? (
        <TabPanel id="deliveries" activeId={tab}>
          {deliveries.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CalendarDays size={20} aria-hidden="true" />}
                title="Nothing scheduled"
                description="Orders with a delivery date appear here, grouped by the day they are due."
              />
            </Card>
          ) : (
            <div className="rsk-stack">
              {deliveries.map((group) => (
                <Card key={group.date} title={formatDate(group.date)} isFlush>
                  <Table
                    rows={group.orders}
                    getRowKey={(o) => o.id}
                    onRowSelect={(o) => setDetailId(o.id)}
                    columns={columns}
                  />
                </Card>
              ))}
            </div>
          )}
        </TabPanel>
      ) : (
        <TabPanel id={tab} activeId={tab}>
          <div className="rsk-stack">
            <Input
              placeholder="Search by order number or client"
              aria-label="Search orders"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {error ? (
              <Card>
                <p style={{ color: 'var(--rasko-danger)' }}>{error}</p>
              </Card>
            ) : null}

            {isLoading ? (
              <Card>
                <p style={{ color: 'var(--rasko-text-secondary)' }}>Loading orders.</p>
              </Card>
            ) : (
              <>
                <div className="rsk-desktop-only">
                  <Card isFlush>
                    <Table
                      rows={orders}
                      getRowKey={(o) => o.id}
                      empty={empty}
                      onRowSelect={(o) => setDetailId(o.id)}
                      columns={columns}
                    />
                  </Card>
                </div>

                <div className="rsk-mobile-only rsk-stack">
                  {orders.length === 0 ? <Card>{empty}</Card> : null}
                  {orders.map((order) => (
                    <Card key={order.id}>
                      <button
                        type="button"
                        className="client-card-button"
                        onClick={() => setDetailId(order.id)}
                      >
                        <span className="rsk-row" style={{ justifyContent: 'space-between' }}>
                          <strong>{order.order_number ?? 'Not yet numbered'}</strong>
                          <StatusChip tone={toneFor(order.status)}>
                            {ORDER_STATUS_LABEL[order.status]}
                          </StatusChip>
                        </span>
                        <span className="client-card-line">{order.clientName}</span>
                        <span className="client-card-line">
                          {order.delivery_at ? formatDateTime(order.delivery_at) : 'Not scheduled'}
                        </span>
                        <span className="client-card-line rsk-numeric">
                          {formatMoney(order.total_cents, order.currency)}
                        </span>
                      </button>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </div>
        </TabPanel>
      )}

      <OrderDetailDrawer
        orderId={detailId}
        repo={repo}
        role={role}
        refreshToken={refreshToken}
        onClose={() => setDetailId(null)}
        onChanged={() => {
          void reload()
          void loadDeliveries()
        }}
        // See the note in InvoicesScreen: a native <dialog> sits in the top
        // layer, so the drawer must close or it covers the document.
        onPrint={(detail) => {
          setDetailId(null)
          setPrinting(detail)
        }}
        onDelete={(detail) => setPendingDelete(detail)}
        onInvoice={(detail) => void handleInvoice(detail)}
      />

      <OrderForm
        isOpen={isCreating}
        onClose={() => {
          setIsCreating(false)
          void reload()
        }}
        products={products}
        clients={clients}
        onSubmit={handleCreate}
      />

      {printing ? (
        <OrderSummaryDocument
          detail={printing}
          companyName="Rasko Sweet Scent"
          onClose={() => setPrinting(null)}
        />
      ) : null}

      {pendingDelete ? (
        <Modal
          isOpen
          onClose={() => setPendingDelete(null)}
          title="Delete this order"
          size="sm"
          footer={
            <>
              <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button variant="danger" onClick={handleDelete}>
                Delete
              </Button>
            </>
          }
        >
          <p>
            {pendingDelete.order.order_number ?? 'This order'} will be hidden from lists. Its
            history is kept and the deletion is recorded in the audit log.
          </p>
        </Modal>
      ) : null}
    </div>
  )
}
