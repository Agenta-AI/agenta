# Migrate Evaluator Playground to New Evaluator Endpoints

## Overview

This planning workspace documents the migration of the Evaluator Playground frontend to use the new workflow-based evaluator endpoints. The backend team has migrated evaluators from the old `EvaluatorConfig` model to the new `SimpleEvaluator` (workflow-based) model.

## Migration Strategy

**Direct migration (no adapters)** split into two PRs:

| PR | Scope | Description |
|----|-------|-------------|
| **PR 1** | CRUD | Migrate to `/preview/simple/evaluators/*`, change internal types to `SimpleEvaluator` |
| **PR 2** | Run | Migrate to `/preview/workflows/invoke`, add workflow service types |

See [plan.md](./plan.md) for detailed implementation steps.

## Context

- **PR #3527**: Backend migration that introduces new evaluator endpoints
- **Goal**: Full migration to new endpoints, no legacy code remaining

## Documents

| File | Description |
|------|-------------|
| [context.md](./context.md) | Background, motivation, problem statement, goals, and non-goals |
| [current-system.md](./current-system.md) | Detailed map of current Evaluator Playground implementation |
| [new-endpoints.md](./new-endpoints.md) | New evaluator endpoint shapes and differences from legacy |
| [research.md](./research.md) | Deep dive into evaluator execution architecture and URI-based handlers |
| [migration-options.md](./migration-options.md) | Why we chose direct migration over adapters |
| [risk-analysis.md](./risk-analysis.md) | Coupling points and risk areas for the migration |
| [plan.md](./plan.md) | **Main plan** - PR 1 (CRUD) and PR 2 (Run) implementation details |
| [status.md](./status.md) | Living document for progress updates and decisions |

## Key Mapping Changes

| Legacy | New |
|--------|-----|
| `EvaluatorConfig` | `SimpleEvaluator` |
| `evaluator_key` | derived from `data.uri` |
| `settings_values` | `data.parameters` |
| `GET /evaluators/configs/` | `POST /preview/simple/evaluators/query` |
| `POST /evaluators/configs/` | `POST /preview/simple/evaluators/` |
| `PUT /evaluators/configs/{id}/` | `PUT /preview/simple/evaluators/{id}` |
| `DELETE /evaluators/configs/{id}/` | `POST /preview/simple/evaluators/{id}/archive` |
| `POST /evaluators/{key}/run/` | `POST /preview/workflows/invoke` |

## Files Affected

### PR 1: CRUD Migration

| Area | Files |
|------|-------|
| Types | `web/oss/src/lib/Types.ts` |
| Services | `web/oss/src/services/evaluators/index.ts` |
| State | `web/oss/src/state/evaluators/atoms.ts` |
| Playground State | `web/oss/src/components/.../ConfigureEvaluator/state/atoms.ts` |
| Playground UI | `web/oss/src/components/.../ConfigureEvaluator/index.tsx` |
| Registry | `web/oss/src/components/Evaluators/index.tsx` |
| Registry Hook | `web/oss/src/components/Evaluators/hooks/useEvaluatorsRegistryData.ts` |
| Columns | `web/oss/src/components/Evaluators/assets/getColumns.tsx` |

### PR 2: Run Migration

| Area | Files |
|------|-------|
| Types | `web/oss/src/lib/Types.ts` (add workflow types) |
| Invoke Service | `web/oss/src/services/workflows/invoke.ts` (new) |
| Debug Section | `web/oss/src/components/.../ConfigureEvaluator/DebugSection.tsx` |

### Backend Reference (PR #3527)
- `api/oss/src/routers/evaluators_router.py` - Legacy endpoints (kept temporarily)
- `api/oss/src/apis/fastapi/evaluators/router.py` - New `SimpleEvaluators` router
- `api/oss/src/apis/fastapi/workflows/router.py` - Workflow invoke endpoint
- `api/oss/src/core/evaluators/dtos.py` - New data transfer objects

## Effort Estimate

| PR | Effort |
|----|--------|
| PR 1: CRUD | 4-5 days |
| PR 2: Run | 3-4 days |
| **Total** | **7-9 days** |
