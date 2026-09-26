// node --test supabase/functions/_shared/mpesa/b2c.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  B2C_MAX_SHILLINGS,
  b2cRequestBody,
  parseResult,
  payoutAmount,
  payoutBlocker,
  toMsisdn,
} from './b2c.js'

test('pays whole shillings, rounding down, and reports the cents left over', () => {
  assert.deepEqual(payoutAmount(2345640), {
    amountShillings: 23456,
    amountCents: 2345600,
    remainderCents: 40,
  })
  assert.equal(payoutAmount(2345699).amountShillings, 23456)
  assert.equal(payoutAmount(-500).amountShillings, 0)
})

test('turns a stored +254 number into the 2547XXXXXXXX form Daraja wants', () => {
  assert.equal(toMsisdn('+254712345678'), '254712345678')
  assert.equal(toMsisdn('0712345678'), '254712345678')
  assert.equal(toMsisdn('+254112345678'), '254112345678')
  assert.equal(toMsisdn('+25471234567'), null)
  assert.equal(toMsisdn(null), null)
})

test('says why an item cannot go by M-Pesa', () => {
  const ok = {
    netPayCents: 2000000,
    msisdn: '254712345678',
    paymentMethod: 'mpesa',
    isPaid: false,
  }
  assert.equal(payoutBlocker(ok), null)
  assert.match(payoutBlocker({ ...ok, isPaid: true }), /Already paid/)
  assert.match(payoutBlocker({ ...ok, paymentMethod: 'bank' }), /bank account/)
  assert.match(payoutBlocker({ ...ok, msisdn: null }), /M-Pesa number/)
  assert.match(payoutBlocker({ ...ok, netPayCents: 500 }), /minimum/)
  assert.match(payoutBlocker({ ...ok, netPayCents: (B2C_MAX_SHILLINGS + 1) * 100 }), /limit/)
})

test('builds a salary request keyed by our payout id', () => {
  const body = b2cRequestBody(
    {
      initiatorName: 'apiop',
      securityCredential: 'cred',
      shortcode: '600000',
      resultUrl: 'https://x.test/result',
      timeoutUrl: 'https://x.test/timeout',
    },
    {
      payoutId: 'p-1',
      amountShillings: 23456,
      msisdn: '254712345678',
      remarks: 'Salary September 2026 ' + 'x'.repeat(200),
    },
  )
  assert.equal(body.OriginatorConversationID, 'p-1')
  assert.equal(body.CommandID, 'SalaryPayment')
  assert.equal(body.Amount, 23456)
  assert.equal(body.PartyA, '600000')
  assert.equal(body.PartyB, '254712345678')
  assert.equal(body.Remarks.length, 100)
})

test('reads a successful result, with the receipt and amount', () => {
  const parsed = parseResult({
    Result: {
      ResultType: 0,
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      OriginatorConversationID: 'p-1',
      ConversationID: 'AG_2026_1',
      TransactionID: 'SIP1234567',
      ResultParameters: {
        ResultParameter: [
          { Key: 'TransactionAmount', Value: 23456 },
          { Key: 'TransactionReceipt', Value: 'SIP1234567' },
          { Key: 'ReceiverPartyPublicName', Value: '254712345678 - Jane Wanjiku' },
        ],
      },
    },
  })
  assert.equal(parsed.isSuccess, true)
  assert.equal(parsed.originatorId, 'p-1')
  assert.equal(parsed.receipt, 'SIP1234567')
  assert.equal(parsed.amountShillings, 23456)
})

test('reads a failed result and ignores anything that is not a result', () => {
  const failed = parseResult({
    Result: {
      ResultCode: 2001,
      ResultDesc: 'The initiator information is invalid.',
      OriginatorConversationID: 'p-2',
    },
  })
  assert.equal(failed.isSuccess, false)
  assert.equal(failed.resultCode, '2001')
  assert.equal(failed.receipt, null)
  assert.equal(parseResult({}), null)
  assert.equal(parseResult({ Result: { ResultCode: 0 } }), null)
})
