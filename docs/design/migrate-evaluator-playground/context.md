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
3. Kept legacy endpoints as thin wrappers that convert new model back to legacy format

**The frontend needs to migrate to use the new endpoints directly.**

## Goals

1. **Replace legacy evaluator config CRUD** with new `SimpleEvaluator` endpoints
2. **Update data models** in frontend to match new `SimpleEvaluator` shape
3. **Maintain backward compatibility** during transition (feature flag or gradual rollout)
4. **Keep the evaluator run endpoint** (`/evaluators/{key}/run/`) - this remains unchanged
5. **Preserve UX** - no user-facing changes to the Evaluator Playground functionality

## Non-Goals

1. **Not migrating the evaluator run endpoint** - The `/evaluators/{key}/run/` endpoint is still used and works the same way
2. **Not changing the Evaluator Playground UI** - Only the data layer changes
3. **Not migrating evaluation batch runs** - Those use evaluator revision IDs which are handled by the backend migration
4. **Not introducing new evaluator features** - This is a pure backend migration

## Success Criteria

1. Evaluator Playground can create, edit, delete evaluators using new endpoints
2. All existing evaluator configurations continue to work
3. No regression in evaluator testing functionality
4. Clean removal of legacy endpoint usage in frontend

## Constraints

1. Must not break existing evaluator configurations
2. Must coordinate with backend team on endpoint availability
3. Should be deployable incrementally (not big-bang)
