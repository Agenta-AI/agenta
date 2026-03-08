# Context: Migrate Evaluator Playground

## Background

The Agenta platform has undergone a significant architectural change where **evaluators are now workflows**. This means evaluators follow the same git-like versioning model as other workflows:
- **Artifact** (Evaluator) → **Variant** → **Revision**

Previously, evaluators were stored in a flat `EvaluatorConfigDB` table with simple key-value settings. The new model stores evaluators as `WorkflowArtifactDBE`, `WorkflowVariantDBE`, and `WorkflowRevisionDBE` records with richer metadata and versioning.

## Motivation

1. **Unified Architecture**: Evaluators, testsets, and apps now share the same git-like workflow model
2. **Better Versioning**: Evaluators can have multiple variants and revision history
3. **Richer Metadata**: New model supports URIs, schemas, scripts, and configuration in a structured way
4. **Future Extensibility**: Custom evaluators will be first-class citizens with the same capabilities as built-in ones

## Problem Statement

The Evaluator Playground frontend currently uses legacy endpoints:
- `GET /evaluators/` - List evaluator templates
- `GET/POST/PUT/DELETE /evaluators/configs/` - CRUD for evaluator configurations
- `POST /evaluators/{key}/run/` - Run evaluator in playground

The backend (PR #3527) has:
1. Migrated all evaluator configs to the new workflow-based model via DB migrations
2. Created new `SimpleEvaluators` endpoints at `/preview/simple/evaluators/`
3. Native workflow execution available at `/preview/workflows/invoke`
4. Kept legacy endpoints as thin wrappers (to be deprecated)

**The frontend needs to migrate to use the new endpoints directly.**

## Goals

1. **Replace legacy evaluator config CRUD** with new `SimpleEvaluator` endpoints
2. **Replace legacy evaluator run** with native workflow invoke (`/preview/workflows/invoke`)
3. **Update data models** in frontend to match new `SimpleEvaluator` shape (no adapters)
4. **Preserve UX** - no user-facing changes to the Evaluator Playground functionality
5. **Remove all legacy endpoint usage** - clean migration, no dual-path code

## Non-Goals

1. **Not changing the Evaluator Playground UI** - Only the data layer changes
2. **Not migrating evaluation batch runs** - Those already use the new workflow system internally
3. **Not introducing new evaluator features** - This is a pure endpoint migration

## Success Criteria

1. Evaluator Playground can create, edit, delete evaluators using new `SimpleEvaluator` endpoints
2. Evaluator Playground can run evaluators using native workflow invoke
3. All existing evaluator configurations continue to work
4. No regression in evaluator testing functionality
5. No legacy endpoint calls remain in frontend code

## Constraints

1. Must not break existing evaluator configurations
2. Must coordinate with backend team on endpoint availability (PR #3527)
3. Split into two PRs for reviewability (CRUD first, then Run)

## Migration Approach

**Direct migration (no adapters):**

| PR | Scope | Endpoints |
|----|-------|-----------|
| PR 1 | CRUD | `/preview/simple/evaluators/*` |
| PR 2 | Run | `/preview/workflows/invoke` |

This approach:
- Avoids tech debt from adapter layers
- Aligns internal types with backend models
- Keeps changes reviewable by splitting into two PRs
