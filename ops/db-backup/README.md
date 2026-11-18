# Database backup

A Railway cron service (`db-backup`, project LF-API-Backend, production) runs this
image once a day: `pg_dump` of the production database, encrypted with
[age](https://age-encryption.org) for one public key, uploaded to a private R2 bucket.
Railway never holds the key that decrypts it.

Covers the database only. Storage buckets (KYC, invoices, messaging) are not in it.

## Variables (on the `db-backup` service)

| Variable | Value |
|---|---|
| `BACKUP_DATABASE_URL` | `${{API-Mainstream.SUPABASE_DB_MIGRATION_URL}}` (direct session, port 5432) |
| `BACKUP_AGE_RECIPIENT` | the `age1…` public key |
| `R2_ACCOUNT_ID` | Cloudflare account id |
| `R2_BUCKET` | the backup bucket, private, EU jurisdiction |
| `R2_JURISDICTION` | `eu` for a bucket created in the EU jurisdiction |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | an R2 token with Object Read & Write on that bucket only |
| `BACKUP_PREFIX` | optional, default `lf-api` |

Service settings: root directory `ops/db-backup`, cron `0 2 * * *` (03:00 Paris in
winter), restart policy Never, watch paths `ops/db-backup/**`. A failed run shows as a
failed deployment. Old files: a lifecycle rule on the bucket deletes them after 30 days.

## Keys

```bash
age-keygen -o lf-db-backup.key   # prints the public key, age1…
```

The private key file goes in the password manager, never on Railway or in a repo.

## Restore

```bash
aws s3 cp s3://<bucket>/lf-api/<stamp>.dump.age . \
  --endpoint-url https://<account>.eu.r2.cloudflarestorage.com
age --decrypt -i lf-db-backup.key -o restore.dump <stamp>.dump.age
pg_restore --no-owner --no-privileges -d "$TARGET_DATABASE_URL" restore.dump
```

Restore into a scratch database first (`docker run -p 5432:5432 -e POSTGRES_PASSWORD=x postgres:17`)
and check the row counts before touching production.
