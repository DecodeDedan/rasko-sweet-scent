// node --test supabase/functions/_shared/payouts/
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { interpretStatus, keyEnvironment, sendMoneyBody } from './intasend.js'

// The callback example from developers.intasend.com/docs/send-money-events,
// trimmed to the fields the code reads.
function answer({
  batch = 'BC100',
  tx = 'TS100',
  amount = '23456.00',
  reference = 'TJRHC8IET4',
} = {}) {
  return {
    tracking_id: 'f89e8b57-f647-4960-933a-63874746005f',
    status: 'Completed',
    status_code: batch,
    transactions: [
      {
        status: 'Successful',
        status_code: tx,
        status_description: 'The service request is processed successfully.',
        provider: 'MPESA-B2C',
        account: '254712345678',
        provider_reference: reference,
        provider_account_name: ' Jane Wanjiku',
        amount,
      },
    ],
  }
}

test('tells a sandbox key from a live one, and refuses anything else', () => {
  assert.equal(keyEnvironment('ISSecretKey_test_1a2b3c'), 'sandbox')
  assert.equal(keyEnvironment('ISSecretKey_live_1a2b3c'), 'production')
  assert.equal(keyEnvironment('ISPubKey_test_1a2b3c'), null)
  assert.equal(keyEnvironment('sk_live_1a2b3c'), null)
  assert.equal(keyEnvironment(''), null)
})

test('sends M-Pesa as one MPESA-B2C transaction, released without a second approval', () => {
  const body = sendMoneyBody({
    payoutId: 'p-1',
    channel: 'mpesa',
    amountShillings: 23456,
    msisdn: '254712345678',
    name: 'Jane Wanjiku',
    narrative: 'Salary September 2026',
    callbackUrl: 'https://hooks.test/payout-result/intasend/tok/',
  })
  assert.equal(body.provider, 'MPESA-B2C')
  assert.equal(body.requires_approval, 'NO')
  assert.equal(body.batch_reference, 'p-1')
  assert.equal(body.callback_url, 'https://hooks.test/payout-result/intasend/tok/')
  assert.deepEqual(body.transactions, [
    {
      name: 'Jane Wanjiku',
      amount: '23456',
      narrative: 'Salary September 2026',
      account: '254712345678',
    },
  ])
})

test('sends a bank payout by PesaLink with the bank code and account', () => {
  const body = sendMoneyBody({
    payoutId: 'p-2',
    channel: 'bank',
    amountShillings: 30000,
    bank: { bankCode: '68', accountNumber: '0123456789' },
    name: 'x'.repeat(300),
    narrative: '',
    callbackUrl: 'https://hooks.test/cb/',
  })
  assert.equal(body.provider, 'PESALINK')
  assert.equal(body.transactions[0].bank_code, '68')
  assert.equal(body.transactions[0].account, '0123456789')
  assert.equal(body.transactions[0].name.length, 240)
  assert.equal(body.transactions[0].narrative, 'Salary')
})

test('settles a successful transaction with its reference and recipient', () => {
  const result = interpretStatus(answer(), 23456)
  assert.equal(result.status, 'paid')
  assert.equal(result.receipt, 'TJRHC8IET4')
  assert.equal(result.recipient, 'Jane Wanjiku')
  assert.equal(result.trackingId, 'f89e8b57-f647-4960-933a-63874746005f')
})

test('never settles a success that does not add up', () => {
  const wrongAmount = interpretStatus(answer({ amount: '23000.00' }), 23456)
  assert.equal(wrongAmount.status, 'unknown')
  assert.match(wrongAmount.description, /23000/)
  assert.equal(interpretStatus(answer({ reference: '' }), 23456).status, 'unknown')
})

test('a clear transaction failure is failed; an undetermined one is unknown', () => {
  for (const code of ['TF103', 'TF106', 'TC108']) {
    assert.equal(interpretStatus(answer({ tx: code }), 23456).status, 'failed', code)
  }
  const undetermined = interpretStatus(answer({ tx: 'TF105' }), 23456)
  assert.equal(undetermined.status, 'unknown')
  assert.match(undetermined.description, /dashboard/)
})

test('a transaction still moving stays accepted', () => {
  for (const code of ['TP101', 'TP102', 'TP104', 'TH107', 'TR109']) {
    assert.equal(
      interpretStatus(answer({ batch: 'BP110', tx: code }), 23456).status,
      'accepted',
      code,
    )
  }
  assert.equal(interpretStatus({ tracking_id: 't', status_code: 'BP101' }, 100).status, 'accepted')
})

test('a batch that ended before the payment started is failed, with the reason', () => {
  const lowBalance = interpretStatus(answer({ batch: 'BF105', tx: 'TP101' }), 23456)
  assert.equal(lowBalance.status, 'failed')
  assert.match(lowBalance.description, /Top up the IntaSend wallet/)
  assert.equal(interpretStatus({ status_code: 'BF102', transactions: [] }, 1).status, 'failed')
})

test('a batch that ended after the payment started is unknown, never failed', () => {
  const result = interpretStatus(answer({ batch: 'BE111', tx: 'TP102' }), 23456)
  assert.equal(result.status, 'unknown')
})

test('an empty or foreign body is still in flight, not paid', () => {
  assert.equal(interpretStatus(null, 100).status, 'accepted')
  assert.equal(interpretStatus('nope', 100).status, 'accepted')
})
