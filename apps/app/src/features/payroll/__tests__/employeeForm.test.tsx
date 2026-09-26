import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { EmployeeForm } from '../EmployeeForm.js'
import type { EmployeeFormValues } from '../EmployeeForm.js'

/**
 * The bank account an employee is paid to by PesaLink (migration
 * 20260929000100). It is optional, but all or nothing: a partial account would
 * only fail later, at payout time, with the run half paid.
 */
describe('EmployeeForm bank account', () => {
  async function setup() {
    const onSubmit = vi.fn(async (_values: EmployeeFormValues) => ({}))
    render(<EmployeeForm isOpen onClose={() => {}} onSubmit={onSubmit} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/^Full name/), 'Mary Chebet')
    await user.type(screen.getByLabelText(/^National ID/), '12345678')
    await user.selectOptions(screen.getByLabelText('Payment method'), 'bank')
    return { onSubmit, user }
  }

  it('saves a complete account, with the employee name standing in for the account name', async () => {
    const { onSubmit, user } = await setup()
    await user.selectOptions(screen.getByLabelText(/^Bank/), '68')
    await user.type(screen.getByLabelText('Account number'), '0123 4567 89')
    await user.click(screen.getByRole('button', { name: 'Save employee' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      payment_method: 'bank',
      payment_details: {
        bank_code: '68',
        account_number: '0123456789',
        account_name: 'Mary Chebet',
      },
    })
  })

  it('refuses a bank chosen without an account number', async () => {
    const { onSubmit, user } = await setup()
    await user.selectOptions(screen.getByLabelText(/^Bank/), '68')
    await user.click(screen.getByRole('button', { name: 'Save employee' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/account number/i)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('saves a bank employee with no account, to be paid by hand', async () => {
    const { onSubmit, user } = await setup()
    await user.click(screen.getByRole('button', { name: 'Save employee' }))

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      payment_method: 'bank',
      payment_details: null,
    })
  })

  it('shows no bank fields for an M-Pesa employee', async () => {
    const { user } = await setup()
    await user.selectOptions(screen.getByLabelText('Payment method'), 'mpesa')
    expect(screen.queryByLabelText('Account number')).toBeNull()
  })
})
