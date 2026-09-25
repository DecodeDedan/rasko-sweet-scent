# Restore runbook — Rasko Sweet Scent

PRD §7 Reliability and §10 Deliverable 5. Backups run nightly from
`.github/workflows/backup.yml`; this is how you get the data back.

**A backup nobody has restored is a hypothesis, not a backup.** §5 below is a
quarterly drill, and it is the only thing that proves any of this works.

---

## 1. Before you touch anything

Work out which of two situations you are in, because the answers differ.

| Situation                                 | What to do                                                |
| ----------------------------------------- | --------------------------------------------------------- |
| Data is wrong but the database is up      | **Do not restore.** Go to §4 — restore a copy and compare |
| Database is gone, corrupt, or unreachable | Go to §3, full restore                                    |

A full restore **overwrites everything**, including anything recorded since the
backup was taken. Devices still hold their own SQLite mirror, so work done after
the dump is not necessarily lost — see §6 before you conclude it is.

## 2. What you need

- The R2 bucket credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_ENDPOINT`, `R2_BUCKET`) — the same values held in GitHub Actions secrets.
- `postgresql-client-17` (on a Mac, `brew install postgresql@17`). It must be
  at least the server's major version, 17 on the hosted project, or `pg_dump` and
  `pg_restore` refuse. Check with `select current_setting('server_version')`.
- The target database URL. For staging this is the staging project's connection
  string; for production, production's.

```bash
export AWS_ACCESS_KEY_ID=...   AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=auto R2_ENDPOINT=...   R2_BUCKET=...
```

## 3. Full restore

### 3.1 Pick and fetch a backup

```bash
# What is available.
aws s3 ls "s3://$R2_BUCKET/daily/"   --endpoint-url "$R2_ENDPOINT"
aws s3 ls "s3://$R2_BUCKET/monthly/" --endpoint-url "$R2_ENDPOINT"

# Fetch one.
aws s3 cp "s3://$R2_BUCKET/daily/rasko-2026-09-17.dump" . --endpoint-url "$R2_ENDPOINT"
```

### 3.2 Check it before you trust it

```bash
# Lists the archive contents. If this fails, the file is truncated — pick another.
pg_restore --list rasko-2026-09-17.dump | head -30

# Sanity: a healthy dump of this schema is well over 20 KB.
ls -lh rasko-2026-09-17.dump
```

### 3.3 Restore into **staging** first

Never restore straight into production. Restore to staging, confirm the figures
in §5.3, and only then repeat against production.

```bash
pg_restore \
  --dbname "$STAGING_DB_URL" \
  --clean --if-exists \
  --no-owner --no-privileges \
  --single-transaction \
  rasko-2026-09-17.dump
```

`--single-transaction` is the important flag: a restore that fails halfway rolls
back entirely rather than leaving a half-populated database that looks fine.

`--clean --if-exists` drops existing objects first. On an empty database it is a
no-op; on a populated one it is what makes the restore authoritative.

### 3.4 Re-apply anything newer than the dump

The dump contains the schema as it was. If migrations have been added since:

```bash
supabase db push   # applies any migration the restored database has not seen
```

### 3.5 Auth users

`auth.users` lives in the `auth` schema and is included in a full `pg_dump` of
the database. If you restored only `public`, people cannot sign in — confirm
`select count(*) from auth.users;` returns the expected number before declaring
the restore finished.

## 4. Partial recovery — one table, without losing everything else

The common real case: someone deleted or corrupted rows and you want them back
without rolling back the whole business.

```bash
# Restore only the affected table into a scratch database.
createdb rasko_scratch
pg_restore --dbname rasko_scratch --no-owner --no-privileges \
  --table=clients rasko-2026-09-17.dump

# Compare, then copy back only what is needed.
psql rasko_scratch -c "\copy (select * from clients where id = '...') to 'row.csv' csv header"
psql "$PROD_DB_URL" -c "\copy clients from 'row.csv' csv header"
```

Two cautions:

- **Deletes in this system are soft.** Before restoring anything, check whether
  the row is merely `deleted_at`-stamped, in which case clearing that column is
  the whole fix and no restore is needed.
- **Append-only tables must never be "corrected" by restore.** `payments`,
  `reversals`, `stock_movements`, `supplier_payments` and `audit_log` are
  append-only by design; a wrong payment is fixed with a reversal entry, not by
  editing history.

## 5. The quarterly drill

Run this every quarter. Put the date and the result in §7.

1. **Restore last night's dump into staging** — §3.1 to §3.3.
2. **Time it.** Record how long it took. That number is your recovery time, and
   the owner should know it before they need it.
3. **Reconcile against production.** These four figures must match:

   ```sql
   select count(*) from clients where deleted_at is null;
   select count(*) from invoices;
   select coalesce(sum(amount_cents), 0) from payments;
   select max(invoice_number) from invoices;
   ```

   Money is the one that matters. If `sum(amount_cents)` differs, stop and find
   out why before trusting any backup.

4. **Sign in.** Point a staging build at the restored database and sign in as the
   owner. A database that restores but cannot be logged into is not a recovery.
5. **Tear down staging** so nobody mistakes it for production later.

## 6. What the devices still hold

Every device keeps a full local SQLite mirror plus an outbox of writes it has not
yet pushed. After a restore:

- Rows the server lost but a device still holds are **not** pushed back
  automatically — the device believes they are already synced.
- Work still sitting in a device's outbox _will_ push on reconnect, so anything
  recorded offline after the dump survives.

If a device holds rows the restore lost, the mirror is at
`~/Library/Application Support/ke.rasko.sweetscent/rasko.db` (macOS) or
`%APPDATA%\ke.rasko.sweetscent\rasko.db` (Windows). It is an ordinary SQLite
file; export the missing rows and reinsert them server-side.

**Never hard-delete rows server-side to "clean up" after a restore.** A device
cannot be told about a hard delete, so the row lives on that device forever and
reappears in reports nobody can explain.

## 7. Drill log

| Date | Dump restored | Time taken | Figures matched | Run by |
| ---- | ------------- | ---------- | --------------- | ------ |
|      |               |            |                 |        |

_No drill has been run yet. The first one is part of go-live (PRD §11: "Backups
ran nightly for 7 consecutive nights; one restore tested into staging")._
