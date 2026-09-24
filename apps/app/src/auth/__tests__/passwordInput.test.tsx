import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Field, PasswordInput } from '@rasko/ui'

function renderField() {
  render(
    <form
      onSubmit={() => {
        throw new Error('the toggle must not submit the form')
      }}
    >
      <Field label="Password">
        <PasswordInput defaultValue="rasko-2026" />
      </Field>
    </form>,
  )
}

describe('password field with show/hide', () => {
  it('starts hidden and keeps its label', () => {
    renderField()
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
  })

  it('shows and hides the password without submitting the form', async () => {
    const user = userEvent.setup()
    renderField()

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
  })
})
