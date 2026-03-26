# Testset Schema Context

## Why this document exists

The current `testset-schema` draft asks the right product question, but it is still too generic for this codebase. Agenta testsets are not a flat table with ad hoc rows. They are versioned resources built on the shared artifact/variant/revision model, and the actual testcase payload is stored in blobs that are only linked from a revision snapshot.

That architecture changes the design space in a few important ways:

- Schema placement must preserve revision history.
- Validation must happen on revision-producing write paths, not on an abstract testcase CRUD layer.
- CSV/JSON upload and the `preview/simple/testsets/*` compatibility layer must keep working.
- The web app currently infers columns from row data, so a declared schema has to complement that model instead of replacing it overnight.

## Current Architecture

### Testsets are revisioned entities

The backend models testsets as:

- `Testset` artifact
- `TestsetVariant`
- `TestsetRevision`

Relevant files:

- `api/oss/src/core/testsets/dtos.py`
- `api/oss/src/core/testsets/service.py`
- `api/oss/src/dbs/postgres/testsets/dbes.py`

### Revisions persist testcase IDs, not embedded row payload

`TestsetRevisionData` currently contains:

- `testcase_ids`
- hydrated `testcases` for API responses only

The service explicitly sanitizes persisted revision data down to `testcase_ids` before commit/create/edit. Full testcase payload is created in blob storage and then referenced from the revision.

That means a testset schema should be modeled as revision metadata or revision data, not as duplicated state inside every testcase row.

### There are two API shapes in active use

The design has to support both:

- The revisioned preview API:
  - `/preview/testsets/*`
  - `/preview/testsets/revisions/*`
- The compatibility layer:
  - `/preview/simple/testsets/*`

The simple endpoints are not a separate domain model. They orchestrate artifact + variant + revision + commit in one higher-level flow.

### Frontend columns are inferred from testcase data

The current web model treats columns as:

- the union of keys found across testcase rows
- plus local column edits that have not yet been committed

Relevant files:

- `web/oss/src/state/entities/testset/controller.ts`
- `web/oss/src/state/entities/testcase/columnState.ts`
- `web/packages/agenta-entities/src/testset/state/testsetMolecule.ts`

This matters because a schema-backed design should not assume the UI already has a first-class persisted column definition model.

## Goals

- Allow a testset revision to carry an optional JSON Schema for `testcase.data`.
- Keep the feature backward compatible for existing testsets and revisions.
- Validate candidate testcase rows before a new revision is committed when validation is enabled.
- Return schema metadata through the existing preview and simple APIs.
- Support future UI affordances such as empty-column creation, validation feedback, and workflow-to-testset compatibility hints.

## Non-Goals For V1

- shipping full Jinja2 runtime integration
- shipping JSONPath expression support in prompts
- shipping editor autocomplete driven by schema
- a shared global schema registry
- schema-driven transformation of testcase payload at read time

Those can be layered on later as implementation work. They still need to be discussed at design time because they affect:

- how schema authors will expect to reference testcase data
- whether extensions such as `x-ag-type` are worth preserving from day one
- how much structure the schema needs beyond raw JSON Schema validation

The first implementation should still prioritize persistence, validation, API shape, and UI compatibility.

## Design Constraints

### Preserve revision immutability

If revision `v3` was valid under a given schema, fetching `v3` later should still show that same schema contract. A mutable schema stored only on the artifact would break this property.

### Keep read paths cheap and stable

Revision retrieval already uses selective hydration and caching for metadata-only reads. Adding schema must not turn every read into a full validation or recomputation step.

### Keep file interchange backward compatible

Current CSV/JSON import and export primarily deal with row payloads. Introducing schema must not silently change file formats for existing callers.

### Align with existing domain boundaries

Validation belongs in the testset core service, with domain exceptions surfaced at the API layer. The design should not introduce new HTTP-coupled validation behavior inside core services.

## Recommended framing

Treat testset schema as **optional revision-scoped contract metadata**:

- stored alongside the revision snapshot
- enforced on write when enabled
- returned on read
- ignored when absent

That gives the feature a stable base without forcing prompt/runtime integrations into the first implementation.
