#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENTS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${CLIENTS_ROOT}/.." && pwd)"
LANGUAGE="all"
OPENAPI_URL="http://localhost/api/openapi.json"
OPENAPI_FILE=""
LIVE_URL="https://eu.cloud.agenta.ai/api/openapi.json"

log() {
  echo "[fern-clients] $*"
}

usage() {
  cat <<'EOF'
Usage:
  generate.sh [--language python|typescript|all] [--live] [--local] [--file FILE]

Modes (pick one):
  (default)  Fetch from http://localhost/api/openapi.json
  --live     Fetch from https://eu.cloud.agenta.ai/api/openapi.json
  --local    Fetch from http://localhost/api/openapi.json
  --file     Use an explicit local file path

Examples:
  ./clients/scripts/generate.sh
  ./clients/scripts/generate.sh --language python
  ./clients/scripts/generate.sh --live
  ./clients/scripts/generate.sh --local
  ./clients/scripts/generate.sh --file /path/to/openapi.json
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --language)
      LANGUAGE="${2:-}"
      shift 2
      ;;
    --live)
      OPENAPI_URL="${LIVE_URL}"
      OPENAPI_FILE=""
      shift
      ;;
    --local)
      OPENAPI_URL="http://localhost/api/openapi.json"
      OPENAPI_FILE=""
      shift
      ;;
    --file)
      OPENAPI_FILE="${2:-}"
      OPENAPI_URL=""
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${OPENAPI_FILE}" && -z "${OPENAPI_URL}" ]]; then
  echo "Provide --live, --local, or --file." >&2
  exit 1
fi

if [[ -n "${OPENAPI_FILE}" && ! -f "${OPENAPI_FILE}" ]]; then
  echo "OpenAPI file not found: ${OPENAPI_FILE}" >&2
  exit 1
fi

if ! command -v fern >/dev/null 2>&1; then
  echo "Fern is not installed. Install it with: npm install -g fern-api" >&2
  exit 1
fi

log "language=${LANGUAGE}"
if [[ -n "${OPENAPI_FILE}" ]]; then
  log "openapi_file=${OPENAPI_FILE}"
else
  log "openapi_url=${OPENAPI_URL}"
fi

load_openapi() {
  local fern_dir="$1"
  log "preparing OpenAPI input in ${fern_dir}/openapi"
  mkdir -p "${fern_dir}/openapi"

  if [[ -n "${OPENAPI_FILE}" ]]; then
    log "copying OpenAPI spec from ${OPENAPI_FILE}"
    cp "${OPENAPI_FILE}" "${fern_dir}/openapi/openapi.json"
  else
    log "downloading OpenAPI spec from ${OPENAPI_URL}"
    if ! curl \
      --fail \
      --show-error \
      --silent \
      --location \
      --connect-timeout 5 \
      --max-time 30 \
      "${OPENAPI_URL}" \
      -o "${fern_dir}/openapi/openapi.json"; then
      echo "Failed to download OpenAPI spec from ${OPENAPI_URL}. Check that the local API is running and reachable." >&2
      exit 1
    fi
  fi

  if [[ ! -s "${fern_dir}/openapi/openapi.json" ]]; then
    echo "Failed to load OpenAPI spec." >&2
    exit 1
  fi

  log "OpenAPI spec ready"

}

write_fern_config() {
  local fern_dir="$1"

  log "writing Fern config to ${fern_dir}"
  mkdir -p "${fern_dir}"
  cat > "${fern_dir}/fern.config.json" <<'EOF'
{
  "organization": "agenta",
  "version": "4.107.0"
}
EOF
}

write_python_generators() {
  local fern_dir="$1"
  local latest_version="${2:-4.48.0}"

  log "writing Python generator config version=${latest_version}"
  cat > "${fern_dir}/generators.yml" <<EOF
# yaml-language-server: \$schema=https://schema.buildwithfern.dev/generators-yml.json
api:
  specs:
    - openapi: openapi/openapi.json

default-group: local
groups:
  local:
    generators:
      - name: fernapi/fern-python-sdk
        version: ${latest_version}
        config:
          skip_formatting: true
        output:
          location: local-file-system
          path: agenta_client
EOF
}

