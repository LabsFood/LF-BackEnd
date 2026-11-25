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

Service settings (on Railway, no config file): root directory `/ops/db-backup`, Dockerfile path `Dockerfile`, cron `0 2 * * *` (03:00 Paris in
winter), restart policy Never, watch paths `ops/db-backup/**`. A failed run shows as a
failed deployment. Old files: a lifecycle rule on the bucket deletes them after 30 days.

## Keys

```bash
age-keygen -o lf-db-backup.key   # prints the public key, age1…
```

The private key file goes in the password manager, never on Railway or in a repo.

## Restore

```bash
# 1. Fetch a backup (list them: aws s3 ls s3://lf-db-backups/lf-api/ --endpoint-url …)
aws s3 cp s3://lf-db-backups/lf-api/<stamp>.dump.age . \
  --endpoint-url https://<account>.eu.r2.cloudflarestorage.com
# 2. Decrypt it with the private key from the password manager
age --decrypt -i lf-db-backup.key -o restore.dump <stamp>.dump.age
```

Rehearse first on a scratch database, and check the row counts:

```bash
docker run -d --name lf-restore -p 5433:5432 -e POSTGRES_PASSWORD=x postgres:17
pg_restore --no-owner --no-privileges -n public \
  -d postgresql://postgres:x@localhost:5433/postgres restore.dump
```

Roll production back to that backup. Everything written since `<stamp>` is lost, so
stop the API first (API-Mainstream → scale to 0, or remove its deployment), and keep
a fresh dump of the current state beside it in case the rollback has to be undone:

```bash
pg_dump "$PROD_DB_URL" -Fc -f before-rollback.dump
pg_restore --clean --if-exists --single-transaction --no-owner --no-privileges \
  -n public -d "$PROD_DB_URL" restore.dump
```

`-n public` restores the application's tables only (Prisma lives in `public`); Supabase
manages `auth`, `storage` and its other schemas itself. `--single-transaction` means a
failed restore changes nothing. `$PROD_DB_URL` is the session URL on port 5432
(`SUPABASE_DB_MIGRATION_URL`), not the transaction pooler.
