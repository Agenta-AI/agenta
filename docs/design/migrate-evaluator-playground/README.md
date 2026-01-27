# Migrate Evaluator Playground to New Evaluator Endpoints

## Overview

This planning workspace documents the migration of the Evaluator Playground frontend to use the new workflow-based evaluator endpoints. The backend team has migrated evaluators from the old `EvaluatorConfig` model to the new `SimpleEvaluator` (workflow-based) model, and has created backward-compatible legacy endpoints. This migration will update the frontend to use the new endpoints directly.

## Context

- **PR #3527**: Backend migration that introduces new evaluator endpoints while keeping legacy endpoints for backward compatibility
- **Goal**: Migrate the Evaluator Playground frontend to use new endpoints, improving consistency with the new workflow-based architecture

## Documents

| File | Description |
|------|-------------|
| [context.md](./context.md) | Background, motivation, problem statement, goals, and non-goals |
| [current-system.md](./current-system.md) | Detailed map of current Evaluator Playground implementation |
| [new-endpoints.md](./new-endpoints.md) | New evaluator endpoint shapes and differences from legacy |
| [research.md](./research.md) | Deep dive into evaluator execution architecture and URI-based handlers |
| [migration-options.md](./migration-options.md) | Migration plan options: direct vs transitional approaches |
| [risk-analysis.md](./risk-analysis.md) | Coupling points and risk areas for the migration |
| [plan.md](./plan.md) | Migration execution plan with phases and milestones |
| [status.md](./status.md) | Living document for progress updates and decisions |

## Key Files Affected

### Frontend - Core Components
- `web/oss/src/components/Evaluators/` - Evaluators registry
- `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/` - Playground UI
- `web/oss/src/services/evaluators/index.ts` - API service layer
- `web/oss/src/services/evaluations/api_ee/index.ts` - Evaluator run execution

### Frontend - State Management
- `web/oss/src/state/evaluators/atoms.ts` - Evaluator query atoms
- `web/oss/src/lib/atoms/evaluation.ts` - Legacy evaluation atoms

### Backend Reference (PR #3527)
- `api/oss/src/routers/evaluators_router.py` - Legacy endpoints (kept for backward compatibility)
- `api/oss/src/apis/fastapi/evaluators/router.py` - New `SimpleEvaluators` router
- `api/oss/src/core/evaluators/dtos.py` - New data transfer objects
