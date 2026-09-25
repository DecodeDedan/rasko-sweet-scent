# Company email addresses

Owner request (2026-09-25): every account signs in with a
`name@raskosweetscent.com` address, created from the Users screen, and each
person reads and sends that mail in their own Gmail. No Google Workspace, no
mailbox fees. Recorded in `docs/PROGRESS.md` (decision 14) for client sign-off.

## How it works

There are no mailboxes. A company address is a **Cloudflare Email Routing rule**
that forwards to the person's own inbox.

1. **Invite** (Users screen → Invite user): the owner enters the person's name,
   their **personal email** and role; the company address is suggested from the
   name (`jane.kamau`) and can be edited. `invite-user` then:
   - registers the personal inbox as a Cloudflare destination (Cloudflare emails
     it a verification link),
   - creates the rule `jane.kamau@raskosweetscent.com → personal inbox`,
   - creates the account on the company address with a one-time invite link,
   - sends the branded invitation **to the personal inbox** (forwarding does not
     work until the Cloudflare link is clicked, so the new address cannot carry
     its own invitation), with the password link and a **Set up Gmail** button,
   - creates the profile last, so a failed email leaves no half-made account.
2. **Existing accounts** (Users screen → Give company email, on any row still on
   a personal address, including your own): `assign-company-email` forwards the
   new address to the account's current email, switches its sign-in to the new
   address and emails a notice. Password, role and history are untouched.
3. **Deactivate** pauses the forwarding rule, so mail stops reaching someone who
   has left; **Reactivate** resumes it.
4. **Sending**: the person follows `https://www.raskosweetscent.com/company-email/`
   once, on a computer: a Google app password, then Gmail's _Send mail as_ with
   `smtp.gmail.com:587`. Replies then go out from the company address.

Rules the server enforces (and `auth/userAdmin.ts` mirrors): any owner can
invite and give addresses; only the super admin can invite an owner or change
the super admin's account; an address is letters, numbers and single `.`, `-`
or `_` between them, at most 64 characters; the personal email cannot be a
company address.

## One-time setup

### 1. A Cloudflare API token

Cloudflare dashboard → **My Profile → API Tokens → Create Token → Create Custom
Token**:

| Setting           | Value                                           |
| ----------------- | ----------------------------------------------- |
| Token name        | `rasko-supabase-email-routing`                  |
| Permissions       | **Account · Email Routing Addresses · Edit**    |
|                   | **Zone · Email Routing Rules · Edit**           |
| Account resources | Include · your account                          |
| Zone resources    | Include · Specific zone · `raskosweetscent.com` |

Nothing else: this token can create forwarding rules, not change DNS, the
website or anything else in the account.

### 2. The two IDs

Cloudflare dashboard → `raskosweetscent.com` → **Overview**, right-hand column
under **API**: **Zone ID** and **Account ID**. They are identifiers, not secrets.

### 3. Function secrets

```bash
supabase secrets set STAFF_EMAIL_DOMAIN=raskosweetscent.com CLOUDFLARE_ACCOUNT_ID=<account id> CLOUDFLARE_ZONE_ID=<zone id>
supabase secrets set CLOUDFLARE_API_TOKEN=<token>
supabase functions deploy invite-user assign-company-email set-user-active
```

Until all four are set, inviting and giving addresses answer "Company email is
not set up on the server yet" and create nothing. For the local stack, put the
same four names in `supabase/functions/.env`.

### 4. SPF for sending from Gmail

Mail sent through Gmail's servers as `@raskosweetscent.com` needs Google in the
domain's SPF record. Cloudflare → Email → Email Routing → **Settings → Unlock
records**, then edit the root TXT record to:

```
v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all
```

Keep DMARC at `p=none`: Gmail's "Send mail as" signs with gmail.com, not the
company domain, so a stricter policy would send staff replies to spam.

## Limits worth knowing

- Mail to a new address bounces until its person clicks Cloudflare's
  verification email. The invitation says so; if someone reports missing mail,
  that link is the first thing to check (Cloudflare → Email Routing →
  Destination addresses shows who is still pending).
- Recipients may see "sent via gmail.com" beside a staff member's name. That is
  the cost of not paying for mailboxes; Google Workspace removes it.
- The software's own emails (invoices, resets, invitations) still go through
  Resend from `info@raskosweetscent.com` and are unaffected by any of this.