write_typescript_generators() {
  local fern_dir="$1"
  local latest_version="${2:-3.63.7}"

  log "writing TypeScript generator config version=${latest_version}"
  cat > "${fern_dir}/generators.yml" <<EOF
# yaml-language-server: \$schema=https://schema.buildwithfern.dev/generators-yml.json
api:
  specs:
    - openapi: openapi/openapi.json

default-group: local
groups:
  local:
    generators:
      - name: fernapi/fern-typescript-sdk
        version: ${latest_version}
        output:
          location: local-file-system
          path: src/generated
EOF
}

bootstrap_python_layout() {
  local client_root="$1"

  log "bootstrapping Python client layout in ${client_root}"
  mkdir -p "${client_root}/agenta_client"

  if [[ ! -f "${client_root}/pyproject.toml" ]]; then
    log "writing pyproject.toml in ${client_root}"
    cat > "${client_root}/pyproject.toml" <<'EOF'
[tool.poetry]
name = "agenta-client"
# Pre-release version — will become a proper PyPI release once the client stabilises.
# When published, replace the path dependency in sdk/pyproject.toml with:
#   agenta-client = "^<version>"
version = "0.0.0.dev0"
description = "Fern-generated Python client for the Agenta API."
authors = [
    "Juan Vega <jp@agenta.ai>"
]
packages = [{ include = "agenta_client" }]

[tool.poetry.dependencies]
python = "^3.11"
httpx = "^0.28"
pydantic = "^2"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
EOF
  fi

  cat > "${client_root}/README.md" <<'EOF'
# Python Client

Generate the Python Fern client from a locally running API:

```bash
bash ./clients/scripts/generate.sh --language python
```

Generate the Python Fern client from the live cloud API:

```bash
bash ./clients/scripts/generate.sh --language python --live
```
EOF
}

bootstrap_typescript_layout() {
  local client_root="$1"

  log "bootstrapping TypeScript client layout in ${client_root}"
  mkdir -p "${client_root}/src/generated"

  cat > "${client_root}/README.md" <<'EOF'
# TypeScript Client

Generate the TypeScript Fern client from a locally running API:

```bash
bash ./clients/scripts/generate.sh --language typescript
```

Generate the TypeScript Fern client from the live cloud API:

```bash
bash ./clients/scripts/generate.sh --language typescript --live
```
EOF

  cat > "${client_root}/package.json" <<'EOF'
{
  "name": "@agenta/client",
  "version": "0.0.0-dev",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "src"
  ],
  "scripts": {
    "generate": "bash ../scripts/generate.sh --language typescript",
    "build": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.9.3"
  }
}
EOF

  cat > "${client_root}/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true
  },
  "include": [
    "src/**/*.ts"
  ]
}
EOF

  cat > "${client_root}/src/index.ts" <<'EOF'
export * from "./generated";
EOF

  cat > "${client_root}/src/generated/index.ts" <<'EOF'
// Placeholder until the first Fern generation runs.
export {};
EOF
}

