# Company email setup — Rasko Sweet Scent

Deliverable 4 (PRD §10): company email mailboxes on the company domain. This covers
buying them through Namecheap and reading and sending them from Gmail, so nobody has
to learn new software.

Companion to `docs/auth-setup.md` §2 — the app's own automated email is a **different
problem with a different answer**, covered in §6 below.

Prices and Google's POP3 removal were verified on 5 September 2026 against the sources
in §9. Re-check before purchase.

---

## The short answer

Buy **one** Namecheap Private Email mailbox for the domain. Add every other address
(`sales@`, `orders@`, `accounts@`) as a free **alias** on that one mailbox. Forward
the mailbox into the Gmail account already in daily use, and register the addresses in
Gmail under **Send mail as**.

Everything then arrives in the Gmail inbox you already know, and replies go out as
`sales@yourdomain` rather than a personal Gmail address.

|            |                                         |
| ---------- | --------------------------------------- |
| First year | ≈ KES 1,600 (US$11.88)                  |
| Renewal    | ≈ KES 3,100 / year (US$23.88)           |
| Setup time | ~40 minutes, most of it waiting for DNS |

---

## 1. Read this before following any older guide

**Google removed "Check mail from other accounts" in January 2026.** That was the POP3
feature which let Gmail reach out and pull mail from a domain mailbox. Almost every
tutorial written before 2026 is built on it, and those instructions now dead-end at a
settings screen that no longer exists.

What still works:

- Mail being **pushed** to Gmail by forwarding.
- **Send mail as** over SMTP for outgoing mail. Sending was never affected.

That is why the setup below forwards rather than fetches. The rule worth remembering:
**Gmail no longer collects your mail — your domain has to deliver it.** Forwarding is
the delivery mechanism, and it is free.

## 2. The three ways to do this

| Approach                                | Receiving | Sending                                                            | Per year                           |
| --------------------------------------- | --------- | ------------------------------------------------------------------ | ---------------------------------- |
| Free forwarding only                    | Works     | **No.** Forwarding has no mailbox and no SMTP, so nothing can send | KES 0                              |
| **One mailbox + aliases** (recommended) | Works     | Works for every alias                                              | ≈ KES 3,100                        |
| Google Workspace                        | Works     | Works                                                              | ≈ KES 43,300 (4 users at $7/month) |

Free forwarding alone is the trap. Namecheap gives it away with the domain and it looks
sufficient right up to the first time someone tries to reply to a customer — and then
the reply leaves as a personal Gmail address, on an invoice-related thread. A single
mailbox fixes that for about KES 3,100 a year.

Google Workspace is the better product and roughly fourteen times the price. It earns
that when each staff member needs their own login, calendar and Drive. For four shared
addresses read by one or two people, it does not.

**On Zoho's free plan.** It is the usual "cheap" recommendation and would not work here:
it dropped IMAP and POP access for new accounts, so mail is reachable only through Zoho's
own webmail and app. That is precisely the "learn new software" outcome this setup
exists to avoid.

## 3. Setting it up

Five steps, in order — DNS has to be right before mailboxes are worth creating.

Where the domain is registered does not matter. Private Email works on any domain,
including a `.co.ke` held at a Kenyan registrar, because it is driven by DNS records
rather than by ownership.

### Step 1 — Buy one Private Email mailbox

Namecheap → Apps → Private Email → Starter, 1 mailbox.

Around **$0.99/month billed annually** for the first year, renewing near **$1.99/month**.
Billing is annual only. There is a 60-day trial if you want to prove the flow before
paying.

Buy it **now rather than later**: subscriptions created after 2 June 2026 can send from
aliases, and older ones cannot. That single difference is what makes one mailbox enough.
On an older subscription every sending address must be a separate paid mailbox — about
four times the cost.

### Step 2 — Point the DNS records at it

Domain List → Manage → Advanced DNS, at whichever registrar holds the domain. Namecheap
can add the first three automatically if the domain is registered with them; check them
against this table anyway.

