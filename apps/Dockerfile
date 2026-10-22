# syntax=docker/dockerfile:1.7

# Every stage runs the same exact Node build. Dependabot opens the bump PR when
# Node ships a release; `.nvmrc` must carry the same version (CI checks it).
FROM node:22.23.4-alpine3.24 AS deps
WORKDIR /app
COPY apps/package.json apps/package-lock.json ./
COPY apps/prisma ./prisma
RUN npm ci

FROM node:22.23.4-alpine3.24 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/package.json apps/package-lock.json apps/tsconfig.json apps/tsconfig.build.json apps/nest-cli.json ./
COPY apps/prisma ./prisma
COPY apps/src ./src
RUN npx prisma generate && npm run build

FROM node:22.23.4-alpine3.24 AS prod-deps
WORKDIR /app
COPY apps/package.json apps/package-lock.json ./
COPY apps/prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

FROM node:22.23.4-alpine3.24 AS runtime
WORKDIR /app

RUN apk update && apk upgrade --no-cache

ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn

RUN addgroup -S nodeapp && adduser -S nodeapp -G nodeapp

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY apps/package.json apps/package-lock.json ./
COPY apps/prisma ./prisma
COPY apps/prisma.config.ts ./
COPY apps/src/config/env-files.ts ./src/config/env-files.ts
COPY apps/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

RUN chmod +x ./scripts/docker-entrypoint.sh

USER nodeapp

EXPOSE 8000

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
