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
  charge = '10.00',
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
        charge,
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
  // IntaSend's own charge, as it reported it for the sandbox payout of 2026-11-24.
  assert.equal(result.feeCents, 1000)
  assert.equal(interpretStatus(answer({ charge: null }), 23456).feeCents, null)
  assert.equal(interpretStatus(answer({ tx: 'TF106' }), 23456).feeCents, null)
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

test('reads the KES settlement wallet balance, bare or paginated', async () => {
  const { disbursingWallet } = await import('./intasend.js')
  const wallets = [
    { wallet_id: 'W1', currency: 'USD', wallet_type: 'SETTLEMENT', available_balance: '99.00' },
    { wallet_id: 'W2', currency: 'KES', wallet_type: 'WORKING', available_balance: '10.00' },
    {
      wallet_id: 'W3',
      currency: 'KES',
      wallet_type: 'SETTLEMENT',
      available_balance: '48200.55',
      updated_at: 't',
    },
  ]
  assert.deepEqual(disbursingWallet(wallets), {
    walletId: 'W3',
    availableCents: 4820055,
    updatedAt: 't',
  })
  assert.equal(disbursingWallet({ results: wallets }).walletId, 'W3')
  assert.equal(disbursingWallet([wallets[1]]).walletId, 'W2')
  assert.equal(disbursingWallet([wallets[0]]), null)
  assert.equal(disbursingWallet({ detail: 'Invalid token' }), null)
})

test('turns the IntaSend wallet statement into rows, in cents', async () => {
  const { walletTransactionRows } = await import('./intasend.js')
  // As the sandbox reported it on 2026-11-24.
  const rows = walletTransactionRows({
    count: 3,
    results: [
      { transaction_id: 'T3', trans_type: 'PAYOUT', value: -635.0, running_balance: 365.0, currency: 'KES', narrative: 'Payout: #LQPLOOR', status: 'AVAILABLE', created_at: '2026-11-24T23:57:03.811102+03:00' },
      { transaction_id: 'T1', trans_type: 'SALE', value: 1000.0, running_balance: 1000.0, currency: 'KES', narrative: 'Direct Bill', status: 'AVAILABLE', created_at: '2026-11-24T23:43:25.752601+03:00' },
      { trans_type: 'PAYOUT', value: 1 },
    ],
  })
  assert.deepEqual(rows.map((r) => [r.transaction_id, r.value_cents, r.running_balance_cents]), [
    ['T3', -63500, 36500],
    ['T1', 100000, 100000],
  ])
  assert.equal(rows[0].occurred_at, '2026-11-24T20:57:03.811Z')
})
