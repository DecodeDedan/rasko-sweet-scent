# M-Pesa B2C salary payouts

Owner-requested extension (2026-09-27). PRD §4 leaves Daraja reconciliation of
_incoming_ payments out of v1; paying salaries _out_ was not covered, so this is
recorded in `docs/PROGRESS.md` (decision 13) for client sign-off.

## How it works

1. An owner opens an **approved** payroll run and chooses **Pay by M-Pesa**. The
   dialog lists who will be paid, how much, and why anyone is left out (paid by
   bank, no valid number, below KES 10, above KES 250,000, already paid or
   already requested). The owner types the exact total to confirm.
2. The device queues one `payroll_payouts` row per payslip line, naming only the
   line. It syncs like any other write, so it can be done offline.
3. On the server, `app.prepare_payroll_payout` ignores whatever amount and phone
   the device sent and sets them from the approved run: net pay **rounded down to
   whole shillings** (B2C cannot send cents; the remainder is shown and stays
   owed) and the employee's own M-Pesa number. Owner only; approved runs only.
4. `pg_net` calls `mpesa-b2c`, which claims the row, gets a Daraja token and sends
   a `SalaryPayment`. `payout-result` receives Safaricom's answer, marks the
   payout paid with the M-Pesa receipt, which marks the payslip paid (FR-8.7) and
   the run paid once every line is.

## Callback URLs must avoid certain words

Daraja will not call a ResultURL or QueueTimeOutURL containing words such as
`mpesa`, `m-pesa`, `safaricom`, `sql` or `exec`. It still accepts the payment,
answering `ResponseCode 0`, and then never reports the result, so the payout
waits at "With M-Pesa" forever. That is why the result function is named
`payout-result`. Keep any new callback name clear of those words.

## The callback address: hooks.raskosweetscent.com

Results reach `payout-result` through the company's own subdomain, not the
`supabase.co` address: `MPESA_CALLBACK_BASE_URL=https://hooks.raskosweetscent.com`.
A Cloudflare Worker named `payout-hooks` (Cloudflare → Workers & Pages) owns that
subdomain and forwards `POST /payout-result/...` to the function; anything else
gets 404. Safaricom delivered no result to the `supabase.co` address in sandbox
and delivered within a minute to this one (2026-09-25). The Worker's code:

```js
export default {
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method !== 'POST' || !url.pathname.startsWith('/payout-result/')) {
      return new Response('Not found', { status: 404 })
    }
    return fetch(`https://ezfbquyfwiolestylykx.supabase.co/functions/v1${url.pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': request.headers.get('Content-Type') ?? 'application/json' },
      body: await request.arrayBuffer(),
    })
  },
}
```

The token travels in the path (`/payout-result/result/<token>`), never a query
string. Sandbox pays only its test customer `254708374149`; any other number is
declined with result code 2040.

## Money safety

- One live payout per payslip line (partial unique index): a double press, a
  retried sync or two devices cannot pay anyone twice. Only a `failed` payout
  can be sent again.
- Before the request leaves (credentials missing or refused, network down),
  nothing has been paid: the row returns to the queue or fails.
- Once the request may have reached Safaricom without a clear answer (timeout,
  5xx, queue timeout, an amount that does not match, success without a receipt),
  the payout is **`unknown`** and is never retried automatically. Check the
  M-Pesa statement, then settle it by hand.
- The callback URL carries `MPESA_CALLBACK_TOKEN`; without it the request is
  refused. Only a payout in flight can be settled, and only by its own id.
- Every payout request is written to the audit log.

## Setup

Fill in `supabase/functions/.env` (gitignored; the slots are there), then
`supabase stop && supabase start`. Until every value is set, payouts wait in the
queue and go out once they are.

| Variable                                      | Where it comes from                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `MPESA_ENV`                                   | `sandbox` until production is approved, then `production`                         |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET` | Your app on developer.safaricom.co.ke                                             |
| `MPESA_SHORTCODE`                             | The B2C shortcode (sandbox: the test shortcode on the portal)                     |
| `MPESA_INITIATOR_NAME`                        | The API initiator on that shortcode                                               |
| `MPESA_SECURITY_CREDENTIAL`                   | Generated on the Daraja portal from the initiator password                        |
| `MPESA_CALLBACK_BASE_URL`                     | Public HTTPS base of the functions, e.g. `https://<ref>.supabase.co/functions/v1` |
| `MPESA_CALLBACK_TOKEN`                        | Already generated locally; generate a new one for each environment                |
| `MPESA_B2C_PATH`                              | Optional; defaults to `/mpesa/b2c/v3/paymentrequest`                              |

Safaricom must reach the callback over the internet, so a full round trip needs
the hosted project (or an HTTPS tunnel to the local stack). Hosted:

```bash
supabase functions deploy mpesa-b2c --no-verify-jwt
supabase functions deploy payout-result --no-verify-jwt
supabase secrets set MPESA_ENV=sandbox MPESA_CONSUMER_KEY=... MPESA_CONSUMER_SECRET=... \
  MPESA_SHORTCODE=... MPESA_INITIATOR_NAME=... MPESA_SECURITY_CREDENTIAL=... \
  MPESA_CALLBACK_BASE_URL=https://<ref>.supabase.co/functions/v1 MPESA_CALLBACK_TOKEN=$(openssl rand -hex 32)
```

and in the SQL editor:

```sql
update app.payout_dispatch
   set function_url = 'https://<ref>.supabase.co/functions/v1/mpesa-b2c';
```

Verify the endpoint and the callback shape on the first sandbox payout before
switching `MPESA_ENV` to `production`; the Daraja contract used here is from
Safaricom's documentation and has not yet been exercised end to end.
