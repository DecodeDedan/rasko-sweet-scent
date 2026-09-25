// node --test supabase/functions/_shared/mailbox/routing.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CloudflareError,
  companyAddress,
  isCompanyAddress,
  routingClient,
  suggestLocalPart,
} from './routing.js'

const DOMAIN = 'raskosweetscent.com'

test('suggests first.last from a full name, without accents or punctuation', () => {
  assert.equal(suggestLocalPart('Jane Wanjiku Kamau'), 'jane.kamau')
  assert.equal(suggestLocalPart("  Chébet O'Neill "), 'chebet.neill')
  assert.equal(suggestLocalPart('Onyanga'), 'onyanga')
  assert.equal(suggestLocalPart('   '), '')
})

test('accepts a plain local part and refuses anything a client would mistype', () => {
  assert.deepEqual(companyAddress(' Jane.Kamau ', DOMAIN), {
    address: 'jane.kamau@raskosweetscent.com',
  })
  for (const bad of ['', 'jane..kamau', '.jane', 'jane kamau', 'jane@x', 'jane.']) {
    assert.ok('error' in companyAddress(bad, DOMAIN), `expected "${bad}" to be refused`)
  }
  assert.ok('error' in companyAddress('a'.repeat(65), DOMAIN))
})

test('recognises a company address regardless of case', () => {
  assert.equal(isCompanyAddress('Jane@RaskoSweetScent.com', DOMAIN), true)
  assert.equal(isCompanyAddress('jane@gmail.com', DOMAIN), false)
  assert.equal(isCompanyAddress('jane@notraskosweetscent.com', DOMAIN), false)
  assert.equal(isCompanyAddress(null, DOMAIN), false)
})

/** A Cloudflare stand-in holding destinations and rules in memory. */
function fakeCloudflare({ destinations = [], rules = [] } = {}) {
  let nextId = 1
  const ok = (result, info) =>
    new Response(JSON.stringify({ success: true, result, result_info: info, errors: [] }))
  const fetch = async (url, init) => {
    const { pathname } = new URL(url)
    const body = init.body ? JSON.parse(init.body) : undefined
    if (pathname.endsWith('/email/routing/addresses')) {
      if (init.method === 'GET') return ok(destinations, { total_pages: 1 })
      const row = { id: `dest-${nextId++}`, email: body.email, verified: null }
      destinations.push(row)
      return ok(row)
    }
    if (pathname.endsWith('/email/routing/rules')) {
      if (init.method === 'GET') return ok(rules, { total_pages: 1 })
      const row = { id: `rule-${nextId++}`, ...body }
      rules.push(row)
      return ok(row)
    }
    const id = pathname.split('/').pop()
    const index = rules.findIndex((r) => r.id === id)
    if (init.method === 'DELETE') return ok(rules.splice(index, 1)[0])
    rules[index] = { id, ...body }
    return ok(rules[index])
  }
  return { fetch, destinations, rules }
}

const client = (cf) =>
  routingClient({ token: 't', accountId: 'acc', zoneId: 'zone', fetch: cf.fetch })

test('registers a new destination, and reuses one that already exists', async () => {
  const cf = fakeCloudflare({
    destinations: [{ id: 'dest-old', email: 'known@gmail.com', verified: '2026-09-25T00:00:00Z' }],
  })
  assert.deepEqual(await client(cf).ensureDestination('Known@Gmail.com'), {
    id: 'dest-old',
    isVerified: true,
  })
  const created = await client(cf).ensureDestination('new@gmail.com')
  assert.equal(created.isVerified, false)
  assert.equal(cf.destinations.length, 2)
})

