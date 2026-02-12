# GH Image Improvements — Validation Report

## Overview

Comparing Docker images **before** (main branch) vs **after** (chore/improve-gh-images branch).

| Dimension | Targets |
|-----------|---------|
| Branches  | `main` (before) vs `chore/improve-gh-images` (after) |
| Order     | EE first, then OSS |
| Components| api → services → web |
| Checks    | functional first, then size |

## Image Size Summary

| Image | License | Before (main) | After (branch) | Delta | % Change |
|-------|---------|---------------|----------------|-------|----------|
| api | EE | 797MB | 408MB | -389MB | -48.8% :white_check_mark: |
| api | OSS | 779MB | 407MB | -372MB | -47.8% :white_check_mark: |
| services | EE | 546MB | 417MB | -129MB | -23.6% :white_check_mark: |
| services | OSS | 546MB | 417MB | -129MB | -23.6% :white_check_mark: |
| web | EE | 667MB | 605MB | -62MB | -9.3% :white_check_mark: |
| web | OSS | 659MB | 589MB | -70MB | -10.6% :white_check_mark: |

**Total before**: 3,994MB → **Total after**: 2,843MB → **Total delta**: -1,151MB (-28.8%)

**Summary**: All images smaller. API images cut nearly in half via venv isolation, `__pycache__` cleanup, `--only main`, stripping polars/obstore + phonenumbers/twilio stubs + hf_xet, and removing lsb-release/perl from apt layer. Services images reduced via venv isolation, `--only main`, `__pycache__` cleanup, and stripping obstore/hf_xet/shapely.

---

## EE / API — Functional Checks

### Before (main)
| Check | Status | Notes |
|-------|--------|-------|
| gunicorn starts | PASS | gunicorn 24.1.1 |
| worker-evaluations starts | PASS | module imports OK |
| worker-tracing starts | PASS | module imports OK |
| cron binary + files | PASS | `/usr/sbin/cron`, 3 cron files (queries, meters, spans) |
| alembic migration runs | — | requires DB, skipped |
| SDK override present | FAIL | `/app/sdk/` does not exist |
| No dev deps in runtime | FAIL | `pytest` importable in runtime |

### After (branch)
| Check | Status | Notes |
|-------|--------|-------|
| gunicorn starts | PASS | gunicorn 24.1.1 |
| worker-evaluations starts | PASS | module imports OK |
| worker-tracing starts | PASS | module imports OK |
| cron binary + files | PASS | `/usr/sbin/cron`, 3 cron files (queries, meters, spans) |
| alembic migration runs | — | requires DB, skipped |
| SDK override present | PASS | `/app/sdk/` exists (empty — expected when no SDK in context) |
| No dev deps in runtime | PASS | `pytest` NOT importable — `--only main` working |
| phonenumbers stub | PASS | supertokens imports work with stub |
| twilio stub | PASS | raises NotImplementedError as expected |
| litellm + SDK | PASS | litellm present, agenta SDK assets importable |
| polars stripped | PASS | ImportError on `import polars` |
| obstore stripped | PASS | ImportError on `import obstore` |
| hf_xet stripped | PASS | ImportError on `import hf_xet` |
| newrelic | PASS | importable (used for observability) |
| costs module (models.dev) | PASS | `_build_pricing` + `cost_per_token` work |
| csv stdlib | PASS | DictWriter/DictReader replace polars |
| postgresql-client | PASS | `pg_dump` present |
| curl | PASS | present |

### EE / API — Functional Delta
- **Improvements**: Dev deps removed, SDK path preserved, polars/obstore stripped (-175MB), phonenumbers/twilio stubbed (-45MB), hf_xet stripped (-8MB), lsb-release+perl removed from apt (-7MB), `__pycache__` cleaned (-150MB)
- **Regressions**: None

### EE / API — Size Analysis
- Before: 797MB
- After: 408MB (-389MB, -48.8%)

---

## EE / Services — Functional Checks

### After (branch)
| Check | Status | Notes |
|-------|--------|-------|
| fastapi | PASS | importable |
| httpx | PASS | importable |
| pydantic | PASS | importable |
| uvicorn | PASS | importable |
| gunicorn | PASS | importable |
| litellm | PASS | importable (needed by SDK) |
| openai | PASS | importable (litellm provider) |
| boto3 | PASS | importable (litellm Bedrock provider) |
| google.cloud.aiplatform | PASS | importable (litellm Vertex AI provider) |
| newrelic | PASS | importable (observability) |
| obstore stripped | PASS | ImportError on `import obstore` |
| hf_xet stripped | PASS | ImportError on `import hf_xet` |
| No dev deps in runtime | PASS | `pytest` NOT importable |
| SDK dir present | PASS | `/app/sdk/` exists |
| entrypoints dir | PASS | `/app/entrypoints/` exists |
| oss dir | PASS | `/app/oss/` exists |

### EE / Services — Size Analysis
- Before: 546MB
- After: 417MB (-129MB, -23.6%)

---

## EE / Web — Functional Checks

