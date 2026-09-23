import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ClientForm } from '../ClientForm.js'

/**
 * Field validation. The email case is a regression: a walkthrough typed a phone
 * number into the email box and it was accepted and synced to the server.
 */
describe('ClientForm validation', () => {
  function setup() {
    const onSubmit = vi.fn(async () => ({}))
    render(<ClientForm isOpen onClose={() => {}} onSubmit={onSubmit} />)
    return { onSubmit, user: userEvent.setup() }
  }

  it('requires a name', async () => {
    const { onSubmit, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Add client' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter the client name/i)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects a phone number that is not a Kenyan mobile', async () => {
    const { onSubmit, user } = setup()
    await user.type(screen.getByLabelText(/^Name/), 'Test Client')
    await user.type(screen.getByLabelText('Phone'), '12345')
    await user.click(screen.getByRole('button', { name: 'Add client' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/kenyan mobile number/i)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects a phone number typed into the email box', async () => {
    const { onSubmit, user } = setup()
    await user.type(screen.getByLabelText(/^Name/), 'Test Client')
    await user.type(screen.getByLabelText('Email'), '0722 118 245')
    await user.click(screen.getByRole('button', { name: 'Add client' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email address/i)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('accepts a local phone format and normalises it to +254', async () => {
    const { onSubmit, user } = setup()
    await user.type(screen.getByLabelText(/^Name/), 'Nakuru Blooms Boutique')
    await user.type(screen.getByLabelText('Phone'), '0722 118 245')
    await user.click(screen.getByRole('button', { name: 'Add client' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Nakuru Blooms Boutique', phone: '+254722118245' }),
    )
  })

  it('rejects credit terms that are not a whole number of days', async () => {
    const { onSubmit, user } = setup()
    await user.type(screen.getByLabelText(/^Name/), 'Test Client')
    await user.clear(screen.getByLabelText('Credit terms'))
    await user.type(screen.getByLabelText('Credit terms'), '-5')
    await user.click(screen.getByRole('button', { name: 'Add client' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/whole number of days/i)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