test('a retried invite converges on one rule, pointing where the last attempt said', async () => {
  const cf = fakeCloudflare()
  const first = await client(cf).ensureForwardRule(
    'jane.kamau@raskosweetscent.com',
    'old@gmail.com',
  )
  const second = await client(cf).ensureForwardRule(
    'Jane.Kamau@raskosweetscent.com',
    'new@gmail.com',
  )

  assert.equal(first, second)
  assert.equal(cf.rules.length, 1)
  assert.deepEqual(cf.rules[0].actions, [{ type: 'forward', value: ['new@gmail.com'] }])
  assert.equal(cf.rules[0].enabled, true)
})

test('pauses forwarding for a deactivated address, and reports an address with no rule', async () => {
  const cf = fakeCloudflare()
  await client(cf).ensureForwardRule('jane.kamau@raskosweetscent.com', 'jane@gmail.com')

  assert.equal(await client(cf).setForwarding('jane.kamau@raskosweetscent.com', false), true)
  assert.equal(cf.rules[0].enabled, false)
  assert.deepEqual(cf.rules[0].actions, [{ type: 'forward', value: ['jane@gmail.com'] }])
  assert.equal(await client(cf).setForwarding('nobody@raskosweetscent.com', false), false)
})

test("surfaces Cloudflare's own reason when it refuses", async () => {
  const fetch = async () =>
    new Response(
      JSON.stringify({
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
      }),
      { status: 403 },
    )
  const failing = routingClient({ token: 'bad', accountId: 'a', zoneId: 'z', fetch })
  await assert.rejects(failing.ensureDestination('x@gmail.com'), (error) => {
    assert.ok(error instanceof CloudflareError)
    assert.equal(error.status, 403)
    assert.match(error.message, /Authentication error/)
    return true
  })
})

test('turns a network failure into a readable error', async () => {
  const fetch = async () => {
    throw new TypeError('fetch failed')
  }
  const offline = routingClient({ token: 't', accountId: 'a', zoneId: 'z', fetch })
  await assert.rejects(offline.setForwarding('x@raskosweetscent.com', true), /could not be reached/)
})

test('refuses the role addresses the whole company depends on', () => {
  for (const reserved of ['info', 'Postmaster', 'abuse', 'no-reply']) {
    const result = companyAddress(reserved, DOMAIN)
    assert.ok('error' in result, `expected "${reserved}" to be reserved`)
  }
  assert.deepEqual(companyAddress('sales', DOMAIN), { address: 'sales@raskosweetscent.com' })
})

test('never repoints a rule it did not create, such as the business inbox', async () => {
  const handMade = {
    id: 'rule-info',
    name: 'info forward',
    enabled: true,
    priority: 0,
    matchers: [{ type: 'literal', field: 'to', value: 'orders@raskosweetscent.com' }],
    actions: [{ type: 'forward', value: ['owner@gmail.com'] }],
  }
  const cf = fakeCloudflare({ rules: [structuredClone(handMade)] })

  await assert.rejects(
    client(cf).ensureForwardRule('orders@raskosweetscent.com', 'attacker@gmail.com'),
    (error) => error instanceof CloudflareError && error.status === 409,
  )
  assert.equal(await client(cf).setForwarding('orders@raskosweetscent.com', false), false)
  assert.deepEqual(cf.rules, [handMade])
})

test('deleting an account removes its rule, and only its own', async () => {
  const handMade = {
    id: 'rule-hand',
    name: 'owner forward',
    enabled: true,
    priority: 0,
    matchers: [{ type: 'literal', field: 'to', value: 'boss@raskosweetscent.com' }],
    actions: [{ type: 'forward', value: ['boss@gmail.com'] }],
  }
  const cf = fakeCloudflare({ rules: [structuredClone(handMade)] })
  await client(cf).ensureForwardRule('jane.kamau@raskosweetscent.com', 'jane@gmail.com')

  assert.equal(await client(cf).removeForwarding('jane.kamau@raskosweetscent.com'), true)
  assert.equal(await client(cf).removeForwarding('boss@raskosweetscent.com'), false)
  assert.deepEqual(cf.rules, [handMade])
})
