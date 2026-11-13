#!/usr/bin/env bash
# Deploy the shop AI assistant to STAGING (shared staging k3s VPS, namespace shop-ai-staging, https://ai.square.al).
#
#   k8s/deploy-staging.sh            # build, push, update secret, apply, roll out
#   k8s/deploy-staging.sh --dry-run  # print the steps only (no docker, no ssh, no secret values)
#
# Needs: docker, git, ssh, curl; env STAGING_SSH_USER, STAGING_SSH_HOST, STAGING_SSH_KEY;
#        k8s/.env.staging (gitignored, template k8s/staging.env.example).
#
# The image is built from the committed HEAD (git archive), never from uncommitted files, so the tag
# <date>-<time>-<gitsha>-stg always matches a commit. Commit first.
#
# The VPS is shared and its disk is tight: this script never prunes docker or registry images there.
# Old tags stay in the VPS registry until someone removes them deliberately.
set -euo pipefail

NAMESPACE=shop-ai-staging
SECRET=shop-ai-env
IMAGE_NAME=shop-ai/app
REMOTE_REGISTRY=localhost:5000   # what the k3s node pulls from
TUNNEL_PORT=5004                 # local end of the ssh tunnel to the VPS registry
PUBLIC_URL=https://ai.square.al

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg (use --dry-run or --help)" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="$ROOT/k8s/.env.staging"
MANIFEST="$ROOT/k8s/staging.yaml"

die() { echo "error: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

# ─── Preflight (before any docker/ssh call) ──────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  if (( DRY_RUN )); then
    echo "WARNING: $ENV_FILE is missing: a real run would refuse here (cp k8s/staging.env.example k8s/.env.staging)."
  else
    die "$ENV_FILE is missing. cp k8s/staging.env.example k8s/.env.staging and fill it in. Refusing to deploy."
  fi
else
  # Required keys must be present and non-empty; quoted values would be stored with the quotes.
  for key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DATABASE_URL BETTER_AUTH_SECRET BETTER_AUTH_URL \
             ENCRYPTION_KEY OPENWA_WEBHOOK_SECRET; do
    grep -Eq "^${key}=.+" "$ENV_FILE" || die "$key is missing or empty in $ENV_FILE"
  done
  if grep -Eq '^[A-Z_]+=["'\'']' "$ENV_FILE"; then
    die "$ENV_FILE has quoted values; kubectl keeps quotes literally. Remove them."
  fi
  grep -Eq "^BETTER_AUTH_URL=${PUBLIC_URL}/?$" "$ENV_FILE" || die "BETTER_AUTH_URL must be ${PUBLIC_URL}"
  grep -Eq '^ENCRYPTION_KEY=[0-9a-fA-F]{64}$' "$ENV_FILE" || die "ENCRYPTION_KEY must be 64 hex chars (32 bytes)"
fi

if (( DRY_RUN )); then
  SSH_USER="${STAGING_SSH_USER:-\$STAGING_SSH_USER}"
  SSH_HOST="${STAGING_SSH_HOST:-\$STAGING_SSH_HOST}"
  SSH_KEY="${STAGING_SSH_KEY:-\$STAGING_SSH_KEY}"
else
  SSH_USER="${STAGING_SSH_USER:?set STAGING_SSH_USER}"
  SSH_HOST="${STAGING_SSH_HOST:?set STAGING_SSH_HOST}"
  SSH_KEY="${STAGING_SSH_KEY:?set STAGING_SSH_KEY}"
  [[ -r "$SSH_KEY" ]] || die "STAGING_SSH_KEY ($SSH_KEY) is not readable"
  for bin in docker git ssh curl; do command -v "$bin" >/dev/null || die "$bin not found"; done
fi

SHA="$(git rev-parse --short HEAD)"
TAG="$(date +%Y%m%d-%H%M%S)-${SHA}-stg"
REMOTE_IMAGE="${REMOTE_REGISTRY}/${IMAGE_NAME}:${TAG}"
PUSH_IMAGE="localhost:${TUNNEL_PORT}/${IMAGE_NAME}:${TAG}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=15)
SSH_TARGET="${SSH_USER}@${SSH_HOST}"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "NOTE: the working tree has uncommitted changes; they are NOT in the image (built from HEAD ${SHA})."
fi

