# syntax=docker/dockerfile:1
# App image for staging/prod (k8s/staging.yaml, built and pushed by k8s/deploy-staging.sh).
#   docker build --platform linux/amd64 -t shop-ai/app:dev .
# Runtime = Next.js standalone output (next.config.ts: output "standalone") + an isolated Prisma CLI in
# /migrate so the entrypoint can run `prisma migrate deploy` before `node server.js` (port 4710).

ARG NODE_IMAGE=node:22-alpine

# ─── base: openssl for the Prisma schema engine ──────────────────────────────
FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache openssl libc6-compat
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

# ─── deps: full install (postinstall = prisma generate needs the schema) ─────
FROM base AS deps
WORKDIR /src
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --no-audit --no-fund

# ─── builder: generate the client and build Next.js ──────────────────────────
FROM base AS builder
WORKDIR /src
COPY --from=deps /src/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ─── migrate: Prisma CLI only, isolated from the standalone node_modules ─────
# Versions pinned to package-lock.json (prisma, dotenv: prisma.config.ts imports dotenv/config).
FROM base AS migrate
WORKDIR /migrate
RUN echo '{"name":"migrate","private":true}' > package.json \
 && npm install --omit=dev --no-audit --no-fund --no-package-lock prisma@7.10.1 dotenv@18.0.10 \
 && npm cache clean --force
COPY prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations

# ─── runner ───────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=4710 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=migrate /migrate /migrate
COPY --from=builder --chown=node:node /src/.next/standalone ./
COPY --from=builder --chown=node:node /src/.next/static ./.next/static
COPY --from=builder --chown=node:node /src/public ./public
COPY --chmod=755 docker/app/entrypoint.sh /usr/local/bin/entrypoint.sh
USER node
EXPOSE 4710
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
