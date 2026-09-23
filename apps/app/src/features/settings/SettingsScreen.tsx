'use client'

import { DatabaseZap } from 'lucide-react'
import { useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  StatusChip,
  TabPanel,
  Table,
  Tabs,
  formatDateTime,
  useToast,
} from '@rasko/ui'

import { ScopeBadge } from '../../screens/common.js'
import type { ScreenProps } from '../../screens/common.js'
import { canEditCompanyProfile, canEditSettings } from './settingsRepository.js'
import { useSettingsData } from './useSettings.js'

const APP_VERSION = '0.1.0'

type View = 'company' | 'tax' | 'statutory' | 'system'

const TABS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'company', label: 'Company' },
  { id: 'tax', label: 'Tax' },
  { id: 'statutory', label: 'Statutory rates' },
  { id: 'system', label: 'System' },
]

const RATE_LABEL: Record<string, string> = {
  paye: 'PAYE',
  nssf: 'NSSF',
  shif: 'SHIF',
  housing_levy: 'Housing Levy',
}

export function SettingsScreen({ role, scope }: ScreenProps) {
  const { repo, profile, tax, rates, status, error, reload } = useSettingsData()
  const { showToast } = useToast()

  const [view, setView] = useState<View>('company')
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [companyName, setCompanyName] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [phone, setPhone] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [kraPin, setKraPin] = useState<string | null>(null)
  const [paybill, setPaybill] = useState<string | null>(null)
  const [till, setTill] = useState<string | null>(null)
  const [bankName, setBankName] = useState<string | null>(null)
  const [bankAccount, setBankAccount] = useState<string | null>(null)

  const canEditProfile = canEditCompanyProfile(role)
  const canEditAll = canEditSettings(role)

  if (!repo) {
    return (
      <div className="rsk-stack">
        <PageHeader title="Settings" meta={<ScopeBadge scope={scope} />} />
        <Card>
          <EmptyState
            icon={<DatabaseZap size={20} aria-hidden="true" />}
            title="Local storage is not available here"
            description="Settings are held on the device. Run the installed application to change them."
          />
        </Card>
      </div>
    )
  }

  // Controlled inputs fall back to the stored value until the user edits one,
  // so the form reflects a sync that lands while the screen is open.
  const value = (local: string | null, stored: string | null | undefined) => local ?? stored ?? ''

  async function saveProfile() {
    setFormError(null)
    setIsSaving(true)
    try {
      const bank =
        (bankName ?? profile?.bank_details?.['Bank'])
          ? {
              Bank: value(bankName, profile?.bank_details?.['Bank'] ?? null),
              Account: value(bankAccount, profile?.bank_details?.['Account'] ?? null),
            }
          : null

      await repo!.updateCompanyProfile({
        company_name: value(companyName, profile?.company_name),
        address: value(address, profile?.address) || null,
        phone: value(phone, profile?.phone) || null,
        email: value(email, profile?.email) || null,
        kra_pin: value(kraPin, profile?.kra_pin) || null,
        mpesa_paybill: value(paybill, profile?.mpesa_paybill) || null,
        mpesa_till: value(till, profile?.mpesa_till) || null,
        bank_details: bank,
      })
      showToast({ tone: 'success', title: 'Company profile saved' })
      await reload()
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not save the profile.')
    } finally {
      setIsSaving(false)
    }
  }

  async function setVatRegistered(registered: boolean) {
    try {
      await repo!.updateCompanyProfile({ is_vat_registered: registered })
      showToast({
        tone: 'success',
        title: registered ? 'Marked VAT registered' : 'VAT registration removed',
      })
      await reload()
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not update registration',
        ...(cause instanceof Error ? { description: cause.message } : {}),
      })
    }
  }

  async function setVatEnabled(enabled: boolean) {
    try {
      await repo!.updateTaxConfig({ is_vat_enabled: enabled })
      showToast({
        tone: 'success',
        title: enabled ? 'VAT is now charged on invoices' : 'VAT is no longer charged',
      })
      await reload()
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not change VAT',
        ...(cause instanceof Error ? { description: cause.message } : {}),
      })
    }
  }

  async function setDeductionPoint(point: 'order_confirmed' | 'delivered') {
    try {
      await repo!.updateCompanyProfile({ stock_deduction_point: point })
      showToast({ tone: 'success', title: 'Stock deduction point updated' })
      await reload()
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not update the setting',
        ...(cause instanceof Error ? { description: cause.message } : {}),
      })
    }
  }

  return (
    <div className="rsk-stack">
      <PageHeader
        title="Settings"
        description="Company details, tax, statutory rates and this device."
        meta={<ScopeBadge scope={scope} />}
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

      <TabPanel id="company" activeId={view}>
        <Card>
          <div className="rsk-stack">
            {formError ? (
              <p className="auth-error" role="alert">
                {formError}
              </p>
            ) : null}

            <p>
              These details print on every invoice, receipt and payslip. Payment instructions come
              from the M-Pesa and bank fields below.
            </p>

            <Field label="Company name" isRequired>
              <Input
                value={value(companyName, profile?.company_name)}
                disabled={!canEditProfile}
                onChange={(event) => setCompanyName(event.target.value)}
              />
            </Field>

            <Field label="Address">
              <Input
                value={value(address, profile?.address)}
                disabled={!canEditProfile}
                onChange={(event) => setAddress(event.target.value)}
              />
            </Field>

            <Field label="Phone" hint="+254 followed by nine digits.">
              <Input
                value={value(phone, profile?.phone)}
                disabled={!canEditProfile}
                placeholder="+254712345678"
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>

            <Field label="Email">
              <Input
                value={value(email, profile?.email)}
                disabled={!canEditProfile}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>

            <Field
              label="KRA PIN"
              hint="Printed on invoices, and required before VAT can be enabled."
            >
              <Input
                value={value(kraPin, profile?.kra_pin)}
                disabled={!canEditProfile}
                onChange={(event) => setKraPin(event.target.value)}
              />
            </Field>

            <Field label="M-Pesa paybill">
              <Input
                value={value(paybill, profile?.mpesa_paybill)}
                disabled={!canEditProfile}
                onChange={(event) => setPaybill(event.target.value)}
              />
            </Field>

            <Field label="M-Pesa till">
              <Input
                value={value(till, profile?.mpesa_till)}
                disabled={!canEditProfile}
                onChange={(event) => setTill(event.target.value)}
              />
            </Field>

            <Field label="Bank name">
              <Input
                value={value(bankName, profile?.bank_details?.['Bank'] ?? null)}
                disabled={!canEditProfile}
                onChange={(event) => setBankName(event.target.value)}
              />
            </Field>

            <Field label="Bank account number">
              <Input
                value={value(bankAccount, profile?.bank_details?.['Account'] ?? null)}
                disabled={!canEditProfile}
                onChange={(event) => setBankAccount(event.target.value)}
              />
            </Field>

            {canEditProfile ? (
              <Button variant="primary" onClick={saveProfile} disabled={isSaving}>
                {isSaving ? 'Saving' : 'Save company profile'}
              </Button>
            ) : null}
          </div>
        </Card>
      </TabPanel>

      <TabPanel id="tax" activeId={view}>
        <Card>
          <div className="rsk-stack">
            <p>
              VAT is off until the business is registered. Charging VAT you are not registered to
              collect has to be refunded to every customer, so the switch below will not move until
              registration and a KRA PIN are both recorded on the company profile.
            </p>

            <Field label="VAT registration status">
              <Select
                value={profile?.is_vat_registered ? 'yes' : 'no'}
                disabled={!canEditProfile}
                onChange={(event) => void setVatRegistered(event.target.value === 'yes')}
                options={[
                  { value: 'no', label: 'Not VAT registered' },
                  { value: 'yes', label: 'VAT registered with KRA' },
                ]}
              />
            </Field>

            <Field
              label="Charge VAT on invoices"
              hint={
                profile?.is_vat_registered
                  ? 'Applies to invoices created from now on.'
                  : 'Mark the business VAT registered first.'
              }
            >
              <Select
                value={tax?.is_vat_enabled ? 'yes' : 'no'}
                disabled={!canEditAll}
                onChange={(event) => void setVatEnabled(event.target.value === 'yes')}
                options={[
                  { value: 'no', label: 'No — invoices show no VAT line' },
                  { value: 'yes', label: 'Yes — add VAT to invoices' },
                ]}
              />
            </Field>

            <Field label="VAT rate">
              <Input
                value={tax ? `${(tax.vat_rate_bp / 100).toFixed(0)}%` : ''}
                disabled
                readOnly
              />
            </Field>

            <Field
              label="Deduct stock at"
              hint="Delivery is recommended: current stock then means what is physically in the store."
            >
              <Select
                value={profile?.stock_deduction_point ?? 'delivered'}
                disabled={!canEditAll}
                onChange={(event) =>
                  void setDeductionPoint(event.target.value as 'order_confirmed' | 'delivered')
                }
                options={[
                  { value: 'delivered', label: 'Delivery' },
                  { value: 'order_confirmed', label: 'Order confirmation' },
                ]}
              />
            </Field>
          </div>
        </Card>
      </TabPanel>

      <TabPanel id="statutory" activeId={view}>
        <Card isFlush>
          <Table
            rows={rates}
            getRowKey={(rate) => rate.id}
            caption="Statutory rates in force"
            empty={
              <EmptyState
                title="No statutory rates"
                description="Payroll cannot run until PAYE, NSSF, SHIF and the Housing Levy are configured."
              />
            }
            columns={[
              {
                key: 'kind',
                header: 'Scheme',
                render: (rate) => RATE_LABEL[rate.kind] ?? rate.kind,
              },
              { key: 'from', header: 'Effective from', render: (rate) => rate.effective_from },
              {
                key: 'to',
                header: 'Until',
                render: (rate) =>
                  rate.effective_to ? (
                    rate.effective_to
                  ) : (
                    <StatusChip tone="success">Current</StatusChip>
                  ),
              },
            ]}
          />
        </Card>
        <p>
          A rate change is recorded as a new row with its own effective date, never an edit. Editing
          one in place would change every payslip already issued against it.
        </p>
      </TabPanel>

      <TabPanel id="system" activeId={view}>
        <Card>
          <div className="rsk-stack">
            <Field label="Application version">
              <Input value={APP_VERSION} disabled readOnly />
            </Field>

            <Field
              label="Last synced"
              hint="The last moment this device is known to have been in step with the server."
            >
              <Input
                value={status?.lastSyncedAt ? formatDateTime(status.lastSyncedAt) : 'Never'}
                disabled
                readOnly
              />
            </Field>

            <Field label="Waiting to sync">
              <Input value={`${status?.pendingWrites ?? 0} changes`} disabled readOnly />
            </Field>

            {status && status.failedWrites > 0 ? (
              <p className="auth-error" role="alert">
                {status.failedWrites} changes could not be sent and need attention.
              </p>
            ) : null}

            <Field label="Records held on this device">
              <Input value={String(status?.deviceRows ?? 0)} disabled readOnly />
            </Field>

            <p>
              Automatic updates are not enabled in this build. Backups run on the server, not from
              this device.
            </p>
          </div>
        </Card>
      </TabPanel>
    </div>
  )
}
