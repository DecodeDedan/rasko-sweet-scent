# Rasko Sweet Scent

## Staff User Manual

**A step-by-step guide for using the business management system**

This manual is for a new staff member who has received an account and is
opening the software for the first time. Follow the sections that apply to
your role.

The software is designed for Rasko Sweet Scent's eucalyptus cut-foliage
business. It works offline: a change is saved on the device first and is sent
to the server when the device is online and synchronises.

---

## 1. Before you begin

Have the following information ready:

- Your company email address and password.
- The role assigned to you: **Owner**, **Manager**, **Accountant**, or
  **Sales**.
- The company's legal name, address, phone number, email, KRA PIN, and VAT
  setting.
- The varieties you sell, such as Baby Blue, and whether each is sold as
  standard, spray, or both.
- Product SKUs, units, cost prices, selling prices, and low-stock thresholds.
- Client names, phone numbers, email addresses, addresses, KRA PINs, and
  credit terms.
- Supplier details and payment terms.

Do not guess a business value. If information is missing, ask the owner before
entering it.

---

## 2. Sign in for the first time

1. Open the **RSS Management System** application.
2. Enter the email address used for your account.
3. Enter your password.
4. Select **Sign in**.
5. If the system asks you to change your password, enter a new password and
   save it.
6. Confirm that your name and role are correct in the user menu.
7. Check the sync indicator in the top bar:
   - **Synced** means the device has completed synchronisation.
   - **Pending** means local changes are waiting to be sent.
   - **Offline** means the device has no current connection.

If you are offline after signing in, you may still see the information already
stored on that device. Offline access does not give you extra permissions.

### If you cannot sign in

Check the email address and password first. If the problem continues, contact
the owner. A deactivated account cannot use the server even if an old password
is remembered by the device.

---

## 3. Understand your role

The owner controls user accounts and permissions. Never use another person's
account.

| Area                    | Owner | Manager   | Accountant      | Sales                               |
| ----------------------- | ----- | --------- | --------------- | ----------------------------------- |
| Dashboard               | Full  | Full      | Financial view  | Own performance                     |
| Clients                 | All   | All       | All             | Own clients                         |
| Orders                  | All   | All       | View all        | Create and manage own drafts        |
| Invoices and payments   | All   | All       | Create and edit | Create invoices and record payments |
| Products and stock      | Full  | Full      | View            | View                                |
| Suppliers and purchases | Full  | Full      | View            | No access                           |
| Settings                | Full  | Limited   | No access       | No access                           |
| Users                   | Full  | No access | No access       | No access                           |
| Audit log               | Full  | View      | No access       | No access                           |

The application hides areas that your role cannot use. The server also
enforces these permissions. If a button or module is not visible, do not try
to work around it.

### Important role rules

- Only the **Owner** manages users, assigns roles, and deactivates accounts.
- A **Sales** user sees only clients and records within the permitted sales
  scope.
- An **Accountant** can prepare financial records but cannot perform actions
  reserved for the owner.
- Payments cannot be edited or deleted. A correction is recorded as a
  reversal.

---

## 4. The normal business workflow

Use this order for a normal sale:

1. Add the client, or choose **Walk-in**.
2. Confirm that the products exist in the catalogue.
3. Create the order and add its line items.
4. Confirm the order when it is accepted.
5. Move the order through production and delivery.
6. Convert the confirmed order to an invoice.
7. Record each payment as it is received.
8. Print or share the invoice and receipt when required.
9. Review the dashboard and overdue balances.

For stock purchases:

1. Add the supplier.
2. Create the purchase.
3. Confirm receipt when the goods arrive.
4. Record the supplier payment when it is made.

---

## 5. Set up the system

The owner should complete this section before staff begin daily work.

### 5.1 Complete company settings

1. Open **Settings**.
2. Enter the company profile:
   - Company name.
   - Logo, if available.
   - Address.
   - Phone and email.
   - KRA PIN.
   - VAT status.
3. Save the changes.
4. Open the tax settings and confirm whether VAT is enabled and what rate
   applies.
5. Payroll is not active in the current release, so do not enter statutory
   payroll rates yet. They will be configured before Payroll is reintroduced.

The owner must verify the tax value because it affects invoices and supplier
purchases.

### 5.2 Invite staff

1. Open **Users**.
2. Select **Invite user**.
3. Enter the person's name, email address, phone number, and role.
4. Review the role carefully.
5. Send the invitation.
6. Tell the person to use the invitation email and change their temporary
   password.

Use the smallest role that allows the person to do their work. A role can be
changed later by the owner.

### 5.3 Add varieties

1. Open **Products**.
2. Select **Add a variety**.
3. Enter the variety name.
4. Save it.
5. Repeat for every variety sold by the business.

