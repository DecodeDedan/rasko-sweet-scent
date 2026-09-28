# KRA eTIMS integration — design and onboarding

Status: **designed, not built.** Owner decision 2026-09-27: move eTIMS from v2 into
scope (PRD §4, §12 q7), connect through **OSCU directly** (no third-party
integrator), and let an invoice issued offline print as _Pending KRA validation_
until KRA signs it.

Source: KRA, _Online Sales Control Unit (OSCU) Requirements & Communication
Protocols_, v2.0, 20/04/2023 (`kra.go.ke/images/publications/OSCU_Specification_Document_v2.0.pdf`).
Section numbers below are that document's. Anything marked **unverified** comes
from a secondary source and must be confirmed against the KRA sandbox.

## 1. What the owner must do with KRA first (nothing can be tested before this)

1. On the KRA eTIMS portal, apply for **OSCU** for PIN `P052533612T`, branch `00`
   (§2.1: a taxpayer must apply for OSCU service and get KRA's approval).
2. Register on the KRA developer portal (`developer.go.ke`, API "eTIMS OSCU
   Integrator Automated Testing") for **sandbox** access.
3. KRA issues a **device serial number** (`dvcSrlNo`) for the sandbox, and later a
   separate one for production.
4. Pass KRA's integrator certification tests in the sandbox. Only then does KRA
   switch the device to production.

None of this is a code task. Serial numbers go into Supabase function secrets,
never into chat, the repo or the app.

## 2. Questions for the accountant (recorded in PROGRESS.md for sign-off)

| #  | Question | Recommended default, reversible from Settings |
| -- | -------- | --------------------------------------------- |
| E1 | Tax type per product: A exempt, B 16%, C zero-rated, D non-VAT, E 8% (§4.1) | **D** while `is_vat_registered` is off; B when it is on. A, C and D all show zero tax but land in different boxes of the VAT return, so they are not interchangeable. |
| E2 | Export sales | **C** (zero-rated) for a client outside Kenya, once VAT-registered. |
| E3 | Foreign-currency invoices. The sales payload (§3.3.6.1) has **no currency field**, so every figure goes to KRA in shillings. Which rate? | CBK mean rate on the invoice's issue date, entered on the invoice and stored with it, never re-fetched. |
| E4 | Item classification (`itemClsCd`, 10 digits) for eucalyptus foliage | Picked from KRA's own list (`/selectItemClsList`); it cannot be invented. |

## 3. Design

Same shape as client email and salary payouts: **the device never talks to KRA.**
Issuing an invoice stays an offline, local write (NFR-S1). The server does the
rest after the row syncs.

```
device: issue invoice (offline OK) --sync--> invoices row (server numbers it, FR-5.1)
                                               | trigger + 1-minute pg_cron sweep
                                               v
                                        etims_submissions row (queued)
                                               | pg_net
                                               v
                                   edge function etims-submit --> KRA /saveTrnsSalesOsdc
                                               |
                        signature fields written back --sync--> device prints KRA block + QR
```

### Tables (migration, mirrored in `data/sqlite/tables.ts`)

- `etims_device` — one row: `tin`, `bhf_id`, `dvc_id`, `sdc_id`, `mrc_no`,
  environment, initialised-at. **`cmcKey` is not stored in a synced table**; it
  lives in Supabase Vault and only the function reads it.
- `products`: `etims_item_code` (`itemCd`, 20), `etims_item_class` (`itemClsCd`,
  10), `etims_tax_type` (A–E), `etims_registered_at`. Registered with `/saveItem`
  (§3.3.3.2) before first sale.
- `etims_submissions` — append-only, one row per invoice or credit note:
  `invoice_id`, `receipt_type` (`S` sale / `R` credit note, §4.10),
  `etims_invoice_no` (`invcNo`), `org_invoice_no` (`orgInvcNo`), `status`
  (`queued`/`sending`/`signed`/`rejected`/`unknown`), `attempts`, `result_code`,
  `result_msg`, and the five fields that make the invoice valid:
  `cur_rcpt_no`, `tot_rcpt_no`, `intrl_data`, `rcpt_sign`, `sdc_date_time`.
  The full request and response are kept for KRA support queries.

### Rules taken from the spec

- `invcNo` is a NUMBER(38), separate from our `INV-YYYY-NNNN`, which goes in
  `trdInvcNo` (CHAR 50). It comes from its own gap-free counter, allocated **at
  transmission time** with the same row-lock pattern as
  `app.allocate_document_number`. unverified: KRA rejects gaps.
- `resultCd` is a 3-character string; success is `"000"` (§4.18). Compare it as
  text, never as a number.
- Reversals and voids become a credit note: `rcptTyCd = R`, `orgInvcNo` = the
  original `invcNo`, `rfdRsnCd` from §4.17, and a fresh `invcNo`. There is no cancel.
- Payment type `pmtTyCd` (§4.11): `02 CREDIT` at issue, because Rasko invoices on terms.
- Money: integer cents are converted to 2-decimal amounts per line, then summed,
  so the header totals equal the sum of the lines exactly.
- Retries: a timeout or an 89x code is retried with backoff. A 9xx validation code
  (910, 921, 922, 994…) is `rejected` and shown to the owner, never retried. A
  send whose answer never arrived is `unknown`, the same rule as payouts.
- unverified: `tin`, `bhfId` and `cmcKey` travel as HTTP headers. The QR code links
  to `https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=<tin><bhfId><rcptSign>`.

### On the invoice (`InvoiceDocument.tsx`)

Signed: a _KRA eTIMS_ block with the CU invoice number (`sdcId/curRcptNo`),
internal data, receipt signature, date and time, and the QR code. Not yet signed:
_Pending KRA validation_ in the same place, so the page never changes height. Only
issued invoices carry either.

## 4. Build phases

1. **Sales invoices** — schema, device initialisation (`/selectInitOsdcInfo`),
   item registration, `etims-submit`, the sweep, the invoice block and QR, and a
   Settings > eTIMS status screen. Tested against KRA's sample payloads until
   sandbox access exists.
2. **Credit notes** from reversals and voided invoices.
3. **Purchases and stock** (§3.3.7, §3.3.8). KRA's certification tests cover
   them too; confirm with KRA which are mandatory for a grower before building.
