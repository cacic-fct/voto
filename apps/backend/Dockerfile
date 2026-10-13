# syntax=docker/dockerfile:1
FROM oven/bun:1-alpine AS bun

FROM node:26-alpine AS base
ENV BUN_INSTALL=/usr/local \
    NX_DAEMON=false \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROME_DOWNLOAD=true

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

RUN apk add --no-cache openssl

WORKDIR /workspace

FROM base AS deps
COPY package.json bun.lock ./
COPY .npmrc ./

RUN --mount=type=cache,target=/root/.bun/install/cache \
    --mount=type=secret,id=NPM_CONFIG_TOKEN,required=true \
    set -eu; \
    export NPM_CONFIG_TOKEN="$(cat /run/secrets/NPM_CONFIG_TOKEN)"; \
    bun install --frozen-lockfile

FROM deps AS prisma-deps
COPY apps/backend/prisma.config.ts ./apps/backend/prisma.config.ts
COPY apps/backend/prisma ./apps/backend/prisma

WORKDIR /workspace/apps/backend

RUN DATABASE_URL="postgresql://user:password@localhost:5432/db?schema=public" \
    bun x prisma generate --schema prisma/schema.prisma

FROM prisma-deps AS builder
WORKDIR /workspace

COPY nx.json tsconfig.base.json ./
COPY eslint.config.mjs jest.config.ts jest.preset.js ./

COPY apps/backend ./apps/backend
COPY libs ./libs

RUN bun x nx run backend:build:production

FROM base AS production-deps
ENV NODE_ENV=production

COPY bun.lock ./
COPY .npmrc ./
COPY --from=builder /workspace/dist/apps/backend/package.json ./package.json

# Nx emits the backend-only manifest but cannot prune Bun lockfiles. Reconcile
# the workspace lockfile with that manifest before the frozen runtime install.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    --mount=type=secret,id=NPM_CONFIG_TOKEN,required=true \
    set -eu; \
    export NPM_CONFIG_TOKEN="$(cat /run/secrets/NPM_CONFIG_TOKEN)"; \
    bun install --lockfile-only --ignore-scripts; \
    bun install --frozen-lockfile --production

COPY --from=prisma-deps /workspace/node_modules/.prisma ./node_modules/.prisma

FROM node:26-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

RUN apk add --no-cache dumb-init openssl \
    && addgroup -S app \
    && adduser -S app -G app

COPY --from=production-deps --chown=app:app /workspace/node_modules ./node_modules
COPY --chown=app:app apps/backend/prisma.config.ts ./apps/backend/prisma.config.ts
COPY --chown=app:app apps/backend/prisma ./apps/backend/prisma
COPY --from=builder --chown=app:app /workspace/dist/apps/backend ./

USER app

EXPOSE 3000 50051

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "main.js"]