Examples of separate varieties or forms may include:

- Baby Blue — standard.
- Baby Blue — spray.

### 5.4 Add products

Create a separate product for each variety and form that has its own price or
stock.

1. Open **Products**.
2. Select **Add product**.
3. Complete:
   - **Variety**.
   - **SKU**: a unique short code.
   - **Unit**.
   - **Cost price in shillings**.
   - **Selling price in shillings**.
   - **Low-stock threshold**.
4. Review the values.
5. Select **Add product** or **Save**.
6. Repeat for every product.

Use the cost price for what the business pays or spends to produce the item.
Use the selling price for the customer price. Do not create one product for
two forms if they have separate stock.

Example product input:

| Field               | Example   |
| ------------------- | --------- |
| Variety             | Baby Blue |
| Form                | Standard  |
| SKU                 | BB-STD    |
| Unit                | Stem      |
| Cost price          | `20.00`   |
| Selling price       | `50.00`   |
| Low-stock threshold | `700`     |

For a spray product, use a separate record such as `GUN-SPRAY`, with form
`Spray`, cost `30.00`, selling price `80.00`, and threshold `100`.

### 5.5 Add opening stock

1. Open **Products**.
2. Find the product.
3. Select the stock movement action.
4. Choose the appropriate movement type, such as an opening or purchase
   movement.
5. Enter the quantity and cost details.
6. Add a clear reason or note.
7. Save the movement.

Every stock change must have a movement. Do not try to type a current stock
total into a product record.

---

## 6. Add clients

Add a client before creating the first order for that client.

1. Open **Clients**.
2. Select **Add client**.
3. Enter the client's **Name**.
4. Select the **Type**:
   - Individual.
   - Corporate.
   - Event planner.
5. Enter the phone number in Kenyan format, for example `0712 004 518`.
6. Enter the email address, if available.
7. Enter the KRA PIN for a client who requires it on invoices.
8. Enter the address.
9. Enter **Credit terms** in days:
   - `0` means payment is due on delivery.
   - A positive number means the number of days allowed before the invoice is
     due.
10. Add notes only when they are useful to future staff.
11. Select **Add client**.

Example client input:

| Field        | Example                 |
| ------------ | ----------------------- |
| Name         | Green Valley Events Ltd |
| Type         | Corporate               |
| Phone        | `0712 004 518`          |
| Email        | accounts@example.com    |
| KRA PIN      | A012345678X             |
| Address      | Limuru Road, Nairobi    |
| Credit terms | `30` days               |

### Correct a client record

1. Open **Clients**.
2. Search by name or phone.
3. Open the client.
4. Select the edit action.
5. Make the correction.
6. Select **Save changes**.

Do not create a duplicate client because a phone number was entered
differently. Search first.

### Walk-in sales

Use a walk-in order when there is no client record:

1. Open **Orders**.
2. Start a new order.
3. Select **Walk-in** instead of selecting a client.
4. Continue with the order line items.

Do not create a client record just to represent a one-time walk-in sale.

---

## 7. Create and process an order

### 7.1 Start an order

1. Open **Orders**.
2. Select **Add order** or the new-order action.
3. Select a client, or select **Walk-in**.
4. Choose the **Order type**:
   - Standard.
   - Event.
5. Select the **Currency** used for this sale.
6. Add each line item:
   - Choose a catalogue product, or enter a custom line when appropriate.
   - Enter the quantity.
   - Confirm the unit price.
   - Check the line total.
7. Enter an order discount only if it has been approved.
8. Enter the delivery date and time.
9. Enter the delivery address.
10. For an event order, enter the venue and setup notes.
11. Enter a delivery number or internal reference if needed.
12. Add notes for the production or delivery team.
13. Review the subtotal, discount, and total.
14. Save the order as a draft.

Example order input:

| Field         | Example                         |
| ------------- | ------------------------------- |
| Client        | Green Valley Events Ltd         |
| Delivery date | `15/11/2026`                    |
| Product       | Baby Blue standard              |
| Quantity      | `300` stems                     |
| Unit price    | `50.00`                         |
| Discount      | `0.00`                          |
| Customer note | Deliver to the events warehouse |

The line total is `300 x 50.00 = 15,000.00`. Confirm the order only after
the customer accepts it.

### 7.2 Edit a draft

Only the permitted user can edit a draft. Sales users can edit only their own
draft orders.

1. Open the order.
2. Check that its status is **Draft**.
3. Correct the client, line items, date, address, discount, or notes.
4. Save the changes.

Once an order has progressed beyond draft, do not change it to avoid losing the
history of the sale.

### 7.3 Move an order through its statuses

