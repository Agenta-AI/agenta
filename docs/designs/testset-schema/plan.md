# Testset Schema Implementation Plan

## Phase 0: Domain groundwork

1. Add testset-domain schema DTOs:
   - optional typed wrapper for schema document if needed
2. Add testset-domain exceptions for validation failure and invalid schema configuration.
3. Extract reusable JSON Schema validator-selection logic from the annotation helper or create a small shared validator helper that does not raise `HTTPException`.

## Phase 1: Revision data model and API shape

1. Extend `TestsetRevisionData` with:
   - `schema`
   - `is_strict`
2. Update sanitization so persisted revision data keeps:
   - `testcase_ids`
   - `schema`
   - `is_strict`
3. Update preview API models to accept and return the new fields.
4. Update simple API models to accept and return the new fields.
5. Add migration coverage for persisted revision `data` shape if any schema defaults are needed at the database layer.

## Phase 2: Validation semantics on real write paths

1. Validate schema document shape when a schema is provided.
2. Define and implement `is_strict` semantics on:
   - simple create
   - simple edit
   - revision commit
   - revision upload
   - delta commit after expansion
3. Ensure validation runs before blob creation is finalized.
4. Return structured `422` errors from the router when rows do not validate.

## Phase 3: Web support

1. Extend testset/revision schemas in web entities to include:
   - `data.schema`
   - `data.is_strict`
2. Merge schema-declared columns with row-inferred columns in the revision/testcase column state.
3. Surface schema metadata in relevant editors and detail views.
4. Surface backend validation failures in commit/upload flows.

## Phase 4: Follow-on integrations

These should be separate follow-up work, but they should stay explicitly documented because they inform the schema design:

1. Editor affordances based on `x-ag-*` metadata
2. Workflow-to-testset compatibility hints beyond simple column checks
3. Prompt/Jinja2 or JSONPath integrations
4. Schema templates or registry features

## Testing Plan

### API / core tests

- Unit tests for validator selection and policy handling
- Unit tests for row validation error shaping
- Service tests for:
  - full revision commit
  - delta commit
  - simple create/edit
  - upload parsing + validation
- Acceptance tests for:
  - valid schema + valid rows
  - valid schema + invalid rows
  - schema absent
  - `is_strict=false`
  - `is_strict=true`
  - backward-compatible download behavior

### Web tests

- Entity parsing tests for schema-bearing revision payloads
- State tests for column derivation:
  - rows only
  - schema only
  - rows + schema
- UI tests for validation error handling in save/upload flows

## Open Questions

These are the remaining questions worth deciding after the core design, not before it:

1. Should V1 expose summary flags such as `has_schema` on testset/testset revision query responses?
2. Should `is_strict=false` remain simple pass-through behavior, or should we surface structured warnings even before introducing a richer field?
3. Should upload endpoints accept schema overrides in multipart form data from day one, or only reuse existing schema on the target testset?
4. How much of the schema should the web UI expose initially: raw JSON only, or basic form-based editing for top-level properties?
