'use client'

import { AlertTriangle, ClipboardCheck, DatabaseZap, Package, Plus } from 'lucide-react'
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
  formatDateTime,
  formatKes,
  formatQuantity,
  useToast,
} from '@rasko/ui'

import { ScopeBadge } from '../../screens/common.js'
import type { ScreenProps } from '../../screens/common.js'
import { CategoriesPanel } from './CategoriesPanel.js'
import { ProductForm } from './ProductForm.js'
import type { ProductFormValues } from './ProductForm.js'
import { StockCountSheet } from './StockCountSheet.js'
import { StockMovementForm } from './StockMovementForm.js'
import { MOVEMENT_TYPE_LABEL, PRODUCT_UNIT_LABEL, STEM_FORMS, STEM_FORM_LABEL } from './types.js'
import type { MovementType, ProductStock, StemForm, StockMovement, WastageRow } from './types.js'
import { useCategories, useProductList, useProductsRepository } from './useProducts.js'

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  )
}

type View = 'catalogue' | 'low_stock' | 'movements' | 'wastage' | 'valuation' | 'categories'

const TABS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'low_stock', label: 'Low stock' },
  { id: 'movements', label: 'Movements' },
  { id: 'wastage', label: 'Wastage' },
  { id: 'valuation', label: 'Valuation' },
  { id: 'categories', label: 'Varieties' },
]

/** FR-6.7: negative first, then low, then fine. */
function stockChip(product: ProductStock) {
  if (product.isNegative) return <StatusChip tone="danger">Negative</StatusChip>
  if (product.isLowStock) return <StatusChip tone="warning">Low stock</StatusChip>
  return <StatusChip tone="success">In stock</StatusChip>
}

