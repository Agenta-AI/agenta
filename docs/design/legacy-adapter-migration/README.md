# Legacy Adapter Migration

This document scopes the migration away from the legacy adapter-backed routers:

- `/apps`
- `/variants`
- `/configs`
- `/environments` (legacy deploy RPC)

The goal is to replace those router families with the new entity routers:

- `/preview/applications`
- `/preview/workflows`
- `/preview/evaluators`
- `/preview/environments`
- `/preview/simple/environments`

## Summary

The new entity routers already cover almost all of the old CRUD and revision history surface:

- apps/applications CRUD
- variants CRUD
- revision create, fetch, query, commit, log
- evaluator config CRUD
- environment CRUD

What is still missing is not generic storage capability. The gap is mostly a set of old RPC-style deployment and config convenience endpoints.

## Main Findings

### 1. The real gap is deployment convenience, not data capability

The old routers expose one-call deploy/retrieve/revert flows:

- `POST /environments/deploy`
- `GET /apps/get_variant_by_env`
- `GET /apps/{app_id}/environments`
- `GET /apps/{app_id}/revisions/{environment_name}`
- `GET /configs/deployment/{deployment_revision_id}`
- `POST /configs/deployment/{deployment_revision_id}/revert`
- `POST /variants/configs/deploy`
- `POST /variants/configs/fetch` when used with `environment_ref`

The new entity routers can represent the same state through environment revisions and application/workflow revisions, but callers have to orchestrate several steps themselves.

### 2. Some old endpoints are only thin convenience wrappers now

These legacy endpoints are already conceptually covered by generic entity operations:

- `POST /variants/from-base`
- `PUT /variants/{variant_id}/parameters`
- `PUT /variants/{variant_id}/service`
- `GET /variants/{variant_id}/revisions`
- `GET /variants/{variant_id}/revisions/{revision_number}`
- `POST /variants/revisions/query`
- `POST /variants/configs/add`
- `POST /variants/configs/commit`
- `POST /variants/configs/history`
- `POST /variants/configs/list`
- `POST /variants/configs/query`

The new DTOs already support revision `data.url`, `data.parameters`, and even the temporary legacy `data.service` / `data.configuration` fields during migration.

### 3. A few legacy concepts should not be carried forward as first-class APIs

These should stay deprecated:

- `template_key`-driven app creation
- `base_id` and `config_name` as primary API concepts
- legacy `ConfigDTO` as the canonical public contract

### 4. SDK migration is required

The remaining migration work is mainly in the managed SDK/client layer, not in Fern-generated clients:

- replace legacy config/deploy helpers with entity-router calls
- move evaluator execution to workflow invocation where needed
- normalize on the new entity DTOs instead of legacy adapter DTOs

## Recommendation

Do both:

1. Add a small set of explicit deployment/retrieval RPCs to the new routers.
2. Migrate the SDK to those new endpoints instead of keeping the legacy adapters alive.

That is cleaner than preserving `/apps`, `/variants`, `/configs`, and the old `/environments` deploy route as permanent compatibility surface.

## Proposed API Additions

### On environments

Add RPCs that operate on environment deployment state directly:

- `POST /preview/environments/deploy`
- `POST /preview/environments/retrieve`
- `POST /preview/environments/revert`

Suggested semantics:

- `deploy`: write a revision reference into a new environment revision
- `retrieve`: resolve the currently deployed application/workflow revision for a key or artifact
- `revert`: replay a historical environment revision as a new deployment commit

These endpoints are the closest replacement for the old deployment-oriented adapter surface.

### On workflows or applications

Optional thin wrappers can improve ergonomics:

- `POST /preview/workflows/deploy`
- `POST /preview/workflows/retrieve`

or equivalently on applications:

- `POST /preview/applications/deploy`
- `POST /preview/applications/retrieve`

If we only add one family, environments should win. Deployment state belongs to environments.

## SDK Scope

The SDK should migrate away from legacy adapter routes in this order:

1. Deploy/retrieve/revert helpers
2. Config fetch/list/history helpers
3. Variant shorthand helpers

The Fern clients do not need to drive this migration. This is primarily SDK manager and handwritten helper logic.

## Detailed Audit

See [route-gap-analysis.md](./route-gap-analysis.md).