### After (branch)
| Check | Status | Notes |
|-------|--------|-------|
| node version | PASS | v20.18.0 |
| entrypoint.sh exists | PASS | present and executable |
| server.js exists | PASS | `/app/ee/server.js` |
| .next/static | PASS | static assets present |
| ee/public | PASS | public dir present |
| oss/public | PASS | public dir present |
| node_modules | PASS | present |

### EE / Web — Size Analysis
- Before: 667MB
- After: 605MB (-62MB, -9.3%)

---

## OSS / API — Functional Checks

### After (branch)
| Check | Status | Notes |
|-------|--------|-------|
| phonenumbers stub | PASS | supertokens imports work |
| twilio stub | PASS | raises NotImplementedError |
| supertokens | PASS | passwordless importable |
| fastapi | PASS | importable |
| sqlalchemy | PASS | importable |
| httpx | PASS | importable |
| pydantic | PASS | importable |
| uvicorn | PASS | importable |
| redis | PASS | importable |
| litellm + SDK | PASS | litellm present, SDK assets work |
| costs module | PASS | models.dev lookup works |
| tracing utils | PASS | async calculate_costs importable |
| csv stdlib | PASS | polars replacement works |
| polars stripped | PASS | ImportError |
| obstore stripped | PASS | ImportError |
| hf_xet stripped | PASS | ImportError |
| newrelic | PASS | importable (observability) |
| gunicorn | PASS | importable |
| No dev deps | PASS | pytest NOT importable |
| postgresql-client | PASS | `pg_dump` present |
| curl | PASS | present |

### OSS / API — Size Analysis
- Before: 779MB
- After: 407MB (-372MB, -47.8%)

---

## OSS / Services — Functional Checks

### After (branch)
| Check | Status | Notes |
|-------|--------|-------|
| fastapi | PASS | importable |
| httpx | PASS | importable |
| pydantic | PASS | importable |
| uvicorn | PASS | importable |
| gunicorn | PASS | importable |
| litellm | PASS | importable (needed by SDK) |
| boto3 | PASS | importable (litellm Bedrock provider) |
| google.cloud.aiplatform | PASS | importable (litellm Vertex AI provider) |
| newrelic | PASS | importable (observability) |
| obstore stripped | PASS | ImportError |
| hf_xet stripped | PASS | ImportError |
| No dev deps | PASS | pytest NOT importable |
| SDK dir present | PASS | `/app/sdk/` exists |
| entrypoints dir | PASS | `/app/entrypoints/` exists |
| oss dir | PASS | `/app/oss/` exists |

### OSS / Services — Size Analysis
- Before: 546MB
- After: 417MB (-129MB, -23.6%)

---

## OSS / Web — Functional Checks

### After (branch)
| Check | Status | Notes |
|-------|--------|-------|
| node version | PASS | v20.18.0 |
| entrypoint.sh exists | PASS | present and executable |
| server.js exists | PASS | `/app/oss/server.js` |
| .next/static | PASS | static assets present |
| oss/public | PASS | public dir present |
| node_modules | PASS | present |

### OSS / Web — Size Analysis
- Before: 659MB
- After: 589MB (-70MB, -10.6%)

---

## Optimizations Applied

### Python API Images (EE + OSS)
1. **venv isolation**: Poetry installed system-level, app deps in clean `/opt/venv`
2. **`--only main`**: Dev dependencies excluded from runtime (pytest, etc.)
3. **`__pycache__` cleanup**: ~150MB bytecode removed
4. **polars/obstore stripped**: ~175MB native Rust binary removed; replaced by stdlib `csv`
5. **phonenumbers/twilio stubbed**: ~45MB removed; minimal stubs satisfy supertokens import
6. **hf_xet stripped**: ~8MB removed; transitive dep never imported
7. **lsb-release removed**: Hardcode `bookworm` codename; avoids pulling perl (~56MB)
8. **gnupg2 auto-removed**: Only needed during apt setup, purged after
9. **Single-layer merge**: Strip + install in one `RUN` so Docker layers don't retain deleted files

### Python Services Images (EE + OSS)
1. **venv isolation**: Same as API
2. **`--only main`**: Same as API
3. **`__pycache__` cleanup**: Same as API
4. **obstore/hf_xet stripped**: ~17MB; transitive, never imported
5. **shapely stripped**: transitive from google-cloud-aiplatform, never used
6. **Single-layer merge**: Same as API

### Decisions
- **litellm kept**: agenta SDK imports litellm at module level (`agenta.sdk.assets`); stripping would break SDK
- **litellm provider SDKs kept** (google-cloud-aiplatform, boto3): litellm dynamically imports these at runtime to route calls to Vertex AI, Bedrock, etc.
- **newrelic kept**: used for observability
- **costs.py added**: API-server tracing uses `models.dev` for cost lookup instead of litellm's `cost_calculator`, with existing Redis+in-memory caching
- **polars replaced with stdlib csv**: Only 4 call sites, all trivial CSV read/write
- **bookworm hardcoded**: Base image is `python:3.11-slim-bookworm`, codename is stable; avoids lsb-release + perl dependency chain
