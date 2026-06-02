# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
WORKDIR /app
COPY apps/package.json apps/package-lock.json ./
COPY apps/prisma ./prisma
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/package.json apps/package-lock.json apps/tsconfig.json apps/tsconfig.build.json apps/nest-cli.json ./
COPY apps/prisma ./prisma
COPY apps/src ./src
RUN npx prisma generate && npm run build

FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY apps/package.json apps/package-lock.json ./
COPY apps/prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

FROM node:20-alpine AS runtime
WORKDIR /app
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
