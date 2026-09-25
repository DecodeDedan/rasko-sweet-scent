import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createFakeGateway, makeProfile } from '../../../test/fakeGateway.js'
import { AssignCompanyEmailDialog, InviteUserDialog } from '../CompanyEmailDialogs.js'

const ROLES = ['manager', 'accountant', 'sales'] as const

function renderInvite(gateway = createFakeGateway(), onInvited = vi.fn()) {
  render(
    <InviteUserDialog
      gateway={gateway}
      offeredRoles={ROLES}
      onClose={() => {}}
      onInvited={onInvited}
    />,
  )
  return { gateway, onInvited }
}

describe('inviting someone onto a company address', () => {
  it('suggests the address from their name and sends exactly what the owner confirmed', async () => {
    const { gateway, onInvited } = renderInvite()

    await userEvent.type(screen.getByLabelText(/full name/i), 'Jane Wanjiku Kamau')
    await userEvent.type(screen.getByLabelText(/personal email/i), 'jane@gmail.com')
    expect(screen.getByLabelText(/company email/i)).toHaveValue('jane.kamau')
    expect(screen.getByText('Their company address: jane.kamau@raskosweetscent.com')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /send invitation/i }))

    expect(gateway.calls.invite).toEqual([
      {
        fullName: 'Jane Wanjiku Kamau',
        role: 'sales',
        localPart: 'jane.kamau',
        personalEmail: 'jane@gmail.com',
      },
    ])
    expect(onInvited).toHaveBeenCalledWith('jane.kamau@raskosweetscent.com')
  })

  it('keeps an address the owner typed even when the name changes after', async () => {
    renderInvite()
    const address = screen.getByLabelText(/company email/i)
    await userEvent.type(address, 'sales')
    await userEvent.type(screen.getByLabelText(/full name/i), 'Peter Otieno')
    expect(address).toHaveValue('sales')
  })

  it('refuses a company inbox as the personal email, and a malformed address, sending nothing', async () => {
    const { gateway } = renderInvite()
    await userEvent.type(screen.getByLabelText(/full name/i), 'Peter Otieno')
    await userEvent.type(screen.getByLabelText(/personal email/i), 'peter@raskosweetscent.com')
    await userEvent.click(screen.getByRole('button', { name: /send invitation/i }))
    expect(screen.getByRole('alert').textContent).toMatch(/own inbox/)

    const address = screen.getByLabelText(/company email/i)
    await userEvent.clear(address)
    await userEvent.type(address, 'peter..otieno')
    expect(screen.getAllByText(/single dots/).length).toBeGreaterThan(0)
    expect(gateway.calls.invite).toHaveLength(0)
  })

  it('says so when the server cannot be reached, and stays open', async () => {
    const gateway = createFakeGateway()
    gateway.setOffline(true)
    const { onInvited } = renderInvite(gateway)
    await userEvent.type(screen.getByLabelText(/full name/i), 'Peter Otieno')
    await userEvent.type(screen.getByLabelText(/personal email/i), 'peter@gmail.com')
    await userEvent.click(screen.getByRole('button', { name: /send invitation/i }))

    expect(screen.getByRole('alert').textContent).toMatch(/could not reach the server/i)
    expect(onInvited).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /send invitation/i })).not.toBeDisabled()
  })
})

describe('moving an existing account onto a company address', () => {
  it('names the inbox that keeps receiving the mail and sends the chosen address', async () => {
    const gateway = createFakeGateway()
    const target = makeProfile({ id: 'user-onyanga', fullName: 'Onyanga D', email: 'o@gmail.com' })
    const onAssigned = vi.fn()
    render(
      <AssignCompanyEmailDialog
        gateway={gateway}
        target={target}
        isSelf={false}
        onClose={() => {}}
        onAssigned={onAssigned}
      />,
    )

    expect(screen.getByText(/delivered to o@gmail.com/)).toBeTruthy()
    expect(screen.getByLabelText(/company email/i)).toHaveValue('onyanga.d')

    await userEvent.click(screen.getByRole('button', { name: /create address/i }))
    expect(gateway.calls.assign).toEqual([['user-onyanga', 'onyanga.d']])
    expect(onAssigned).toHaveBeenCalledWith('onyanga.d@raskosweetscent.com', {})
  })
})
