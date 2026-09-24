import { describe, expect, it } from 'vitest'

import { modulesForRole } from '../../shell/navigation.js'
import { setupItems } from '../setup.js'
import type { SetupFacts } from '../setup.js'
import { tourSteps } from '../tour.js'

const ids = (role: Parameters<typeof modulesForRole>[0]) => modulesForRole(role).map((m) => m.id)

describe('first-run tour', () => {
  it('only visits modules the role can reach', () => {
    const steps = tourSteps({ firstName: 'Wanjiru', role: 'sales', modules: ids('sales') })
    const targets = steps.flatMap((step) => (step.target ? [step.target] : []))

    expect(targets).not.toContain('nav-payroll')
    expect(targets).not.toContain('nav-users')
    expect(targets).toContain('nav-clients')
  })

  it('opens and closes with centre dialogs and greets by first name', () => {
    const steps = tourSteps({ firstName: 'Dedan', role: 'owner', modules: ids('owner') })
    expect(steps[0]).toMatchObject({ id: 'welcome', title: 'Welcome, Dedan' })
    expect(steps[0]?.target).toBeUndefined()
    expect(steps.at(-1)?.target).toBeUndefined()
  })
})

const empty: SetupFacts = {
  hasCompanyDetails: false,
  hasPaymentDetails: false,
  categoryCount: 0,
  productCount: 0,
  clientCount: 0,
  activeUserCount: 1,
}

describe('setup list', () => {
  it('derives every item from the records, nothing stored', () => {
    const items = setupItems({ ...empty, categoryCount: 4, productCount: 3 }, 'owner')
    const done = items.filter((item) => item.isDone).map((item) => item.id)
    expect(done).toEqual(['product'])
    // Varieties are seeded, so there is no step to create one once they are here.
    expect(items.map((item) => item.id)).not.toContain('category')
  })

  it('asks only the owner to invite the team', () => {
    expect(setupItems(empty, 'owner').map((i) => i.id)).toContain('team')
    expect(setupItems(empty, 'manager').map((i) => i.id)).not.toContain('team')
  })

  it('counts the team done once a second active person exists', () => {
    const team = setupItems({ ...empty, activeUserCount: 2 }, 'owner').find((i) => i.id === 'team')
    expect(team?.isDone).toBe(true)
  })
})
