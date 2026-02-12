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
| api | EE | 797MB | 423MB | -374MB | -46.9% :white_check_mark: |
| api | OSS | 779MB | 422MB | -357MB | -45.8% :white_check_mark: |
| services | EE | 546MB | 435MB | -111MB | -20.3% :white_check_mark: |
| services | OSS | 546MB | 435MB | -111MB | -20.3% :white_check_mark: |
| web | EE | 667MB | 605MB | -62MB | -9.3% :white_check_mark: |
| web | OSS | 659MB | 589MB | -70MB | -10.6% :white_check_mark: |

**Summary**: All images smaller. API images cut nearly in half via venv isolation, `__pycache__` cleanup, `--only main`, and stripping polars/obstore + phonenumbers/twilio stubs.

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
| costs module (models.dev) | PASS | `_build_pricing` + `cost_per_token` work |
| csv stdlib | PASS | DictWriter/DictReader replace polars |

### EE / API — Functional Delta
- **Improvements**: Dev deps removed, SDK path preserved, polars/obstore stripped (-175MB), phonenumbers/twilio stubbed (-45MB), `__pycache__` cleaned (-150MB)
- **Regressions**: None

### EE / API — Size Analysis
- Before: 797MB
- After: 423MB (-374MB, -46.9%)

---

## EE / Services — Functional Checks

### After (branch)
| Check | Status | Notes |
|-------|--------|-------|
| fastapi | PASS | importable |
| httpx | PASS | importable |
| pydantic | PASS | importable |
| uvicorn | PASS | importable |
| No dev deps in runtime | PASS | `pytest` NOT importable |
| SDK dir present | PASS | `/app/sdk/` exists |
| entrypoints dir | PASS | `/app/entrypoints/` exists |
| oss dir | PASS | `/app/oss/` exists |

### EE / Services — Size Analysis
- Before: 546MB
- After: 435MB (-111MB, -20.3%)

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
| gunicorn | PASS | importable |
| No dev deps | PASS | pytest NOT importable |

### OSS / API — Size Analysis
- Before: 779MB
- After: 422MB (-357MB, -45.8%)

---

## OSS / Services — Functional Checks

### Before (main)
| Check | Status | Notes |
|-------|--------|-------|
| gunicorn starts | — | |
| SDK override present | — | |
| No dev deps in runtime | — | |

### After (branch)
| Check | Status | Notes |
|-------|--------|-------|
| gunicorn starts | — | |
| SDK override present | — | |
| No dev deps in runtime | — | |

### OSS / Services — Size Analysis
- Before: 546MB
- After: 435MB (-111MB, -20.3%)

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
6. **Single-layer merge**: Strip + install in one `RUN` so Docker layers don't retain deleted files

### Python Services Images (EE + OSS)
1. **venv isolation**: Same as API
2. **`--only main`**: Same as API
3. **`__pycache__` cleanup**: Same as API
4. No strip needed — services don't depend on polars/phonenumbers/twilio

### Decisions
- **litellm kept**: agenta SDK imports litellm at module level (`agenta.sdk.assets`); stripping would break SDK
- **costs.py added**: API-server tracing uses `models.dev` for cost lookup instead of litellm's `cost_calculator`, with existing Redis+in-memory caching
- **polars replaced with stdlib csv**: Only 4 call sites, all trivial CSV read/write
