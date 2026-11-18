# Nightly backup of the production database, run as a Railway cron service.
# pg_dump 17 reads a Postgres 15 or 17 server (Supabase), so one client fits both.
FROM postgres:17.6-alpine3.22

RUN apk add --no-cache age aws-cli \
  && adduser -D -u 10001 backup

COPY --chmod=0755 backup.sh /usr/local/bin/backup.sh

USER backup
WORKDIR /tmp
ENTRYPOINT ["/usr/local/bin/backup.sh"]