Use the status actions in order:

1. **Draft** — information is still being prepared.
2. **Confirmed** — the customer accepted the order.
3. **In production** — work has started.
4. **Ready** — the order is ready for collection or delivery.
5. **Delivered** — the customer received it.
6. **Closed** — the transaction is complete.

Only a manager or owner may cancel an order. A cancellation reason is
required.

### 7.4 Print or share an order summary

1. Open the order.
2. Select the order-summary document action.
3. Select **Print or save as PDF**.
4. Print the document or save it as a PDF.
5. Share it through the approved company channel if needed.

Documents are formatted for A4 paper. Normal documents fit on one page. If a
document has more line items than can fit on one A4 page, the item table
continues onto the next page with its headings repeated.

---

## 8. Create an invoice

Invoices are normally created from a confirmed order.

1. Open **Orders**.
2. Open the confirmed order.
3. Select **Convert to invoice**.
4. Review:
   - Client details.
   - Company details.
   - Line items.
   - Currency.
   - Subtotal.
   - Discount.
   - VAT.
   - Total.
   - Issue date.
   - Due date.
5. Save or issue the invoice as permitted by your role.

The invoice number has the form `INV-YYYY-NNNN`. It is allocated by the
server. An invoice created while offline may not show its final number until it
synchronises.

Example invoice review:

- Product: `300` Baby Blue standard stems at `50.00` each.
- Subtotal: `15,000.00`.
- Discount: `0.00`.
- VAT: use the configured tax setting; do not calculate a second tax manually.
- Total: confirm that it matches the order before issuing.
- Due date: `15/12/2026` for 30-day credit terms.

### Invoice statuses

- **Draft**: still being prepared.
- **Unpaid**: issued, with no payment recorded.
- **Partially paid**: payments exist but do not cover the total.
- **Paid**: recorded payments cover the total.
- **Overdue**: the due date has passed and the invoice is not fully paid.
- **Voided**: the invoice was cancelled with a recorded reason.

The payment-based statuses are calculated from the invoice and its payments.
Do not type a balance into an invoice.

### Print or share an invoice

1. Open **Invoices**.
2. Open the invoice.
3. Select the invoice document action.
4. Select **Print or save as PDF**.
5. Check the printed document before sending it to the client.

Invoices use the same A4 rule: one page when the content fits, and additional
pages only when the line-item table is longer than one page.

---

## 9. Record payments and receipts

Record a payment immediately after money is received.

1. Open **Invoices**.
2. Open the relevant invoice.
3. Select **Record payment**.
4. Enter the amount received.
5. Select the method:
   - M-Pesa.
   - Cash.
   - Bank transfer.
   - Cheque.
6. Enter a reference, such as the M-Pesa transaction code, when available.
7. Enter the date the money moved in **Received on**.
8. Add a note if the payment needs explanation.
9. Select **Record payment**.
10. Confirm the new balance.

An invoice can have multiple partial payments.

Example payment input:

| Field       | Example                      |
| ----------- | ---------------------------- |
| Amount      | `10,000.00`                  |
| Method      | M-Pesa                       |
| Reference   | QWE123XYZ                    |
| Received on | `15/11/2026`                 |
| Note        | Deposit received on delivery |

### Correct a payment

Payments are append-only and cannot be edited or deleted.

1. Open the invoice and the incorrect payment.
2. Select the reversal action.
3. Enter a clear reason.
4. Confirm the reversal.
5. Record the correct payment as a new payment if necessary.

Never create a negative payment to correct an error.

### Print a receipt

1. Open the invoice.
2. Find the payment.
3. Select **Print receipt**.
4. Select **Print or save as PDF**.
5. Give the receipt to the customer through the approved channel.

---

## 10. Suppliers and purchases

This area is available to owners, managers, and accountants.

### 10.1 Add a supplier

1. Open **Suppliers**.
2. Select **Add supplier**.
3. Enter:
   - Supplier name.
   - Contact person.
   - Phone.
   - Email.
   - Payment terms in days.
   - KRA PIN.
   - Notes.
4. Select **Add supplier**.

Example supplier input:

| Field          | Example                   |
| -------------- | ------------------------- |
| Supplier name  | Highland Foliage Supplies |
| Contact person | Mary Wanjiku              |
| Phone          | `0722 111 222`            |
| Email          | accounts@supplier.example |
| Payment terms  | `30` days                 |
| KRA PIN        | P051234567Y               |

### 10.2 Create a purchase

1. Open **Suppliers**.
2. Start a new purchase.
3. Select the supplier.
4. Enter the purchase date.
5. Confirm the payment due date.
6. Add each product line:
   - Product.
   - Quantity.
   - Unit cost.