| Type        | Host                      | Value                                                 | Priority |
| ----------- | ------------------------- | ----------------------------------------------------- | -------- |
| MX          | `@`                       | `mx1.privateemail.com`                                | 10       |
| MX          | `@`                       | `mx2.privateemail.com`                                | 10       |
| TXT (SPF)   | `@`                       | `v=spf1 include:spf.privateemail.com ~all`            | —        |
| TXT (DKIM)  | `privateemail._domainkey` | Copy from the Private Email dashboard                 | —        |
| TXT (DMARC) | `_dmarc`                  | `v=DMARC1; p=quarantine; rua=mailto:admin@yourdomain` | —        |

Older subscriptions use `default._domainkey` as the DKIM host instead.

All five matter. MX decides where mail lands; SPF, DKIM and DMARC are what stop your
invoices from being filed as spam. Skipping the last three is the single most common
reason a new business domain lands in junk for months.

Records usually take under an hour and may take up to 24. Verify at
[mxtoolbox.com](https://mxtoolbox.com) before continuing.

### Step 3 — Create the mailbox, then the aliases

privateemail.com → Settings → Mailboxes / Aliases.

Create `admin@` as the real mailbox. It holds the password and the SMTP credentials, and
no customer needs to see it. Everything customer-facing is a free alias on top.

| Address     | Type                   | Purpose                                                    |
| ----------- | ---------------------- | ---------------------------------------------------------- |
| `admin@`    | Mailbox (the paid one) | Owner. Holds credentials, receives DNS and billing notices |
| `info@`     | Alias                  | General enquiries, printed on the website                  |
| `sales@`    | Alias                  | Quotes and order enquiries                                 |
| `orders@`   | Alias                  | Order confirmations and delivery notes                     |
| `accounts@` | Alias                  | Invoices, receipts, supplier statements                    |

Aliases cost nothing and more can be added later. Only addresses you need to **send**
from have to be aliases on the mailbox — a receive-only address can use Namecheap's free
Email Forwarding instead, which never touches the subscription.

### Step 4 — Forward the mailbox into Gmail

privateemail.com → Settings → Forwarding.

Forward everything to the Gmail address in daily use, and **keep a copy on the server**.
The copy is the backup: if the Gmail account is ever lost, the business correspondence
still exists on the domain.

Send a test message from a phone to `sales@` and confirm it reaches Gmail before moving
on.

### Step 5 — Teach Gmail to send as the domain

Gmail → Settings → See all settings → Accounts and Import → Send mail as → Add another
email address. Repeat once per address.

Leave **Treat as an alias** ticked; untick it only for an address that belongs to somebody
else.

| Field       | Value                                                            |
| ----------- | ---------------------------------------------------------------- |
| SMTP server | `mail.privateemail.com`                                          |
| Port        | 465 (SSL), or 587 for TLS                                        |
| Username    | `admin@yourdomain` — the full mailbox address, **not** the alias |
| Password    | The mailbox password                                             |
| Security    | SSL. Unencrypted connections are refused                         |

Gmail sends a confirmation code to each address. It arrives through the forwarding set up
in step 4 — which is also a clean test that step 4 worked.

Then set the one option that makes this behave normally, in the same settings panel:

> **When replying to a message → Reply from the same address the message was sent to.**

Without it, every reply leaves as your personal Gmail regardless of which address the
customer wrote to. With it, a message to `accounts@` is answered by `accounts@` and nobody
has to remember anything.

## 4. What it costs

| Item                               | First year             | Renewal                |
| ---------------------------------- | ---------------------- | ---------------------- |
| Private Email, 1 mailbox           | $11.88                 | $23.88                 |
| Aliases × 4                        | Free                   | Free                   |
| Brevo relay for app email (§6)     | Free                   | Free                   |
| Gmail (the account already in use) | Free                   | Free                   |
| **Total**                          | **$11.88 ≈ KES 1,600** | **$23.88 ≈ KES 3,100** |

Converted at roughly KES 130 to the dollar — confirm the rate at the time of purchase.
Domain registration and renewal are separate and not included.

## 5. What will bite you

**An older Private Email subscription.** Only subscriptions created after 2 June 2026 can
send from aliases. On an older one this plan silently degrades into needing a paid mailbox
per address. Confirm alias sending works before creating all the aliases.

**Two SPF records.** Adding Brevo's SPF as a second record rather than merging it into the
existing one breaks authentication for _both_ senders. One record, multiple `include:`
entries.

**Reply-from occasionally picking the wrong address.** Gmail infers the reply address from
the forwarded message's headers, and forwarding can obscure them. It is right the vast
majority of the time; check the From field on anything financial before sending. The
address is a dropdown in the compose window.

**The Gmail account becomes a single point of failure.** Everything lands in one personal
Google account. Enable two-factor authentication on it, and keep the "leave a copy on the
server" setting from step 4 so the domain retains its own copy.

**`.co.ke` may not be purchasable at Namecheap.** Kenyan domains are administered by KeNIC
and Namecheap's catalogue may not carry them. This affects nothing above — buy the domain
from a Kenyan registrar and still use Namecheap Private Email, because email hosting
follows the DNS records, not the registrar.

## 6. The app's automatic emails are a separate problem

The app sends password-reset and user-invitation email of its own (FR-1.5, and
`docs/auth-setup.md` §2). **Do not point Supabase at the mailbox created above.**

Mailbox providers rate-limit outgoing mail and treat machine-generated bursts as
compromise. A staff invite going out at 2am from the same credentials the owner reads mail
with is how a mailbox gets suspended — taking the business inbox down with it.

Use a transactional relay instead. Brevo is free permanently at 300 messages a day, far
above what fewer than ten users will ever generate.

| Field       | Value                                                         |
| ----------- | ------------------------------------------------------------- |
| SMTP server | `smtp-relay.brevo.com`                                        |
| Port        | 587 (STARTTLS)                                                |
| Username    | The Brevo account email                                       |
| Password    | An SMTP key generated in Brevo — **not** the account password |
| Sender      | `no-reply@yourdomain`                                         |

Brevo needs its own SPF and DKIM records on the domain. Add them alongside the Private
Email ones; the two coexist, because a single SPF record holds several `include:` entries.
Keep one SPF record only — two SPF records on one domain is an error that fails both.

## 7. Checklist

- [ ] Private Email subscription purchased, dated after 2 June 2026
- [ ] MX, SPF, DKIM and DMARC records added and verified on mxtoolbox.com
- [ ] `admin@` mailbox created; password stored somewhere the owner can reach
- [ ] Four aliases created
- [ ] Forwarding to Gmail on, with a copy kept on the server
- [ ] Test message sent to `sales@` and received in Gmail
- [ ] All five addresses added to Gmail under Send mail as
- [ ] "Reply from the same address the message was sent to" selected
- [ ] Test reply sent and confirmed to arrive from the domain address
- [ ] Brevo account created, SPF merged, DKIM added
- [ ] Supabase SMTP switched to Brevo and a password reset tested end to end
- [ ] Two-factor authentication enabled on the Gmail account

## 8. Still needed from the client

- The domain itself, if not already registered (PRD §12 question 1 names the business but
  no domain is recorded).
- Which Gmail account should receive the forwarded mail.
- Whether any staff member needs their own separate login — if so, that address becomes a
  paid mailbox rather than an alias, or the answer changes to Google Workspace.

## 9. Sources

Verified 5 September 2026.

- [Namecheap Private Email pricing](https://www.namecheap.com/support/knowledgebase/article.aspx/9185/2177/prices-for-additional-mailboxes-for-namecheap-private-email/)
- [Namecheap Private Email aliases](https://www.namecheap.com/support/knowledgebase/article.aspx/10791/2306/new-how-to-create-an-alias-for-namecheap-private-email/)
- [Namecheap mail client settings](https://www.namecheap.com/support/knowledgebase/article.aspx/1179/2175/general-private-email-configuration-for-mail-clients-and-mobile-devices/)
- [Gmail dropping POP3 fetching](https://www.theregister.com/2026/01/05/gmail_dropping_pop3/)
- [Brevo free SMTP relay](https://www.brevo.com/free-smtp-server/)
- [Zoho Mail free plan IMAP access](https://aiemaily.com/blog/zoho-mail-free-plan-imap-access)

## Client email from the app (migration 20260925000100)

Invoices, receipts, order confirmations, payment reminders and general messages
are sent from the app. Composing one inserts a queued `outbound_emails` row
locally; sync carries it up; an insert trigger calls the `send-email` function
through `pg_net`; the function renders the branded email and sends it over SMTP;
its status syncs back. A once-a-minute `pg_cron` sweep retries anything still
queued. Wording is edited in Settings > Emails; the brand frame lives in
`supabase/functions/_shared/email/layout.js`.

Hosted project, once:

```bash
supabase functions deploy send-email --no-verify-jwt
supabase secrets set \
  SMTP_HOST=smtp-relay.brevo.com SMTP_PORT=587 \
  SMTP_USER=<brevo login> SMTP_PASS=<brevo SMTP key> \
  EMAIL_FROM="Rasko Sweet Scent <hello@your-domain>" \
  SITE_URL=https://your-domain
```

Then, in the SQL editor, tell the database where the function lives:

```sql
update app.email_dispatch
   set function_url = 'https://<project-ref>.supabase.co/functions/v1/send-email';
```

Until that row is set, emails queue and nothing is lost; the sweep sends the
backlog once it is. `SITE_URL` must serve `/email/rss-logo.png` (the website's
`public/email/`), because mail clients block SVG and need a hosted image.

The Supabase Auth emails (invite, reset, password changed) use the same frame.
Regenerate them with `pnpm emails:auth` and paste `supabase/templates/*.html`
into Dashboard > Authentication > Email Templates.

Locally, `supabase/functions/.env` points SMTP at the stack's Mailpit
(`inbucket:1025`; Deno cannot resolve the underscored container name) and
`supabase/seeds/local.sql` sets the dispatch URL on every `db reset`. Sent mail
appears at http://127.0.0.1:54324.

## Delivery and failover (all email, auth included)

Supabase Auth takes a single SMTP server and cannot fail over, so it does not
send mail in this project. `[auth.hook.send_email]` hands every reset,
invitation and "password changed" notice to the `send-auth-email` function,
which verifies the hook signature, renders the branded email
(`_shared/email/auth.js`) and sends it through `_shared/email/transport.js`.
Client email (`send-email`) uses the same transport.

The transport tries `EMAIL_PROVIDERS` in order (default `brevo,resend,gmail`)
and moves to the next the moment one refuses. A provider that fails is
recorded in `email_provider_health` and skipped outright by every function
instance until its cooldown ends: an hour after a quota or rate-limit refusal,
two minutes after anything else. So once Brevo is out of its daily 300, the
next email goes straight to Resend without waiting on Brevo first. A refused
recipient address is not failed over, because every provider would refuse it.
If every healthy provider fails, resting ones are tried before giving up.

Credentials are function secrets. Locally, fill in `supabase/functions/.env`
(gitignored; the slots are already there), then `supabase stop && supabase start`.
With no provider filled in, mail goes to Mailpit so development still works.
Mailpit is never used alongside a real provider.

| Provider | Values                                            | Notes                                                                            |
| -------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Brevo    | `BREVO_SMTP_USER`, `BREVO_SMTP_KEY`, `BREVO_FROM` | SMTP & API > SMTP. The From address must be a verified sender. 300 a day free.   |
| Resend   | `RESEND_API_KEY`, `RESEND_FROM`                   | Needs a verified domain to send to anyone but the account holder.                |
| Gmail    | `GMAIL_USER`, `GMAIL_APP_PASSWORD`                | Last resort. App password needs 2-Step Verification. Sends as the Gmail account. |

Hosted: `supabase functions deploy send-auth-email --no-verify-jwt`, set the
same variables with `supabase secrets set`, then in Dashboard > Authentication >
Hooks enable "Send Email", point it at the function and copy the generated
secret into `supabase secrets set SEND_EMAIL_HOOK_SECRET=...`.
