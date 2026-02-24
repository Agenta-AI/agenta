# Evaluators Endpoints Cleanup Research

## Summary

This document provides comprehensive research on the legacy evaluators endpoints to determine which can be safely removed or deprecated.

**Key Findings:**
1. `GET /evaluators` - **Still actively used** for fetching evaluator templates, needs migration
2. `POST /evaluators/{key}/run` - **Dead code**, can be removed immediately
3. `POST /evaluators/map` - **Dead code**, can be removed immediately
4. `GET/POST/PUT/DELETE /evaluators/configs/*` - **Dead code**, can be removed immediately

## File Index

| File | Description |
|------|-------------|
| [endpoint-analysis.md](./endpoint-analysis.md) | Detailed endpoint-by-endpoint analysis |
| [migration-plan.md](./migration-plan.md) | Proposed migration strategy |
| [frontend-usage.md](./frontend-usage.md) | Frontend code that calls these endpoints |

## Quick Decision Matrix

| Endpoint | Status | Action | Risk |
|----------|--------|--------|------|
| `GET /evaluators` | Active | Migrate to new endpoint | Low |
| `POST /evaluators/{key}/run` | **Dead code** | Remove | None |
| `POST /evaluators/map` | **Dead code** | Remove | None |
| `GET /evaluators/configs/` | **Dead code** | Remove | None |
| `POST /evaluators/configs/` | **Dead code** | Remove | None |
| `PUT /evaluators/configs/{id}/` | **Dead code** | Remove | None |
| `DELETE /evaluators/configs/{id}/` | **Dead code** | Remove | None |

### Summary

The **entire legacy `/evaluators/*` router can be removed** except for `GET /evaluators/` which needs migration first.

Frontend only uses:
- `GET /evaluators` → Evaluator templates (needs migration)
- `POST /preview/simple/evaluators/*` → All config CRUD operations
- `POST /preview/workflows/invoke` → Evaluator execution

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LEGACY ENDPOINTS                                     │
│                     (api/oss/src/routers/evaluators_router.py)              │
│                                                                              │
│  GET  /evaluators/                    → [ACTIVE] Evaluator templates        │
│  POST /evaluators/{key}/run           → [DEAD CODE] Remove                  │
│  POST /evaluators/map                 → [DEAD CODE] Remove                  │
│  GET  /evaluators/configs/            → [DEAD CODE] Remove                  │
│  POST /evaluators/configs/            → [DEAD CODE] Remove                  │
│  PUT  /evaluators/configs/{id}/       → [DEAD CODE] Remove                  │
│  DELETE /evaluators/configs/{id}/     → [DEAD CODE] Remove                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          NEW ENDPOINTS (In Use)                              │
│                  (api/oss/src/apis/fastapi/evaluators/router.py)            │
│                                                                              │
│  POST /preview/simple/evaluators/query    → List evaluator configs          │
│  POST /preview/simple/evaluators/         → Create evaluator config         │
│  PUT  /preview/simple/evaluators/{id}     → Update evaluator config         │
│  POST /preview/simple/evaluators/{id}/archive → Archive evaluator config    │
│  GET  /preview/simple/evaluators/{id}     → Get evaluator config by ID      │
│                                                                              │
│  POST /preview/workflows/invoke           → Execute evaluators (via URI)    │
└─────────────────────────────────────────────────────────────────────────────┘
```
