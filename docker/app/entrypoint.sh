#!/bin/sh
# Container entrypoint of the app image (see Dockerfile): apply pending Prisma migrations, then start Next.js.
# A failed migration exits non-zero, so the pod crash-loops instead of serving against a stale schema.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "entrypoint: DATABASE_URL is not set" >&2
  exit 1
fi

echo "entrypoint: prisma migrate deploy"
cd /migrate
node node_modules/prisma/build/index.js migrate deploy

echo "entrypoint: starting Next.js on ${HOSTNAME}:${PORT}"
cd /app
exec node server.js