generate_python() {
  local client_root="${CLIENTS_ROOT}/python"
  local target_dir="${client_root}/agenta_client"
  local sdk_mirror_dir="${CLIENTS_ROOT}/../sdks/python/agenta_client"
  local fern_dir="${client_root}/fern"
  local fern_output_dir="${fern_dir}/src/agenta_client"
  local latest_version

  log "starting Python client generation"

  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is not installed. Install it with: brew install jq or apt install jq" >&2
    exit 1
  fi

  bootstrap_python_layout "${client_root}"
  log "clearing Fern workspace ${fern_dir}"
  rm -rf "${fern_dir}"

  log "switching to ${client_root}"
  cd "${client_root}"
  write_fern_config "${fern_dir}"
  load_openapi "${fern_dir}"
  latest_version="4.48.0"
  write_python_generators "${fern_dir}" "${latest_version}"

  log "running Fern generate for Python with CI=1 --local --force --no-prompt"
  CI=1 fern generate --local --force --no-prompt

  log "syncing generated Python client from ${fern_output_dir} to ${target_dir}"
  rm -rf "${target_dir}"
  mkdir -p "$(dirname "${target_dir}")"
  cp -R "${fern_output_dir}" "${target_dir}"

  log "mirroring generated Python client into SDK package at ${sdk_mirror_dir}"
  rm -rf "${sdk_mirror_dir}"
  mkdir -p "$(dirname "${sdk_mirror_dir}")"
  cp -R "${fern_output_dir}" "${sdk_mirror_dir}"

  fix_recursive_types_in_dir() {
    local types_dir="$1"
    if [[ ! -d "${types_dir}" ]]; then return; fi

    log "patching recursive JSON types in ${types_dir}"

    # Step 1: Replace the recursive type alias definitions with Any.
    # Fern generates e.g.: FullJsonInput = typing.Union[str, ..., "FullJsonInput", ...]
    # Pydantic v2 cannot resolve self-referential type aliases via update_forward_refs.
    for def_file in \
        "${types_dir}/full_json_input.py" \
        "${types_dir}/full_json_output.py" \
        "${types_dir}/label_json_input.py" \
        "${types_dir}/label_json_output.py"; do
      if [[ -f "${def_file}" ]]; then
        sed -i.bak \
          -e 's/^FullJsonInput = typing\.Union\[.*$/FullJsonInput = typing.Any/' \
          -e 's/^FullJsonOutput = typing\.Union\[.*$/FullJsonOutput = typing.Any/' \
          -e 's/^LabelJsonInput = typing\.Union\[.*$/LabelJsonInput = typing.Any/' \
          -e 's/^LabelJsonOutput = typing\.Union\[.*$/LabelJsonOutput = typing.Any/' \
          "${def_file}"
      fi
    done

    # Step 2: Replace every forward-reference string and Optional wrapper for these
    # types across ALL files in the directory.  Pydantic v2 resolves string annotations
    # at model_rebuild time; leaving them as strings causes infinite recursion even when
    # the alias definition has been replaced with Any above.
    find "${types_dir}" -name "*.py" -print0 | xargs -0 sed -i.bak \
      -e 's/typing\.Optional\["FullJsonInput"\]/typing.Any/g' \
      -e 's/typing\.Optional\["FullJsonOutput"\]/typing.Any/g' \
      -e 's/typing\.Optional\["LabelJsonInput"\]/typing.Any/g' \
      -e 's/typing\.Optional\["LabelJsonOutput"\]/typing.Any/g' \
      -e 's/"FullJsonInput"/typing.Any/g' \
      -e 's/"FullJsonOutput"/typing.Any/g' \
      -e 's/"LabelJsonInput"/typing.Any/g' \
      -e 's/"LabelJsonOutput"/typing.Any/g'

    find "${types_dir}" -name "*.py.bak" -delete
  }

  fix_recursive_types_in_dir "${target_dir}"
  fix_recursive_types_in_dir "${sdk_mirror_dir}"

  log "cleaning Fern workspace ${fern_dir}"
  rm -rf "${fern_dir}"
  log "generated Python client in ${client_root}/src/agenta_client"
}

generate_typescript() {
  local client_root="${CLIENTS_ROOT}/typescript"
  local target_dir="${client_root}/src/generated"
  local fern_dir="${client_root}/fern"
  local fern_output_dir="${fern_dir}/src/generated"
  local latest_version

  log "starting TypeScript client generation"
  bootstrap_typescript_layout "${client_root}"
  log "clearing Fern workspace ${fern_dir}"
  rm -rf "${fern_dir}"

  log "switching to ${client_root}"
  cd "${client_root}"
  write_fern_config "${fern_dir}"
  load_openapi "${fern_dir}"
  latest_version="3.63.7"
  write_typescript_generators "${fern_dir}" "${latest_version}"

  log "clearing generated TypeScript output ${target_dir}"
  rm -rf "${target_dir}"
  log "running Fern generate for TypeScript with CI=1 --local --force --no-prompt"
  CI=1 fern generate --local --force --no-prompt
  log "syncing generated TypeScript client from ${fern_output_dir} to ${target_dir}"
  mkdir -p "$(dirname "${target_dir}")"
  cp -R "${fern_output_dir}" "${target_dir}"
  log "cleaning Fern workspace ${fern_dir}"
  rm -rf "${fern_dir}"
  log "generated TypeScript client in ${target_dir}"
}

case "${LANGUAGE}" in
python)
  generate_python
  ;;
typescript)
  generate_typescript
  ;;
all)
  generate_python
  generate_typescript
  ;;
*)
  echo "Unsupported language: ${LANGUAGE}" >&2
  usage >&2
  exit 1
  ;;
esac
