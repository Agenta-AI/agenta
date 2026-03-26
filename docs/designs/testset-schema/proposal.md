# Testset Schema Proposal

## Recommendation

Introduce **optional revision-scoped JSON Schema** for `testcase.data`, enforced on **revision-producing write paths** with an initial **`is_strict`** control that defines how schema mismatches are handled during ingestion and commit.

This feature should ship in phases:

- Phase 1: persistence + API exposure
- Phase 2: validation semantics for `is_strict` on create/edit/commit/upload
- Phase 3: web support for declared columns and validation feedback
- Phase 4: future runtime consumers such as prompt hints or JSONPath-aware tooling

## Proposed Data Model

### Revision-scoped schema contract

Extend `TestsetRevisionData` with two new optional fields:

- `schema`
  - JSON Schema document describing `testcase.data`
- `is_strict`
  - initial enforcement control for schema mismatches

Suggested shape:

```python
class TestsetRevisionData(BaseModel):
    testcase_ids: Optional[List[UUID]] = None
    testcases: Optional[List[Testcase]] = None
    schema: Optional[Dict[str, Any]] = None
    is_strict: Optional[bool] = None
```

Notes:

- `schema` lives on the revision because it is part of the immutable contract for that snapshot.
- `is_strict` is grouped with the revision data so reads return the full contract in one place.
- `flags` can later expose summaries such as `has_schema`, but flags should not be the authoritative store.

### Why not artifact-level only?

Because revision history matters. If testset `A` has revisions `v1`, `v2`, and `v3`, each revision must be fetchable with the schema that applied at commit time. Otherwise old revisions become semantically unstable.

### Why not testcase-level schema?

Because the system stores testcases as blobs and revisions only keep testcase IDs. Per-row schema would duplicate contract metadata across every testcase and create drift risk without adding meaningful power for the first version.

## `is_strict` Semantics

### Keep `is_strict` as the first field

Use `is_strict` in the initial design and define its behavior precisely:

- `is_strict=False`
  - schema is stored but mismatches do not block the write
- `is_strict=True`
  - invalid rows block revision creation

### Validation rules

When `is_strict is True`:

1. Every candidate testcase row must validate against `schema`.
2. Validation runs before blob creation and before the revision commit finalizes.
3. Any invalid row aborts the whole write.

When `is_strict is False` or missing:

- store the schema contract but do not reject rows

### Why discuss richer mismatch handling anyway

Keeping `is_strict` does not remove the need to discuss alternatives such as warn-only behavior. Those discussions are still necessary to understand:

- what users mean by schema mismatch management
- whether upload and commit should behave identically
- how validation outcomes should be surfaced in the UI

The distinction here is:

- keep `is_strict` as the initial field
- document richer policies as design context, not as mandatory v1 data-model expansion

### Unknown Agenta extension keys

Permit `x-ag-*` keys to be stored in the schema document.

V1 behavior:

- stored and returned unchanged
- ignored by backend validation logic unless they conflict with standard JSON Schema processing
- no runtime or UI semantics required yet

## Validation Lifecycle

### Validate on write, not on read

Validation should run when a caller attempts to create a new revision snapshot:

- `POST /preview/simple/testsets/`
- `PUT /preview/simple/testsets/{id}`
- `POST /preview/testsets/revisions/commit`
- `POST /preview/testsets/revisions/{id}/upload`
- simple upload flows that delegate into revision commit
- delta commits after the delta has been expanded into a candidate testcase list

Do not validate on:

- `fetch`
- `query`
- `retrieve`
- `download`

Reasons:

- read paths should stay cheap
- old revisions should remain fetchable even if policy or validator code evolves
- validation belongs to mutation semantics, not retrieval semantics

### Delta commits

Delta commits need special handling:

1. Load the base revision
2. Apply row and column operations
3. Produce the final candidate testcase list
4. Validate that final list against the candidate schema contract
5. Only then create blobs and commit the new revision

This keeps delta behavior semantically identical to full-snapshot commits.

## Error Model

### Domain exception

Add a testset-domain exception such as:

```python
class TestsetSchemaValidationError(Exception):
    def __init__(self, *, errors: List[TestsetSchemaValidationIssue]):
        self.errors = errors
        super().__init__("Testset rows do not match schema.")
```

Each issue should carry structured context, for example:

- `row_index`
- `testcase_id` if provided
- `path`
- `message`

### Router translation

Translate the domain exception into `422 Unprocessable Entity` at the API boundary.

Do not raise `HTTPException` from the core service just because the annotation module has a helper that does that today. If validator-selection logic is reused from annotations, split the reusable portion from the HTTP-specific portion first.

## API Surface

### Preview revision API

Update revision create/edit/commit/retrieve/query models so callers can send and receive:

- `data.schema`
- `data.is_strict`

Even when `include_testcases=false`, schema metadata should still be returned because it is revision metadata, not hydrated row content.

### Simple API

Update the simple models so they can also accept and return schema metadata.

The simple layer should:

- pass schema through to revision create/commit flows
- enforce the same `is_strict` semantics as the lower-level revision API

### Upload endpoints

Keep the file payload format backward compatible:

- CSV stays row-based
- JSON file upload stays row-array based

If upload needs to set or override schema, send that separately as request metadata, not embedded into the existing file format. That avoids breaking current exporters and importers.

## Downstream Usage Topics That Must Inform The Design

These topics should remain in the design discussion because they influence how schema should be authored and stored, even if they are not part of the first delivery slice:

- Jinja2 access patterns for testcase fields
- JSONPath-style addressing for nested testcase data
- `x-ag-type` and similar extensions for richer authoring semantics
- schema-driven hints for prompt or mapping UIs

The important boundary is implementation scope, not discussion scope.

## Web / UX Behavior

### Backward-compatible mental model

The current UI derives columns from testcase rows. V1 should keep that working and add schema as an additional signal.

Recommended behavior:

- if schema is absent:
  - current behavior unchanged
- if schema is present:
  - show the union of:
    - inferred row columns
    - schema-declared top-level properties

This allows:

- empty columns declared by schema to appear before any row uses them
- old testsets with no schema to behave exactly as they do today

### Validation feedback

V1 UI work can stay modest:

- show schema presence and mode
- surface backend validation errors on failed commit/upload
- optionally highlight offending row/column paths when available

## Migration And Compatibility

### Existing data

For existing testsets and revisions:

- `schema = null`
- `is_strict = null` or `false`

No backfill is required for the initial release.

### Existing downloads

Do not change row export shape for:

- CSV download
- JSON download

Schema should remain available through revision metadata APIs, not silently injected into row export files.

### Existing web logic

Current code that expects rows-only behavior must continue to work when schema is absent. Any new schema-aware logic should be additive.

## Explicit Non-Goals For Initial Delivery

- shipping Jinja2 context injection
- shipping JSONPath evaluation helpers
- shipping prompt editor autocomplete
- schema registry / reusable named schemas
- shipping per-field runtime semantics for `x-ag-type`

Those are future implementation slices, not prerequisites for storing and validating schema correctly. They still belong in the design discussion because they shape how the schema will be defined and used.
