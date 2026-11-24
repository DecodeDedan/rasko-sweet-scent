'use client'

import { useState } from 'react'
import { Button, Field, Input, Modal, formatQuantity } from '@rasko/ui'

import { REJECTION_CODE_NUMBERS, rejectionLabel } from './types.js'
import type { DeliveryDetail, IntakeReport } from './types.js'

interface Props {
  delivery: DeliveryDetail
  onClose: () => void
  onSubmit: (report: IntakeReport) => Promise<{ error?: string }>
}

interface DraftIntake {
  received: string
  primary: string
  secondary: string
  codes: string
}

/** "3, 16" or "3 16" -> [3, 16]. Anything that is not a whole number is reported. */
function parseCodes(input: string): number[] | null {
  const parts = input.split(/[\s,;]+/).filter(Boolean)
  const codes = parts.map(Number)
  return codes.every((code) => Number.isInteger(code)) ? codes : null
}

/**
 * The pack house's intake report, keyed in as printed: GRN, arrival
 * temperature, the QC people, then per line the count received, primary and
 * secondary rejections and the reason codes.
 */
export function IntakeForm({ delivery, onClose, onSubmit }: Props) {
  const [grn, setGrn] = useState(delivery.grn_number ?? '')
  const [temp, setTemp] = useState(delivery.arrival_temp_c?.toString() ?? '')
  const [qcOfficer, setQcOfficer] = useState(delivery.qc_officer ?? '')
  const [manager, setManager] = useState(delivery.packhouse_manager ?? '')
  const [drafts, setDrafts] = useState<Record<string, DraftIntake>>(() =>
    Object.fromEntries(
      delivery.lines.map((line) => [
        line.id,
        {
          received: String(line.quantity_received ?? line.quantity_sent),
          primary: String(line.rejected_primary),
          secondary: String(line.rejected_secondary),
          codes: line.rejection_codes.join(', '),
        },
      ]),
    ),
  )
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const patch = (id: string, value: Partial<DraftIntake>) =>
    setDrafts((current) => ({ ...current, [id]: { ...current[id]!, ...value } }))

  async function handleSubmit() {
    setError(null)
    const lines = []
    for (const line of delivery.lines) {
      const draft = drafts[line.id]!
      const codes = parseCodes(draft.codes)
      if (!codes)
        return setError(`${line.product_name}: reason codes are numbers, for example 3, 16.`)
      lines.push({
        id: line.id,
        quantityReceived: Number(draft.received),
        rejectedPrimary: Number(draft.primary || 0),
        rejectedSecondary: Number(draft.secondary || 0),
        rejectionCodes: codes,
      })
    }
    setIsSaving(true)
    const result = await onSubmit({
      grnNumber: grn || null,
      arrivalTempC: temp.trim() ? Number(temp) : null,
      qcOfficer: qcOfficer || null,
      packhouseManager: manager || null,
      lines,
    })
    setIsSaving(false)
    if (result.error) setError(result.error)
    else onClose()
  }

  return (
    <Modal
      isOpen
      size="lg"
      onClose={onClose}
      title="Record the pack house intake"
      description={`${delivery.client_name}, week ${delivery.week}. Only accepted stems are invoiced.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} isLoading={isSaving}>
            Save intake
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

        <div className="rsk-row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Field label="Goods received note">
            <Input value={grn} onChange={(event) => setGrn(event.target.value)} />
          </Field>
          <Field label="Arrival temperature (°C)">
            <Input
              value={temp}
              inputMode="decimal"
              isNumeric
              onChange={(event) => setTemp(event.target.value)}
            />
          </Field>
          <Field label="QC officer">
            <Input value={qcOfficer} onChange={(event) => setQcOfficer(event.target.value)} />
          </Field>
          <Field label="Pack house manager">
            <Input value={manager} onChange={(event) => setManager(event.target.value)} />
          </Field>
        </div>

        {delivery.lines.map((line) => {
          const draft = drafts[line.id]!
          const accepted =
            Number(draft.received) - Number(draft.primary || 0) - Number(draft.secondary || 0)
          return (
            <fieldset
              key={line.id}
              className="rsk-stack"
              style={{ border: 0, padding: 0, margin: 0 }}
            >
              <legend className="rsk-section-title">
                {line.product_name}
                {line.stem_length_cm ? `, ${line.stem_length_cm} cm` : ''}:{' '}
                {formatQuantity(line.quantity_sent)} on the delivery note
              </legend>
              <div className="rsk-row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <Field label="Received" isRequired>
                  <Input
                    value={draft.received}
                    inputMode="numeric"
                    isNumeric
                    onChange={(event) => patch(line.id, { received: event.target.value })}
                  />
                </Field>
                <Field label="Rejected at primary QC">
                  <Input
                    value={draft.primary}
                    inputMode="numeric"
                    isNumeric
                    onChange={(event) => patch(line.id, { primary: event.target.value })}
                  />
                </Field>
                <Field label="Rejected at secondary QC">
                  <Input
                    value={draft.secondary}
                    inputMode="numeric"
                    isNumeric
                    onChange={(event) => patch(line.id, { secondary: event.target.value })}
                  />
                </Field>
                <Field label="Reason codes" hint="As printed on the sheet, for example 3, 16.">
                  <Input
                    value={draft.codes}
                    list="packhouse-reason-codes"
                    onChange={(event) => patch(line.id, { codes: event.target.value })}
                  />
                </Field>
              </div>
              <p className="rsk-metric__label rsk-numeric">
                Accepted:{' '}
                {Number.isFinite(accepted)
                  ? formatQuantity(Math.max(0, accepted))
                  : 'check the counts'}
              </p>
            </fieldset>
          )
        })}

        <datalist id="packhouse-reason-codes">
          {REJECTION_CODE_NUMBERS.map((code) => (
            <option key={code} value={code}>
              {rejectionLabel(code)}
            </option>
          ))}
        </datalist>
      </div>
    </Modal>
  )
}
