# Authentication setup — Rasko Sweet Scent

Companion to `docs/prd.md` FR-1.1 – FR-1.6. Everything here is project
configuration that lives in the Supabase dashboard or in function secrets, not in
the repository — which is the point: none of it can be committed by accident.

---

## 1. Auth settings (Dashboard → Authentication → Providers)

| Setting                    | Value          | Why                                                                                    |
| -------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| Email provider             | Enabled        | FR-1.1                                                                                 |
| Confirm email              | **On**         | An invited user must prove they own the address before signing in                      |
| Allow new users to sign up | **Off**        | Fewer than 10 named accounts, created by invitation only (PRD §3)                      |
| Minimum password length    | 8              | Matches `MIN_PASSWORD_LENGTH` in `ForcePasswordChangeScreen.tsx`; change both together |
| JWT expiry                 | 3600 (default) | See §5 on what this means for revocation                                               |

Sign-ups are off deliberately. With them on, anyone holding the anon key —
which ships inside the app and is therefore public — could create an account.
They would land with no `profiles` row and see nothing, but they would exist.

## 2. Custom SMTP (FR-1.5)

FR-1.5 requires password reset by **custom SMTP, not Supabase's default sender**.
Supabase's built-in sender is rate-limited and sends from a Supabase domain, which
is wrong for mail asking a Kenyan business's staff to reset a password.

Dashboard → Project Settings → Authentication → SMTP Settings:

| Field               | Value                                       |
| ------------------- | ------------------------------------------- |
| Sender email        | `no-reply@` the company domain              |
| Sender name         | `Rasko Sweet Scent`                         |
| Host / Port         | `smtp-relay.brevo.com` / 587 (STARTTLS)     |
| Username / Password | The Brevo account email and an SMTP **key** |

**Use a transactional relay, not the company mailbox.** Mailbox providers rate-limit
outgoing mail and treat machine-generated bursts as a sign of compromise. An invite
sent at 2am from the same credentials the owner reads mail with is how a mailbox gets
suspended — taking the business inbox down with it. Brevo's free tier is 300 messages
a day, far above what fewer than ten users generate.

The sender domain is part of Deliverable 4 — see `docs/email-setup.md`, which covers
the mailboxes themselves and the SPF/DKIM records Brevo needs alongside them. Until
SMTP is configured, invitations and resets still send from Supabase's default sender —
they work, but they will land in spam and they do not satisfy FR-1.5.

### Email templates

Dashboard → Authentication → Email Templates. Rewrite **Invite user** and **Reset
password** in the brand voice: plain professional Kenyan English, no emoji, no
exclamation marks (`docs/brand.md`).

Set the redirect on both to the same URL as `APP_PASSWORD_RESET_URL`, and add that
URL to Authentication → URL Configuration → Redirect URLs, or Supabase will refuse
it.

## 3. Why the reset link points at the website

The app is a Tauri desktop and Android build with no public URL, so a reset email
has nowhere to send the user. The flow is:

1. User taps **Forgot your password** in the app; the app calls
   `resetPasswordForEmail` with `redirectTo = APP_PASSWORD_RESET_URL`.
2. The email lands; the link opens a page on the marketing site.
3. That page completes the reset with the recovery token from the URL.
4. The user returns to the app and signs in with the new password.

**Step 3's page is not built yet.** It belongs with the website module. Until it
exists, the request and the email work, but the link has nowhere to land — so a
reset must be done from the Supabase dashboard in the meantime.

## 4. Edge functions

`invite-user` and `set-user-active` hold the service role key. It exists only in
function secrets — never in the app, never in the repository (PRD §7).

```bash
supabase functions deploy invite-user
supabase functions deploy set-user-active

# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
supabase secrets set APP_PASSWORD_RESET_URL="https://raskosweetscent.co.ke/reset-password"
```

Both functions re-verify that the caller is a signed-in, active **owner** before
doing anything, using the admin client rather than the caller's. The app hiding
these controls from non-owners is convenience; this check is the control.

## 5. How deactivation actually revokes access (FR-1.4, T4)

Two things happen, and both are needed:

1. **`profiles.is_active = false`.** Every RLS policy tests it, so the user's next
   request is refused immediately — even holding a valid, unexpired JWT. This is
   what actually revokes access.
2. **The auth user is banned.** An access token already issued stays
   cryptographically valid until it expires (JWT expiry, §1). A banned user cannot
   refresh it or sign in again.

Step 1 alone would let the token keep being refreshed indefinitely. Step 2 alone
would leave up to one JWT lifetime of continued read access. Together, the window
is: reads already permitted by an unexpired token continue to be refused by RLS,
and nothing can be renewed.

A device that is **offline** when someone is deactivated keeps showing its cached
screens, because nothing can reach it. The moment it reconnects, the profile fetch
fails, the cached identity is discarded and the user is signed out. That is T4, and
`apps/app/src/auth/__tests__/offlineLaunch.test.tsx` covers it.

## 6. Seeded demo accounts

`supabase/seed.sql` creates four fully-formed, signable-in accounts with fixed UUIDs, so
`docs/policy-tests.md` can impersonate them in SQL **and** the app can actually be used
after `supabase db reset`.

| Role       | Email                                | Password          |
| ---------- | ------------------------------------ | ----------------- |
| owner      | `owner@raskosweetscent.example`      | `rasko-demo-2026` |
| manager    | `manager@raskosweetscent.example`    | `rasko-demo-2026` |
| accountant | `accountant@raskosweetscent.example` | `rasko-demo-2026` |
| sales      | `sales@raskosweetscent.example`      | `rasko-demo-2026` |

A shared, published password is acceptable **only** because this seed is for local and
staging. Never run it against production: production accounts are created by invitation
and the user sets their own password on first sign-in (FR-1.6).

GoTrue needs more than a row in `auth.users` to authenticate someone — `aud` and `role`
must be `authenticated`, the email must be confirmed, and a matching `auth.identities`
row must exist. An earlier version of this seed inserted only `(id, email)` and produced
four accounts that silently could not sign in; the admin API could not repair them either,
because the records were too incomplete to update.

### Running the whole stack locally

```bash
supabase start          # Postgres, GoTrue, PostgREST, Studio, Mailpit
supabase db reset       # 17 migrations + seed
supabase status         # copy API URL and anon key into .env at the repo root
pnpm app:dev            # the desktop app
```

`.env` for a local stack — note **http**, which `env.ts` permits for loopback only:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<anon key from supabase status>
APP_ENV=development
```

Invitation and reset emails are captured by Mailpit at <http://127.0.0.1:54324> rather
than being delivered, so the FR-1.5 and FR-1.6 flows can be exercised without SMTP.

## 7. Checklist before go-live

- [ ] Sign-ups disabled
- [ ] Custom SMTP configured and a test invitation received from the company domain
- [ ] Invite and reset templates rewritten in the brand voice
- [ ] Redirect URL allowlisted, and the website reset page live (§3)
- [ ] Both edge functions deployed; `APP_PASSWORD_RESET_URL` secret set
- [ ] Owner account created and confirmed; seeded demo accounts removed from production
- [ ] Deactivation verified end to end on a real second device (T4)
- [ ] Each role verified against `docs/policy-tests.md`