export function ProductsScreen({ role, scope }: ScreenProps) {
  const repo = useProductsRepository()
  const { categories, reload: reloadCategories } = useCategories()
  const { showToast } = useToast()

  const [view, setView] = useState<View>('catalogue')
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string>('all')
  const [stemForm, setStemForm] = useState<StemForm | 'all'>('all')

  const { products, isLoading, error, reload } = useProductList({
    search,
    categoryId,
    stemForm,
    view: view === 'low_stock' ? 'low_stock' : 'catalogue',
  })

  const [movements, setMovements] = useState<StockMovement[]>([])
  const [wastage, setWastage] = useState<WastageRow[]>([])
  const [valuationTotal, setValuationTotal] = useState(0)
  const [editing, setEditing] = useState<ProductStock | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [movingStock, setMovingStock] = useState<ProductStock | null>(null)
  const [countSheet, setCountSheet] = useState<ProductStock[] | null>(null)

  const canWrite = role === 'owner' || role === 'manager'

  const loadReports = useCallback(async () => {
    if (!repo) return
    if (view === 'movements') setMovements(await repo.movementLedger({ limit: 200 }))
    if (view === 'wastage') {
      // Last 90 days: long enough to show a pattern in a perishable business.
      const to = new Date().toISOString()
      const from = new Date(Date.now() - 90 * 86_400_000).toISOString()
      setWastage(await repo.wastageReport(from, to))
    }
    if (view === 'valuation') setValuationTotal((await repo.valuation()).totalCents)
  }, [repo, view])

  useEffect(() => {
    void loadReports()
  }, [loadReports])

  if (!repo) {
    return (
      <div className="rsk-stack">
        <PageHeader title="Products" meta={<ScopeBadge scope={scope} />} />
        <Card>
          <EmptyState
            icon={<DatabaseZap size={20} aria-hidden="true" />}
            title="Local storage is not available here"
            description="Products and stock are held on the device. Run the installed application to see them."
          />
        </Card>
      </div>
    )
  }

  async function saveProduct(values: ProductFormValues) {
    try {
      if (editing) await repo!.updateProduct(editing.id, values)
      else await repo!.createProduct({ id: newId(), ...values })
      showToast({ tone: 'success', title: editing ? 'Product updated' : 'Product added' })
      await reload()
      return {}
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Could not save the product.' }
    }
  }

  async function saveMovement(values: {
    type: MovementType
    quantity: number
    reason: string | null
  }) {
    if (!movingStock) return { error: 'No product selected.' }
    try {
      await repo!.recordMovement({ id: newId(), productId: movingStock.id, ...values })
      showToast({
        tone: 'success',
        title: 'Movement recorded',
        description: 'Stock is recalculated from the ledger.',
      })
      await reload()
      await loadReports()
      return {}
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Could not record the movement.' }
    }
  }

  const catalogueColumns = [
    { key: 'sku', header: 'SKU', render: (p: ProductStock) => p.sku },
    { key: 'name', header: 'Product', render: (p: ProductStock) => p.name },
    { key: 'category', header: 'Variety', render: (p: ProductStock) => p.categoryName },
    {
      key: 'form',
      header: 'Form',
      render: (p: ProductStock) => (p.stem_form ? STEM_FORM_LABEL[p.stem_form] : 'Not set'),
    },
    {
      key: 'price',
      header: 'Price',
      isNumeric: true,
      render: (p: ProductStock) => formatKes(p.selling_price_cents),
    },
    {
      key: 'stock',
      header: 'In stock',
      isNumeric: true,
      render: (p: ProductStock) => formatQuantity(p.currentStock, p.unit),
    },
    { key: 'flag', header: 'Status', render: stockChip },
    ...(canWrite
      ? [
          {
            key: 'actions',
            header: '',
            render: (p: ProductStock) => (
              <div className="rsk-row">
                <Button size="sm" onClick={() => setMovingStock(p)}>
                  Move stock
                </Button>
                <Button size="sm" onClick={() => setEditing(p)}>
                  Edit
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ]

  const empty = (
    <EmptyState
      icon={<Package size={20} aria-hidden="true" />}
      title={search ? 'No products match' : 'No products yet'}
      description={
        search
          ? 'Search by name or SKU.'
          : categories.length === 0
            ? 'Every product belongs to a variety. Add one in Varieties, then the standard and spray stems you sell.'
            : 'Add each variety you sell as standard, spray or both, with its own price. Stock is built up from recorded movements.'
      }
      action={
        canWrite && !search ? (
          categories.length === 0 ? (
            <Button variant="primary" onClick={() => setView('categories')}>
              Add a variety
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setIsCreating(true)}>
              Add product
            </Button>
          )
        ) : null
      }
    />
  )

  return (
    <div className="rsk-stack">
      <PageHeader
        title="Products"
        description="The catalogue and current stock. Stock is the sum of recorded movements, so it always reconciles."
        meta={<ScopeBadge scope={scope} />}
        actions={
          canWrite ? (
            <>
              <Button
                leadingIcon={<ClipboardCheck size={15} aria-hidden="true" />}
                onClick={() => setCountSheet(products)}
              >
                Count sheet
              </Button>
              <Button
                variant="primary"
                leadingIcon={<Plus size={15} aria-hidden="true" />}
                disabled={categories.length === 0}
                onClick={() => setIsCreating(true)}
              >
                Add product
              </Button>
            </>
          ) : null
        }
      />

      <Tabs
        items={TABS.map((t) => ({ id: t.id, label: t.label }))}
        activeId={view}
        onChange={(id) => setView(id as View)}
        aria-label="Inventory views"
      />

      <TabPanel id={view} activeId={view}>
        <div className="rsk-stack">
          {view === 'catalogue' || view === 'low_stock' || view === 'valuation' ? (
            <div className="client-filters">
              <Input
                placeholder="Search by name or SKU"
                aria-label="Search products"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Select
                aria-label="Filter by variety"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                options={[
                  { value: 'all', label: 'All varieties' },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
              <Select
                aria-label="Filter by form"
                value={stemForm}
                onChange={(e) => setStemForm(e.target.value as StemForm | 'all')}
                options={[
                  { value: 'all', label: 'Standard and spray' },
                  ...STEM_FORMS.map((form) => ({ value: form, label: STEM_FORM_LABEL[form] })),
                ]}
              />
            </div>
          ) : null}

          {error ? (
            <Card>
              <p style={{ color: 'var(--rasko-danger)' }}>{error}</p>
            </Card>
          ) : null}

          {view === 'low_stock' ? (
            <Card isFlush>
              <Table
                rows={products}
                getRowKey={(p) => p.id}
                empty={
                  <EmptyState
                    icon={<AlertTriangle size={20} aria-hidden="true" />}
                    title="Nothing is running low"
                    description="Every product is above its own low-stock threshold."
                  />
                }
                columns={catalogueColumns}
              />
            </Card>
          ) : null}

          {view === 'catalogue' ? (
            <>
              <div className="rsk-desktop-only">
                <Card isFlush>
                  <Table
                    rows={products}
                    getRowKey={(p) => p.id}
                    empty={empty}
                    columns={catalogueColumns}
                  />
                </Card>
              </div>
              <div className="rsk-mobile-only rsk-stack">
                {products.length === 0 ? <Card>{empty}</Card> : null}
                {products.map((product) => (
                  <Card key={product.id}>
                    <div className="rsk-row" style={{ justifyContent: 'space-between' }}>
                      <strong>{product.name}</strong>
                      {stockChip(product)}
                    </div>
                    <p className="client-card-line">
                      {product.sku} · {PRODUCT_UNIT_LABEL[product.unit]}
                    </p>
                    <p className="client-card-line rsk-numeric">
                      {formatQuantity(product.currentStock, product.unit)} in stock
                    </p>
                    {canWrite ? (
                      <div className="rsk-row" style={{ marginTop: 'var(--rasko-space-2)' }}>
                        <Button size="sm" onClick={() => setMovingStock(product)}>
                          Move stock
                        </Button>
                        <Button size="sm" onClick={() => setEditing(product)}>
                          Edit
                        </Button>
                      </div>
                    ) : null}
                  </Card>
                ))}
              </div>
            </>
          ) : null}

          {view === 'movements' ? (
            <Card isFlush>
              <Table
                rows={movements}
                getRowKey={(m) => m.id}
                empty={<p className="client-empty">No movements recorded yet.</p>}
                columns={[
                  { key: 'when', header: 'When', render: (m) => formatDateTime(m.occurred_at) },
                  { key: 'product', header: 'Product', render: (m) => m.productName },
                  {
                    key: 'type',
                    header: 'Type',
                    render: (m) => (
                      <StatusChip tone={m.movement_type === 'wastage' ? 'warning' : 'neutral'}>
                        {MOVEMENT_TYPE_LABEL[m.movement_type]}
                      </StatusChip>
                    ),
                  },
                  {
                    key: 'qty',
                    header: 'Quantity',
                    isNumeric: true,
                    render: (m) => formatQuantity(m.quantity, m.unit),
                  },
                  { key: 'reason', header: 'Reason', render: (m) => m.reason ?? '—' },
                  {
                    key: 'source',
                    header: 'Source',
                    render: (m) => (m.source_table === 'manual' ? 'By hand' : m.source_table),
                  },
                ]}
              />
            </Card>
          ) : null}

          {view === 'wastage' ? (
            <Card title="Wastage, last 90 days" isFlush>
              <Table
                rows={wastage}
                getRowKey={(w) => w.productId}
                empty={<p className="client-empty">No wastage recorded in this period.</p>}
                columns={[
                  { key: 'sku', header: 'SKU', render: (w) => w.sku },
                  { key: 'name', header: 'Product', render: (w) => w.name },
                  {
                    key: 'qty',
                    header: 'Wasted',
                    isNumeric: true,
                    render: (w) => formatQuantity(w.quantity, w.unit),
                  },
                  {
                    key: 'times',
                    header: 'Occurrences',
                    isNumeric: true,
                    render: (w) => String(w.occurrences),
                  },
                  {
                    key: 'cost',
                    header: 'Cost',
                    isNumeric: true,
                    render: (w) => formatKes(w.costCents),
                  },
                ]}
              />
            </Card>
          ) : null}

          {view === 'valuation' ? (
            <>
              <Card>
                <p className="shell__stat-label">Stock at cost</p>
                <p className="shell__stat-value">{formatKes(valuationTotal)}</p>
                <p className="shell__stat-note">
                  Quantity times cost price, for every product holding stock.
                </p>
              </Card>
              <Card isFlush>
                <Table
                  rows={products.filter((p) => p.currentStock !== 0)}
                  getRowKey={(p) => p.id}
                  empty={<p className="client-empty">No stock on hand.</p>}
                  columns={[
                    { key: 'sku', header: 'SKU', render: (p) => p.sku },
                    { key: 'name', header: 'Product', render: (p) => p.name },
                    {
                      key: 'stock',
                      header: 'In stock',
                      isNumeric: true,
                      render: (p) => formatQuantity(p.currentStock, p.unit),
                    },
                    {
                      key: 'cost',
                      header: 'Cost each',
                      isNumeric: true,
                      render: (p) => formatKes(p.cost_price_cents),
                    },
                    {
                      key: 'value',
                      header: 'Value',
                      isNumeric: true,
                      render: (p) => formatKes(p.valuationCents),
                    },
                  ]}
                />
              </Card>
            </>
          ) : null}

          {view === 'categories' ? (
            <CategoriesPanel
              repo={repo}
              categories={categories}
              canWrite={canWrite}
              newId={newId}
              onChanged={async () => {
                await reloadCategories()
                await reload()
              }}
            />
          ) : null}

          {isLoading && view !== 'categories' ? (
            <Card>
              <p style={{ color: 'var(--rasko-text-secondary)' }}>Loading.</p>
            </Card>
          ) : null}
        </div>
      </TabPanel>

      <ProductForm
        isOpen={isCreating || editing !== null}
        product={editing}
        categories={categories}
        onClose={() => {
          setIsCreating(false)
          setEditing(null)
        }}
        onSubmit={saveProduct}
      />

      {movingStock ? (
        <StockMovementForm
          isOpen
          product={movingStock}
          onClose={() => setMovingStock(null)}
          onSubmit={saveMovement}
        />
      ) : null}

      {countSheet ? (
        <StockCountSheet
          products={countSheet}
          companyName="Rasko Sweet Scent"
          onClose={() => setCountSheet(null)}
        />
      ) : null}
    </div>
  )
}
