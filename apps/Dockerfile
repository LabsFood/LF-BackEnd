# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npm run build

FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn

RUN addgroup -S nodeapp && adduser -S nodeapp -G nodeapp

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY prisma ./prisma

USER nodeapp

EXPOSE 8000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