7. Check the purchase total.
8. Save the purchase.

### 10.3 Receive a purchase into stock

Stock increases only when the purchase is marked as received.

1. Open the purchase.
2. Compare the delivered goods with the purchase lines.
3. Correct the received quantities if the system allows it.
4. Select **Mark received**.
5. Confirm the receipt.
6. Check the product stock movement or stock total.

Do not record a purchase-in movement separately for the same receipt. The
receipt action creates the stock movement.

### 10.4 Record a supplier payment

1. Open the supplier or purchase.
2. Select **Record supplier payment**.
3. Enter the amount and payment date.
4. Select the payment method.
5. Enter the reference.
6. Save the payment.
7. Review payables aging.

---

## 11. Dashboard, reports, and audit history

### Dashboard

1. Open **Dashboard**.
2. Select the relevant date range.
3. Review daily sales, the 30-day trend, rankings, balances, aging, and
   alerts available to your role.
4. Use the export action when a CSV is required.

Sales users see their permitted performance scope. Financial totals may be
restricted by role.

### Audit log

Owners and managers can open **Audit log**.

Use filters for:

- User.
- Action type.
- Date range.

Use the audit log to answer who changed a role, price, payment, stock
adjustment, or other sensitive record.

---

## 12. Synchronisation and offline work

### What to do after entering data

1. Finish and save the record.
2. Check the sync indicator.
3. If it says **Pending**, keep the app open and connected to the internet.
4. Select **Sync now** if you need to send the change immediately.
5. Wait until the indicator returns to **Synced**.

The app remains usable while a change is pending. Do not enter the same record
again just because it has not appeared on another device yet.

### Working offline

When offline:

- Continue entering permitted records on the device.
- Expect the record to remain pending.
- Keep the device secure.
- Do not assume another device can see the record yet.
- Do not create duplicate clients, orders, invoices, or payments.

Invoices receive their final server number after synchronisation. Payment
records are preserved as separate entries when several devices record payments
offline.

### When a sync stays pending

1. Check the device's internet connection.
2. Leave the app open for a moment.
3. Select **Sync now**.
4. Check whether the account is still active.
5. Contact the owner if the problem continues.

Do not clear app data or reinstall the application before the owner confirms
that all pending records are safe.

---

## 13. Daily closing checklist

At the end of each working day:

- Check that all accepted orders have the correct status.
- Check that delivered orders have been invoiced.
- Record every payment received.
- Print or share receipts requested by clients.
- Record stock wastage with a reason.
- Check low-stock alerts.
- Review overdue invoices when responsible for collections.
- Confirm that supplier receipts have been marked received.
- Check the sync indicator.
- Leave no important change in a pending state without telling the owner.

---

## 14. Common mistakes to avoid

- Do not create duplicate clients without searching first.
- Do not create a product for a stock form that already exists.
- Do not type a current stock total directly into a product.
- Do not create an invoice before checking the order total.
- Do not use the wrong currency for an order.
- Do not mark an invoice paid without recording the payment.
- Do not edit or delete a payment; use a reversal.
- Do not mark a purchase received before the goods arrive.
- Do not record the same purchase receipt twice.
- Do not share passwords or use another person's account.
- Do not repeat an offline entry just because it is waiting to sync.

---

## 15. Quick reference

| I need to...           | Open...         | Then...                                  |
| ---------------------- | --------------- | ---------------------------------------- |
| Add a customer         | Clients         | Add client                               |
| Add a variety          | Products        | Add a variety                            |
| Add a product          | Products        | Add product                              |
| Record stock           | Products        | Stock movement                           |
| Create a sale          | Orders          | Add order                                |
| Invoice a sale         | Orders          | Convert to invoice                       |
| Receive money          | Invoices        | Record payment                           |
| Correct a payment      | Invoice payment | Reverse, then record the correct payment |
| Add a supplier         | Suppliers       | Add supplier                             |
| Record a purchase      | Suppliers       | New purchase                             |
| Add received stock     | Purchase        | Mark received                            |
| Invite staff           | Users           | Invite user                              |
| Change company details | Settings        | Company profile                          |
| Check changes          | Audit log       | Filter by user or action                 |
| Send waiting records   | Top bar         | Sync now                                 |

---

## 16. When to contact the owner

Contact the owner when:

- Your role or access is wrong.
- You need a new user account.
- You need a permission change.
- A payment must be corrected.
- An invoice must be voided.
- A product price or stock figure is disputed.
- A record remains pending after a connection and manual sync.
- You are unsure whether a purchase has already been received.

When reporting a problem, include the screen name, the record number or name,
what you expected, what happened, and whether the sync indicator was
**Synced**, **Pending**, or **Offline**.