# remote "<kubectl args>": runs sudo -n kubectl on the VPS (stdin is forwarded).
remote() { ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"; }

if (( DRY_RUN )); then
  cat <<EOF

DRY RUN: nothing is built, pushed or applied. Steps a real run would perform:

1. build   git archive --format=tar HEAD | docker build --platform linux/amd64 \\
             -t ${REMOTE_IMAGE} -t ${PUSH_IMAGE} -
2. tunnel  ssh ${SSH_OPTS[*]} -o ExitOnForwardFailure=yes -N -L ${TUNNEL_PORT}:127.0.0.1:5000 ${SSH_TARGET} &
           (wait for http://localhost:${TUNNEL_PORT}/v2/, closed again on exit)
3. push    docker push ${PUSH_IMAGE}
4. ns      ssh ${SSH_TARGET} sudo -n kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | sudo -n kubectl apply -f -
5. secret  ssh ${SSH_TARGET} "sudo -n kubectl -n ${NAMESPACE} create secret generic ${SECRET} --from-env-file=/dev/stdin \\
             --dry-run=client -o yaml | sudo -n kubectl apply -f -" < k8s/.env.staging
           (values travel over ssh stdin only; nothing is written to the VPS disk)
6. apply   sed 's/__IMAGE_TAG__/${TAG}/' k8s/staging.yaml | ssh ${SSH_TARGET} sudo -n kubectl apply -f -
7. db      ssh ${SSH_TARGET} sudo -n kubectl -n ${NAMESPACE} rollout status statefulset/postgres --timeout=180s
8. image   ssh ${SSH_TARGET} sudo -n kubectl -n ${NAMESPACE} set image deployment/app app=${REMOTE_IMAGE}
9. wait    ssh ${SSH_TARGET} sudo -n kubectl -n ${NAMESPACE} rollout status deployment/app --timeout=300s
10. check  ssh ${SSH_TARGET} sudo -n kubectl -n ${NAMESPACE} get pods,ingress,certificate
           then ${PUBLIC_URL}/login
EOF
  exit 0
fi

# ─── 1. Build ─────────────────────────────────────────────────────────────────
step "build ${REMOTE_IMAGE} from HEAD ${SHA}"
git archive --format=tar HEAD | docker build --platform linux/amd64 -t "$REMOTE_IMAGE" -t "$PUSH_IMAGE" -

# ─── 2-3. Tunnel + push ───────────────────────────────────────────────────────
step "open ssh tunnel localhost:${TUNNEL_PORT} -> ${SSH_HOST}:5000"
ssh "${SSH_OPTS[@]}" -o ExitOnForwardFailure=yes -N -L "${TUNNEL_PORT}:127.0.0.1:5000" "$SSH_TARGET" &
TUNNEL_PID=$!
trap 'kill "$TUNNEL_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  curl -sf "http://localhost:${TUNNEL_PORT}/v2/" >/dev/null && break
  kill -0 "$TUNNEL_PID" 2>/dev/null || die "ssh tunnel exited (port ${TUNNEL_PORT} busy?)"
  sleep 1
done
curl -sf "http://localhost:${TUNNEL_PORT}/v2/" >/dev/null || die "registry not reachable through the tunnel"

step "push ${PUSH_IMAGE}"
docker push "$PUSH_IMAGE"
kill "$TUNNEL_PID" 2>/dev/null || true

# ─── 4-5. Namespace + Secret ──────────────────────────────────────────────────
step "namespace ${NAMESPACE}"
remote "sudo -n kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | sudo -n kubectl apply -f -"

step "secret ${SECRET} from k8s/.env.staging (via ssh stdin)"
remote "sudo -n kubectl -n ${NAMESPACE} create secret generic ${SECRET} --from-env-file=/dev/stdin \
  --dry-run=client -o yaml | sudo -n kubectl apply -f -" < "$ENV_FILE"

# ─── 6-9. Manifest, postgres, image, rollout ──────────────────────────────────
step "apply k8s/staging.yaml (image tag ${TAG})"
sed "s/__IMAGE_TAG__/${TAG}/" "$MANIFEST" | remote "sudo -n kubectl apply -f -"

step "wait for postgres"
remote "sudo -n kubectl -n ${NAMESPACE} rollout status statefulset/postgres --timeout=180s"

step "set image ${REMOTE_IMAGE}"
remote "sudo -n kubectl -n ${NAMESPACE} set image deployment/app app=${REMOTE_IMAGE}"

step "wait for the app rollout (entrypoint runs prisma migrate deploy first)"
if ! remote "sudo -n kubectl -n ${NAMESPACE} rollout status deployment/app --timeout=300s"; then
  echo "rollout did not finish; last app logs:" >&2
  remote "sudo -n kubectl -n ${NAMESPACE} logs deployment/app --tail=80" >&2 || true
  exit 1
fi

step "status"
remote "sudo -n kubectl -n ${NAMESPACE} get pods,ingress,certificate -o wide"
echo
echo "Deployed ${REMOTE_IMAGE} -> ${PUBLIC_URL}"
