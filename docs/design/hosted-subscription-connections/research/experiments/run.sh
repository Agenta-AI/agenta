#!/usr/bin/env bash
#
# Host-side orchestrator for the shared-auth-home storage experiment.
#
# Runs mount-semantics.mjs inside the runner container of a compose stack, on the real geesefs
# mount path with the real production flags. It reads the store master keys from the stack's env
# file and passes them to the container through env, so no key value is printed or written to a
# file.
#
# Usage:
#   bash run.sh [--container <name>] [--env-file <path>] [--out <dir>]
#
# Defaults target the `agenta-ee-dev-hostedsub` stack.
#
set -euo pipefail

CONTAINER="agenta-ee-dev-hostedsub-runner-1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
ENV_FILE="${REPO_ROOT}/hosting/docker-compose/ee/.env.ee.dev.hostedsub"
OUT_DIR="${HOME}/agenta-qa-evidence/$(date +%Y-%m-%d)-storage-mounts"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --container) CONTAINER="$2"; shift 2;;
    --env-file)  ENV_FILE="$2";  shift 2;;
    --out)       OUT_DIR="$2";   shift 2;;
    *) echo "unknown flag: $1" >&2; exit 2;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
EXP_PREFIX="research/storage-mounts/${RUN_ID}"
EXP_ROOT="/tmp/mount-exp-${RUN_ID}"

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
  echo "container ${CONTAINER} is not running" >&2
  exit 1
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "env file not found: ${ENV_FILE}" >&2
  exit 1
fi

# Read the master keys without printing them. They stay in shell variables and go to the
# container through `docker exec -e`, never through argv or a file.
AK="$(grep -m1 '^AGENTA_STORE_ACCESS_KEY=' "${ENV_FILE}" | cut -d= -f2-)"
SK="$(grep -m1 '^AGENTA_STORE_SECRET_KEY=' "${ENV_FILE}" | cut -d= -f2-)"
if [[ -z "${AK}" || -z "${SK}" ]]; then
  echo "AGENTA_STORE_ACCESS_KEY / AGENTA_STORE_SECRET_KEY not set in ${ENV_FILE}" >&2
  exit 1
fi
ENDPOINT="$(grep -m1 '^AGENTA_STORE_ENDPOINT_URL=' "${ENV_FILE}" | cut -d= -f2- || true)"
ENDPOINT="${ENDPOINT:-http://seaweedfs:8333}"
BUCKET="$(grep -m1 '^AGENTA_STORE_BUCKET=' "${ENV_FILE}" | cut -d= -f2- || true)"
BUCKET="${BUCKET:-agenta-store}"
REGION="$(grep -m1 '^AGENTA_STORE_REGION=' "${ENV_FILE}" | cut -d= -f2- || true)"
REGION="${REGION:-us-east-1}"

mkdir -p "${OUT_DIR}"
echo "container : ${CONTAINER}"
echo "endpoint  : ${ENDPOINT}"
echo "bucket    : ${BUCKET}"
echo "prefix    : ${EXP_PREFIX}"
echo "out dir   : ${OUT_DIR}"

docker exec "${CONTAINER}" mkdir -p "${EXP_ROOT}"
docker cp "${SCRIPT_DIR}/mount-semantics.mjs" "${CONTAINER}:${EXP_ROOT}/mount-semantics.mjs"

set +e
docker exec \
  -e "AWS_ACCESS_KEY_ID=${AK}" \
  -e "AWS_SECRET_ACCESS_KEY=${SK}" \
  -e "S3_ENDPOINT=${ENDPOINT}" \
  -e "S3_BUCKET=${BUCKET}" \
  -e "S3_REGION=${REGION}" \
  -e "EXP_PREFIX=${EXP_PREFIX}" \
  -e "EXP_ROOT=${EXP_ROOT}" \
  -e "OUT_JSON=${EXP_ROOT}/results.json" \
  -e "EXP_CELLS=${EXP_CELLS:-}" \
  -e "EXP_EXTRA_GEESEFS_ARGS=${EXP_EXTRA_GEESEFS_ARGS:-}" \
  "${CONTAINER}" node "${EXP_ROOT}/mount-semantics.mjs" 2>&1 | tee "${OUT_DIR}/driver-${RUN_ID}.log"
STATUS=${PIPESTATUS[0]}
set -e

docker cp "${CONTAINER}:${EXP_ROOT}/results.json" "${OUT_DIR}/results-${RUN_ID}.json" || true
for f in geesefs-a.log geesefs-b.log geesefs-c.log geesefs-cold.log; do
  docker cp "${CONTAINER}:${EXP_ROOT}/${f}" "${OUT_DIR}/${f%.log}-${RUN_ID}.log" 2>/dev/null || true
done

# Leave no mounts and no scratch behind in the shared runner container.
docker exec "${CONTAINER}" sh -c "
  for m in ${EXP_ROOT}/a ${EXP_ROOT}/b ${EXP_ROOT}/c; do fusermount -uz \"\$m\" 2>/dev/null || true; done
  rm -rf ${EXP_ROOT}
" || true

echo "driver exit=${STATUS}"
echo "results: ${OUT_DIR}/results-${RUN_ID}.json"
echo "NOTE: the experiment objects stay under ${BUCKET}/${EXP_PREFIX}; delete them when done."
exit "${STATUS}"
