# Go-live test round

One pass through every module on production, with the figures the dashboard
must show at the end. Do it all on one day (the dashboard's "today" is the
Africa/Nairobi calendar day). Prefix every name with `TEST` and use your own
inbox for client emails, because emails really send.

When everything checks out, empty it all with
`supabase/maintenance/reset-business-data.sql` (see the end).

## 1. Products

- [ ] `TEST Baby Blue standard`: variety Baby Blue, form standard, price **KES 50**, reorder level **700**
- [ ] `TEST Gunni spray`: variety Gunni, form spray, price **KES 80**, reorder level **100**

## 2. Supplier and purchase

- [ ] Supplier `TEST Supplier`
- [ ] Purchase: Baby Blue standard **1,000 @ KES 20** and Gunni spray **200 @ KES 30** = **KES 26,000**
- [ ] Receive it. Stock: Baby Blue **1,000**, Gunni **200**
- [ ] Pay the supplier **KES 6,000**. Still owed: **KES 20,000**

## 3. Clients

- [ ] `TEST Client One`, with your own email
- [ ] `TEST Client Two`

## 4. Orders and invoices

- [ ] Order for Client One: Baby Blue **300 @ 50 = KES 15,000**. Move it through to delivered. Stock: Baby Blue **700**
- [ ] Invoice it and issue. After sync it is numbered `INV-2026-0001`
- [ ] Payment **KES 10,000**. Balance **KES 5,000**
- [ ] Email the invoice to Client One. It arrives in your inbox
- [ ] Print the invoice and the receipt. Check the payment details are the real ones
- [ ] Order for Client Two: Gunni **150 @ 80 = KES 12,000**. Deliver, invoice, issue (`INV-2026-0002`). Stock: Gunni **50**
- [ ] Payment **KES 2,000** on it, then reverse that payment. Balance back to **KES 12,000**
- [ ] Order for Client One of **KES 5,000**, then cancel it

## 5. Stock

- [ ] Record wastage of **20** Baby Blue. Stock: **680**

## 6. Dashboard (expected)

| Figure            | Expected                                            |
| ----------------- | --------------------------------------------------- |
| Sales today       | **KES 27,000** (the cancelled order is excluded)    |
| Orders today      | **2**                                               |
| Payments received | **KES 10,000** (the reversed 2,000 nets to zero)    |
| Owed to us        | **KES 17,000** (5,000 + 12,000)                     |
| Top clients       | Client One 15,000, Client Two 12,000                |
| Top products      | Baby Blue 15,000, Gunni 12,000                      |
| Low stock         | Baby Blue 680 (reorder 700), Gunni 50 (reorder 100) |
| Sales, 30 days    | One point today at 27,000                           |

Also: Suppliers shows **KES 20,000** payable, and both CSV exports download
and open.

## 7. Sync, offline, roles

- [ ] Turn off Wi-Fi, record a KES 1,000 payment on Client Two's invoice, turn Wi-Fi on. It syncs without a duplicate (Owed to us: **KES 16,000**)
- [ ] On a second device or account (Onyanga D, manager), the same figures appear after sync
- [ ] Audit log lists the payments, the reversal and the cancellation, with who did them

## 8. Reset

Tell Claude everything checked out, or run it yourself:

    supabase db query --linked -f supabase/maintenance/reset-business-data.sql

Every device clears its local copy on its next sync. Accounts, settings and
the four varieties stay. A category you added during the test stays too;
delete it in the app.
