# =============================================================================
# WhatsApp Service (OpenWA) — multi-stage build
# =============================================================================
# Pulls the OpenWA source from upstream at build time, builds it, and ships
# a production image with Chromium for whatsapp-web.js.
#
# Pin OPENWA_REF to a specific commit/tag for reproducible builds.
# Override at build time:  docker build --build-arg OPENWA_REF=v0.1.6 .
# =============================================================================

ARG OPENWA_REPO=https://github.com/DriniNazeraj/whatsApp-comment.git
ARG OPENWA_REF=980d3001af5a1386854de074b152ec9e931eb4f9

# ===== Stage 1: Fetch sources =====
FROM alpine/git:latest AS source
ARG OPENWA_REPO
ARG OPENWA_REF
WORKDIR /src
RUN git clone --depth 1 --branch "${OPENWA_REF}" "${OPENWA_REPO}" openwa || \
    (git clone "${OPENWA_REPO}" openwa && cd openwa && git checkout "${OPENWA_REF}")

# ===== Stage 2: Build =====
FROM node:22-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY --from=source /src/openwa/package*.json ./
RUN npm ci

COPY --from=source /src/openwa/ ./
RUN npm run build

# ===== Stage 3: Production =====
FROM node:22-slim AS prod

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Point Puppeteer at the REAL Chromium binary, not Debian's /usr/bin/chromium
# launcher script. That script dies with "Trace/breakpoint trap (core dumped)"
# under our hardened securityContext (seccomp RuntimeDefault + drop ALL), which
# made the browser fail to launch on newer images. The binary itself runs fine.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/lib/chromium/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production

WORKDIR /app

COPY --from=source /src/openwa/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# ---------------------------------------------------------------------------
# Upstream patch: never throw when WhatsApp Web returns no message model.
#
# whatsapp-web.js sendMessage() DELIVERS the message and then builds a model
# from the page. When WhatsApp changes that page structure (it did on
# 2026-07-30), the model comes back undefined — but the message is already on
# the recipient's phone. Upstream then reads `msg.id._serialized` unguarded, so
# the gateway answers 500 for a delivered message. Our queue reads that as a
# failure and retries: recipients got the same reservation alert 3×.
#
# Optional chaining turns that into a 201 with a null id: delivery is reported
# honestly and nothing is re-sent. The id stays null until upstream catches up,
# so message deletion is unavailable for those sends — an acceptable trade
# against duplicate customer messages.
# ---------------------------------------------------------------------------
RUN set -eu; \
    adapter="./dist/engine/adapters/whatsapp-web-js.adapter.js"; \
    test -f "$adapter"; \
    grep -q 'msg\.id\._serialized' "$adapter" || { echo "patch target missing — upstream changed"; exit 1; }; \
    sed -i 's/id: msg\.id\._serialized,/id: msg?.id?._serialized ?? null,/g; s/timestamp: msg\.timestamp,/timestamp: msg?.timestamp ?? null,/g' "$adapter"; \
    grep -q 'msg?.id?._serialized' "$adapter" || { echo "patch did not apply"; exit 1; }; \
    echo "adapter patched: send no longer throws on a missing message model"

# ---------------------------------------------------------------------------
# Pin the WhatsApp Web build instead of following whatever WhatsApp serves.
#
# whatsapp-web.js declares webVersion '2.3000.1017054665' but ships
# webVersionCache.type = 'local', which fetches the CURRENT build on first
# launch and caches it. So the pin only holds while that cache survives. Ours
# did for 22 days; the pod restart on 2026-07-30 13:32 refetched and landed on
# 2.3000.1044218870, whose page layout the library cannot read — every send
# then delivered but returned no message model, surfacing as a 500.
#
# 'none' makes the library load its declared version every time, so a restart
# can no longer silently move us onto an unsupported build. Revisit when
# upstream bumps its pin — this is what keeps sends reportable.
# ---------------------------------------------------------------------------
RUN set -eu; \
    constants="./node_modules/whatsapp-web.js/src/util/Constants.js"; \
    test -f "$constants"; \
    grep -q "type: 'local'" "$constants" || { echo "webVersionCache shape changed upstream"; exit 1; }; \
    sed -i "s/type: 'local',/type: 'none',/" "$constants"; \
    grep -q "type: 'none'" "$constants" || { echo "webVersionCache patch did not apply"; exit 1; }; \
    echo "webVersionCache pinned to 'none' — library uses its declared WhatsApp Web build"

# ---------------------------------------------------------------------------
# Patch 3: reconstruct `_serialized` ids (WA Web 2026-07 renamed it to `$1`).
#
# Root cause of messageId:null after the 2026-07-30 incident: the new WhatsApp
# Web build no longer exposes `_serialized` on MsgKey/Wid objects, so the
# library's post-send lookup `Msg.get(newMsgKey._serialized)` became
# `Msg.get(undefined)` → no model → no id (and, pre-Patch-1, a 500).
#
# fix-getserialized.mjs ports WAHA 2026.7.2's fix: a GetSerialized helper that
# rebuilds the key string from the object's components, applied to the send/
# edit lookups and to getMessageModel (incoming messages + acks). Verified on
# a linked test session 2026-07-31: send returns a real `true_..@lid_..` id.
# Anchors are guarded — a missing anchor fails the build, not production.
# ---------------------------------------------------------------------------
COPY patches/fix-getserialized.mjs /tmp/patches/fix-getserialized.mjs
RUN node /tmp/patches/fix-getserialized.mjs && rm -rf /tmp/patches

# Session + media data live on a mounted PVC in k8s
RUN mkdir -p ./data/sessions ./data/media

EXPOSE 2785

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:2785/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]

# ===== Stage: dev (alias of prod) =====
# OpenWA is upstream code, not ours — no hot-reload workflow to enable.
# Provide a `dev` target so deploy.sh's --target dev path works the same way.
FROM prod AS dev

