# Testset Schema Research

## Codebase Findings

### 1. Testset revisions are the real persistence boundary

Relevant code:

- `api/oss/src/core/testsets/dtos.py`
- `api/oss/src/core/git/dtos.py`
- `api/oss/src/dbs/postgres/git/dbas.py`

Important observations:

- `Testset`, `TestsetVariant`, and `TestsetRevision` all exist as first-class entities.
- `RevisionDBA` already has a generic `data` JSON column, so the storage layer can persist revision-specific schema metadata without creating a new top-level table on day one.
- `TestsetFlags` is currently just a placeholder type, so it is available for summary-style flags later, but it is not yet an authoritative schema model.

Implication:

- The cleanest first design is to persist schema on the revision snapshot, optionally mirrored by lightweight summary flags for querying.

### 2. Persisted revision data is intentionally minimal today

Relevant code:

- `api/oss/src/core/testsets/dtos.py`
- `api/oss/src/core/testsets/service.py`

Important observations:

- `TestsetRevisionData` only models `testcase_ids` plus hydrated `testcases`.
- `_sanitize_persisted_testset_revision_data()` strips revision data down to canonical persisted fields.
- `_populate_testcases()` rehydrates rows on demand after reading the revision.

Implication:

- Any schema design that assumes testcase rows are embedded in the revision is working against the current storage model.
- If we add schema, sanitization logic must preserve it explicitly.

### 3. The actual write paths are commit-oriented

Relevant code:

- `api/oss/src/core/testsets/service.py`
- `api/oss/src/apis/fastapi/testsets/router.py`

Important observations:

- Full row payload is accepted through revision commit and simple testset flows.
- The service creates testcase blobs first, then writes the revision snapshot containing testcase IDs.
- Delta commits are expanded into a full candidate testcase list before being committed.
- File upload routes parse CSV/JSON into testcase rows and then delegate into the same commit flow.

Implication:

- Validation should run against the candidate revision snapshot before blob creation / commit completion.
- “Validate on testcase create/update” is not precise enough for this codebase.

### 4. The simple API is a compatibility layer that must remain aligned

Relevant code:

- `api/oss/src/core/testsets/service.py`
- `api/oss/src/apis/fastapi/testsets/router.py`
- `web/oss/src/services/testsets/api/index.ts`
- `web/packages/agenta-entities/src/testset/api/mutations.ts`

Important observations:

- `preview/simple/testsets/*` is heavily used by web flows for create, clone, upload, and metadata-oriented fetches.
- Those endpoints create or edit the underlying artifact/variant/revision stack for the caller.
- Any schema feature implemented only on the lower-level revision API would still leave a large unsupported surface in the product.

Implication:

- The design must explicitly cover both the simple and revisioned APIs.

### 5. The web app currently derives columns from rows, not from stored schema

Relevant code:

- `web/oss/src/state/entities/testcase/columnState.ts`
- `web/oss/src/state/entities/testset/controller.ts`
- `web/oss/src/services/evaluationRuns/api/index.ts`
- `web/packages/agenta-entities/src/testset/state/testsetMolecule.ts`

Important observations:

- Column state is derived from keys present in testcase objects plus local edits.
- Evaluation-run mapping uses the actual testset columns as the source of truth and only overlays workflow schema where those columns already exist.
- The web mental model today is “rows imply columns”, not “schema implies columns”.

Implication:

- A testset schema feature should initially augment the UI, not replace row-based inference everywhere.
- Empty-but-declared columns are a deliberate UI enhancement, not something the current system gets for free.

### 6. A JSON Schema helper already exists, but not in the right domain shape

Relevant code:

- `api/oss/src/core/annotations/utils.py`

Important observations:

- The repo already uses `jsonschema` validators and draft selection logic.
- The current helper raises `HTTPException` directly and is tied to annotation request semantics.

Implication:

- The validator-selection logic is reusable.
- The exception strategy is not. Testset validation should raise domain exceptions from core and translate them in the router.

## External Research

### JSON Schema

Useful properties for this feature:

- strong ecosystem support
- explicit draft selection via `$schema`
- support for annotations and vendor extensions
- good error-path reporting for nested payloads

Recommended default:

- default to Draft 2020-12 behavior when `$schema` is omitted, matching the existing annotation helper

### Vendor extensions

JSON Schema implementations generally ignore unknown keywords unless a custom vocab is enforced. That is useful for Agenta-specific metadata such as:

- `x-ag-type`
- future UI hints
- future workflow mapping annotations

Recommendation:

- allow storage of `x-ag-*` keys in v1
- do not assign runtime semantics to them in the backend yet

### JSONPath and Jinja2

These are relevant to future prompt/template integrations, and they should stay part of the design discussion even if they are not implemented in the first persistence rollout:

- they influence what schema authors will expect from field naming and nesting
- they affect whether Agenta-specific extensions like `x-ag-type` should be preserved
- they help define whether schema is only for validation or also for downstream authoring ergonomics

They do not need to be part of the initial persistence implementation. Mixing them directly into v1 delivery would create avoidable scope risk:

- they introduce runtime semantics beyond validation
- they require editor/runtime product decisions, not just storage decisions
- they are not currently part of the testset write path

Recommendation:

- document them as important downstream consumers, not as required first-pass implementation scope

## Research Summary

The codebase already supports almost everything needed for a solid v1:

- revision-scoped JSON storage
- commit-centric orchestration
- optional hydration of testcase rows
- a JSON Schema validation library already in use

The missing work is mostly about making the design match the existing architecture:

- revision-scoped persistence
- validation on the real write paths
- domain-level exception handling
- explicit compatibility behavior for simple API, uploads, and row-derived web columns
