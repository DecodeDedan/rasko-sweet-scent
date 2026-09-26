'use client'

import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Field, Input, Modal, Select } from '@rasko/ui'

import {
  KENYA_BANKS,
  bankAccount,
} from '../../../../../supabase/functions/_shared/payouts/rules.js'
import type { Allowance } from './statutory.js'
import type { Employee, PaymentMethod, SalaryType } from './types.js'

function toCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN
}

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

interface DraftAllowance {
  key: string
  label: string
  amount: string
}

export interface EmployeeFormValues {
  full_name: string
  national_id: string
  kra_pin: string | null
  nssf_number: string | null
  shif_number: string | null
  phone: string | null
  position: string | null
  salary_type: SalaryType
  basic_pay_cents: number
  allowances: Allowance[]
  payment_method: PaymentMethod | null
  /** Bank account for PesaLink payouts: { bank_code, account_number, account_name }. */
  payment_details: Record<string, unknown> | null
  is_active: boolean
}

const BANK_OPTIONS = [
  { value: '', label: 'Choose a bank' },
  ...KENYA_BANKS.map((bank) => ({ value: bank.code, label: bank.name })),
]

const detail = (details: Record<string, unknown> | null | undefined, key: string) =>
  typeof details?.[key] === 'string' ? (details[key] as string) : ''

