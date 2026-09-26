# Salary payouts through IntaSend

Owner-requested (2026-09-26), `docs/PROGRESS.md` decision 16. IntaSend sends
salaries to **M-Pesa** (B2C) and to **bank accounts** (PesaLink) from one funded
wallet. It sits beside the direct Daraja integration of `docs/mpesa-setup.md`;
one function secret decides which one sends.

## How it works

The owner's flow does not change: open an **approved** run, choose **Pay
salaries**, check the list, type the exact total. Each payslip line is paid by
the employee's own payment method:

- **M-Pesa** employees need a valid `+254` number (KES 10 to 250,000).
- **Bank** employees need a bank and account number on their record
  (Payroll → employee → Payment method: Bank transfer). KES 100 to 999,999.
  Without an account they are listed with the reason and left for you to pay
  by hand.

On the server (migration `20260929000100`):

1. `app.prepare_payroll_payout` sets the amount (net pay rounded down to whole
   shillings), the channel and the destination from the approved run and the
   employee record. The device chooses none of them.
2. `mpesa-b2c`, the dispatcher, claims the row, stamps the provider on it, and
   sends one IntaSend `send-money/initiate` request per payslip line, with
   `requires_approval: NO` (the typed total is the approval) and our payout id
   as `batch_reference`.
3. IntaSend calls `payout-result/intasend/<token>/` whenever the payment's
   status changes. That call is only a hint: the function asks IntaSend's
   `send-money/status` endpoint with the secret key, checks the answer is about
   this payout, and only then settles it. A forged callback cannot mark
   anything paid.
4. A payout still waiting after two minutes is asked about again by the
   once-a-minute sweep, for up to a week, so a missed callback never leaves a
   payslip hanging.
5. When IntaSend reports the transaction successful (`TS100`) for exactly the
   amount sent and with a reference, the payout is paid and the payslip is
   marked paid with the M-Pesa receipt or PesaLink reference.

## Money safety

Everything in `docs/mpesa-setup.md` still holds, plus:

- Because a request that reached IntaSend may already be paying, a timeout or
  a server error on sending is **"Check statement"** (`unknown`), never retried.
  Check the IntaSend dashboard (Payouts), then settle it by hand.
- IntaSend's own "cannot be determined" (`TF105`), a success for a different
  amount, a success without a reference, and a request cancelled after the
  payment started are all held for a person, never guessed.
- A payout left at **"Sending"** for more than a few minutes means the function
  stopped mid-request. It is not swept, for the same reason as "Check statement":
  the request may have reached IntaSend. Check the dashboard and settle it by hand.
- A low wallet balance (`BF105`, `BF107`) fails the payout **before** any money
  moves, with "Top up the IntaSend wallet, then pay again". Top up, then send
  the run again: only the failed lines are sent.
- The secret key decides the environment: a `test` key only ever talks to the
  sandbox and a `live` key only to production. If `INTASEND_ENV` is set and
  disagrees with the key, nothing is sent.
- Bank payouts need IntaSend. With `PAYOUT_PROVIDER=daraja`, a bank line fails
  with that message before anything is sent, and can be sent again once
  IntaSend is switched on.

## Sandbox

1. Sign up at **https://sandbox.intasend.com** (separate from the live
   account). Settings → API Keys: copy the **secret** key (`ISSecretKey_test_…`).
   The publishable key is not needed; nothing runs in the browser.
2. Fund the sandbox wallet from the dashboard (M-Pesa STK push, or test card
   `4242 4242 4242 4242`, any future date, any CVC).
3. Set the secrets and deploy (the callback address is the same
   `hooks.raskosweetscent.com` Worker that Daraja uses; it already forwards
   every `/payout-result/...` path):

```bash
supabase secrets set PAYOUT_PROVIDER=intasend INTASEND_SECRET_KEY=ISSecretKey_test_...
supabase db push
supabase functions deploy mpesa-b2c --no-verify-jwt
supabase functions deploy payout-result --no-verify-jwt
```

4. Give an M-Pesa employee the test number `+254708374149`, approve a small
   run and pay it. IntaSend's sandbox runs on Safaricom's test platform, which
   **reverses test amounts within 48 hours**: a sandbox amount that arrives and
   is later taken back is expected.
5. Check the payout's `result_code` and `result_desc` in the Table Editor
   (`payroll_payouts`). The status codes are listed at
   developers.intasend.com/docs/payment-statuses-reference.

Locally, fill `PAYOUT_PROVIDER` and `INTASEND_SECRET_KEY` in
`supabase/functions/.env`. IntaSend must reach the callback over HTTPS, so a
full round trip needs the hosted project or a tunnel; without it the sweep
still settles each payout by asking IntaSend every two minutes.

## Going live

1. Complete IntaSend's business verification on the live account
   (payment.intasend.com) and fund the wallet.
2. Before relying on it, confirm with IntaSend in writing: the B2C and
   PesaLink fees on this account, which bank holds the wallet float, and whether
   the initiate endpoint accepts an idempotency key (the code does not rely on
   one; it never re-sends an uncertain payout).
3. `supabase secrets set INTASEND_SECRET_KEY=ISSecretKey_live_... INTASEND_ENV=production`
4. Pay one small, real salary first and confirm it on the IntaSend dashboard
   and on the payslip before paying a full run.

To switch back to Daraja: `supabase secrets set PAYOUT_PROVIDER=daraja`.
Payouts already sent keep being settled by the provider that sent them.

## Not built

- Funding the wallet from the app. Top up on the IntaSend dashboard (M-Pesa,
  card or bank deposit).
- Showing the wallet balance in the app. A low balance fails the payout
  cleanly before any money moves, with a message saying so.
- The bank list is IntaSend's documented list (`_shared/payouts/rules.js`,
  `KENYA_BANKS`). A bank that is missing can be added there from
  `GET /api/v1/send-money/bank-codes/ke/`.
