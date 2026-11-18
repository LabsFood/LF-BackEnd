#!/bin/sh
# Dump the database, encrypt it for the age recipient, upload it to R2, exit.
# The dump never touches the disk in clear: pg_dump streams into age.
set -eu
set -o pipefail

: "${BACKUP_DATABASE_URL:?direct Postgres URL (session, port 5432)}"
: "${BACKUP_AGE_RECIPIENT:?age public key, age1…; its private key stays off Railway}"
: "${R2_ACCOUNT_ID:?Cloudflare account id}"
: "${R2_BUCKET:?private backup bucket, separate from the API bucket}"
: "${AWS_ACCESS_KEY_ID:?R2 key scoped to that bucket}"
: "${AWS_SECRET_ACCESS_KEY:?R2 key scoped to that bucket}"
PREFIX="${BACKUP_PREFIX:-lf-api}"
MIN_BYTES="${BACKUP_MIN_BYTES:-10000}"

endpoint="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.${R2_JURISDICTION:+${R2_JURISDICTION}.}r2.cloudflarestorage.com}"
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
file="/tmp/${PREFIX}-${stamp}.dump.age"

echo "backup: dumping"
pg_dump "$BACKUP_DATABASE_URL" --format=custom --no-owner --no-privileges \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$file"

size="$(wc -c < "$file" | tr -d ' ')"
if [ "$size" -lt "$MIN_BYTES" ]; then
  echo "backup: FAILED, ${size} bytes is too small for a dump" >&2
  exit 1
fi

echo "backup: uploading ${size} bytes"
AWS_DEFAULT_REGION=auto aws s3 cp "$file" "s3://${R2_BUCKET}/${PREFIX}/${stamp}.dump.age" \
  --endpoint-url "$endpoint" \
  --only-show-errors

rm -f "$file"
echo "backup: done ${PREFIX}/${stamp}.dump.age"