export function EmployeeForm({
  isOpen,
  onClose,
  employee,
  onSubmit,
}: {
  isOpen: boolean
  onClose: () => void
  employee?: Employee | null
  onSubmit: (values: EmployeeFormValues) => Promise<{ error?: string }>
}) {
  const isEdit = Boolean(employee)

  const [fullName, setFullName] = useState(employee?.full_name ?? '')
  const [nationalId, setNationalId] = useState(employee?.national_id ?? '')
  const [kraPin, setKraPin] = useState(employee?.kra_pin ?? '')
  const [nssf, setNssf] = useState(employee?.nssf_number ?? '')
  const [shif, setShif] = useState(employee?.shif_number ?? '')
  const [phone, setPhone] = useState(employee?.phone ?? '')
  const [position, setPosition] = useState(employee?.position ?? '')
  const [salaryType, setSalaryType] = useState<SalaryType>(employee?.salary_type ?? 'monthly')
  const [basicPay, setBasicPay] = useState(((employee?.basic_pay_cents ?? 0) / 100).toFixed(2))
  const [method, setMethod] = useState<PaymentMethod | ''>(employee?.payment_method ?? 'mpesa')
  const [bankCode, setBankCode] = useState(detail(employee?.payment_details, 'bank_code'))
  const [accountNumber, setAccountNumber] = useState(
    detail(employee?.payment_details, 'account_number'),
  )
  const [accountName, setAccountName] = useState(detail(employee?.payment_details, 'account_name'))
  const [isActive, setIsActive] = useState(employee?.is_active ?? true)
  const [allowances, setAllowances] = useState<DraftAllowance[]>(
    (employee?.allowances ?? []).map((allowance) => ({
      key: allowance.code,
      label: allowance.label,
      amount: (allowance.amount_cents / 100).toFixed(2),
    })),
  )

  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit() {
    setError(null)

    if (!fullName.trim()) return setError('Enter the employee name.')
    if (!nationalId.trim()) return setError('Enter the national ID.')

    // The employees table CHECKs this exact shape; failing here beats a sync error.
    if (phone.trim() && !/^\+254[17][0-9]{8}$/.test(phone.trim())) {
      return setError('Enter the phone as +254 followed by nine digits, for example +254712345678.')
    }

    // A bank account is optional (the owner may pay by hand), but a partial one
    // would fail at payout time, so it is all or nothing.
    const hasBankInput = Boolean(bankCode || accountNumber.trim() || accountName.trim())
    const bank =
      method === 'bank' && hasBankInput
        ? bankAccount({
            bank_code: bankCode,
            account_number: accountNumber,
            account_name: accountName,
          })
        : null
    if (method === 'bank' && hasBankInput && !bank) {
      return setError(
        'Choose the bank and enter the account number (5 to 24 letters or digits), or leave all three bank fields empty.',
      )
    }

    const payCents = toCents(basicPay)
    if (!Number.isFinite(payCents) || payCents < 0) {
      return setError(
        salaryType === 'daily' ? 'Enter a valid daily rate.' : 'Enter a valid monthly salary.',
      )
    }

    const prepared: Allowance[] = []
    for (const allowance of allowances) {
      if (!allowance.label.trim()) return setError('Every allowance needs a name.')
      const amountCents = toCents(allowance.amount)
      if (!Number.isFinite(amountCents) || amountCents < 0) {
        return setError(`Enter a valid amount for ${allowance.label}.`)
      }
      prepared.push({
        code: slugify(allowance.label) || allowance.key,
        label: allowance.label.trim(),
        amount_cents: amountCents,
      })
    }

    setIsSaving(true)
    const result = await onSubmit({
      full_name: fullName.trim(),
      national_id: nationalId.trim(),
      kra_pin: kraPin.trim() || null,
      nssf_number: nssf.trim() || null,
      shif_number: shif.trim() || null,
      phone: phone.trim() || null,
      position: position.trim() || null,
      salary_type: salaryType,
      basic_pay_cents: payCents,
      allowances: prepared,
      payment_method: method || null,
      payment_details: bank
        ? {
            bank_code: bank.bankCode,
            account_number: bank.accountNumber,
            account_name: bank.accountName ?? fullName.trim(),
          }
        : null,
      is_active: isActive,
    })
    setIsSaving(false)

    if (result.error) setError(result.error)
    else onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit employee' : 'Add employee'}
      description="Held under the Data Protection Act 2019. Visible to owner, manager and accountant only."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving' : 'Save employee'}
          </Button>
        </>
      }
    >
      <div className="rsk-stack">
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <Field label="Full name" isRequired>
          <Input value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </Field>

        <Field label="National ID" isRequired>
          <Input value={nationalId} onChange={(event) => setNationalId(event.target.value)} />
        </Field>

        <Field label="Position">
          <Input value={position} onChange={(event) => setPosition(event.target.value)} />
        </Field>

        <Field label="Phone" hint="+254 followed by nine digits.">
          <Input
            value={phone}
            inputMode="tel"
            placeholder="+254712345678"
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>

        <Field label="KRA PIN">
          <Input value={kraPin} onChange={(event) => setKraPin(event.target.value)} />
        </Field>

        <Field label="NSSF number">
          <Input value={nssf} onChange={(event) => setNssf(event.target.value)} />
        </Field>

        <Field label="SHIF number">
          <Input value={shif} onChange={(event) => setShif(event.target.value)} />
        </Field>

        <Field label="Salary type" isRequired>
          <Select
            value={salaryType}
            onChange={(event) => setSalaryType(event.target.value as SalaryType)}
            options={[
              { value: 'monthly', label: 'Monthly salary' },
              { value: 'daily', label: 'Daily rate' },
            ]}
          />
        </Field>

        <Field label={salaryType === 'daily' ? 'Daily rate' : 'Monthly salary'} isRequired>
          <Input
            value={basicPay}
            inputMode="decimal"
            onChange={(event) => setBasicPay(event.target.value)}
          />
        </Field>

        <Field label="Payment method">
          <Select
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod | '')}
            options={[
              { value: 'mpesa', label: 'M-Pesa' },
              { value: 'bank', label: 'Bank transfer' },
            ]}
          />
        </Field>

        {method === 'bank' ? (
          <>
            <Field label="Bank" hint="Needed to pay salaries by bank transfer from the app.">
              <Select
                value={bankCode}
                onChange={(event) => setBankCode(event.target.value)}
                options={BANK_OPTIONS}
              />
            </Field>
            <Field label="Account number">
              <Input
                value={accountNumber}
                inputMode="numeric"
                autoComplete="off"
                onChange={(event) => setAccountNumber(event.target.value)}
              />
            </Field>
            <Field
              label="Account name"
              hint="As the bank holds it. Leave empty to use the employee's name."
            >
              <Input
                value={accountName}
                autoComplete="off"
                onChange={(event) => setAccountName(event.target.value)}
              />
            </Field>
          </>
        ) : null}

        {allowances.map((allowance, index) => (
          <div key={allowance.key} className="rsk-stack">
            <Field label={`Allowance ${index + 1} — name`}>
              <Input
                value={allowance.label}
                placeholder="Housing"
                onChange={(event) =>
                  setAllowances((current) =>
                    current.map((candidate) =>
                      candidate.key === allowance.key
                        ? { ...candidate, label: event.target.value }
                        : candidate,
                    ),
                  )
                }
              />
            </Field>
            <Field label="Amount per month">
              <Input
                value={allowance.amount}
                inputMode="decimal"
                onChange={(event) =>
                  setAllowances((current) =>
                    current.map((candidate) =>
                      candidate.key === allowance.key
                        ? { ...candidate, amount: event.target.value }
                        : candidate,
                    ),
                  )
                }
              />
            </Field>
            <Button
              variant="ghost"
              leadingIcon={<Trash2 size={15} aria-hidden="true" />}
              onClick={() =>
                setAllowances((current) =>
                  current.filter((candidate) => candidate.key !== allowance.key),
                )
              }
            >
              Remove allowance {index + 1}
            </Button>
          </div>
        ))}

        <Button
          variant="secondary"
          onClick={() =>
            setAllowances((current) => [
              ...current,
              { key: `allowance-${current.length + 1}-${Date.now()}`, label: '', amount: '0.00' },
            ])
          }
        >
          Add allowance
        </Button>

        <Field label="Status">
          <Select
            value={isActive ? 'active' : 'inactive'}
            onChange={(event) => setIsActive(event.target.value === 'active')}
            options={[
              { value: 'active', label: 'Active — included in payroll' },
              { value: 'inactive', label: 'Inactive — excluded from payroll' },
            ]}
          />
        </Field>
      </div>
    </Modal>
  )
}
