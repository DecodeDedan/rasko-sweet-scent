// node --test supabase/functions/_shared/payouts/
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BANK_MAX_SHILLINGS,
  BANK_MIN_SHILLINGS,
  KENYA_BANKS,
  bankAccount,
  bankName,
  payoutBlocker,
} from './rules.js'

const bank = { bankCode: '68', accountNumber: '0123456789' }
const bankLine = { netPayCents: 3000000, msisdn: null, paymentMethod: 'bank', isPaid: false, bank }

test('reads a bank account from payment_details, tolerating spaces and dashes', () => {
  assert.deepEqual(
    bankAccount({ bank_code: '68', account_number: '0123 4567-89', account_name: ' Jane W ' }),
    { bankCode: '68', accountNumber: '0123456789', accountName: 'Jane W' },
  )
  assert.equal(bankAccount({ bank_code: '68', account_number: '01234' }).accountName, null)
})

test('refuses an incomplete or malformed bank account rather than guessing', () => {
  assert.equal(bankAccount(null), null)
  assert.equal(bankAccount({}), null)
  assert.equal(bankAccount({ bank_code: 'Equity', account_number: '0123456789' }), null)
  assert.equal(bankAccount({ bank_code: '68', account_number: '12' }), null)
  assert.equal(bankAccount({ bank_code: '68', account_number: '1'.repeat(25) }), null)
})

test('a bank line is payable within the PesaLink limits', () => {
  assert.equal(payoutBlocker(bankLine), null)
  assert.match(payoutBlocker({ ...bankLine, bank: null }), /bank account/)
  assert.match(
    payoutBlocker({ ...bankLine, netPayCents: (BANK_MIN_SHILLINGS - 1) * 100 }),
    /minimum/,
  )
  assert.match(payoutBlocker({ ...bankLine, netPayCents: (BANK_MAX_SHILLINGS + 1) * 100 }), /limit/)
  assert.match(payoutBlocker({ ...bankLine, isPaid: true }), /Already paid/)
})

test('a line with no payment method is not paid out', () => {
  assert.match(payoutBlocker({ ...bankLine, paymentMethod: null }), /No payment method/)
})

test('every bank code is unique and named', () => {
  const codes = KENYA_BANKS.map((b) => b.code)
  assert.equal(new Set(codes).size, codes.length)
  assert.equal(bankName('68'), 'Equity Bank')
  assert.equal(bankName('999'), null)
})
