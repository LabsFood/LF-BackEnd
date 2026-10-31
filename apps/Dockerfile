# syntax=docker/dockerfile:1.7

# Every stage runs the same exact Node build. Dependabot opens the bump PR when
# Node ships a release; `.nvmrc` must carry the same version (CI checks it).
FROM node:24.22.1-alpine3.24 AS deps
WORKDIR /app
COPY apps/package.json apps/package-lock.json ./
COPY apps/prisma ./prisma
RUN npm ci

FROM node:24.22.1-alpine3.24 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/package.json apps/package-lock.json apps/tsconfig.json apps/tsconfig.build.json apps/nest-cli.json ./
COPY apps/prisma ./prisma
COPY apps/src ./src
RUN npx prisma generate && npm run build

FROM node:24.22.1-alpine3.24 AS prod-deps
WORKDIR /app
COPY apps/package.json apps/package-lock.json ./
COPY apps/prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

FROM node:24.22.1-alpine3.24 AS runtime
WORKDIR /app

RUN apk update && apk upgrade --no-cache

# eMudhra (emSign) roots are distrusted (CA compromise, 2026-10-31). The API filters
# Node's own store at startup (src/config/trusted-roots.ts); this drops them from the
# system bundle, which the Prisma CLI's engine also trusts during migrate deploy.
RUN node <<'EOF'
const fs = require('fs');
const { X509Certificate } = require('crypto');
const file = '/etc/ssl/certs/ca-certificates.crt';
if (fs.existsSync(file)) {
  const pems = fs.readFileSync(file, 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  const kept = pems.filter((pem) => !/eMudhra|emSign/i.test(new X509Certificate(pem).subject));
  fs.writeFileSync(file, kept.join('\n') + '\n');
  console.log(`${file}: ${pems.length - kept.length} emSign roots removed`);
}
EOF

ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn

RUN addgroup -S nodeapp && adduser -S nodeapp -G nodeapp

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY apps/package.json apps/package-lock.json ./
COPY apps/prisma ./prisma
COPY apps/prisma.config.ts ./
COPY apps/src/config/env-files.ts ./src/config/env-files.ts
# prisma.config.ts imports it to verify the Supabase certificate during migrate deploy.
COPY apps/src/supabase/db-connection.ts ./src/supabase/db-connection.ts
COPY apps/src/config/trusted-roots.ts ./src/config/trusted-roots.ts
COPY apps/certs ./certs
COPY apps/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

RUN chmod +x ./scripts/docker-entrypoint.sh

USER nodeapp

EXPOSE 8000

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
