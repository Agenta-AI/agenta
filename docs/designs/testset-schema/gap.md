# Testset Schema Gap Analysis

## Review Findings On The Original Draft

### 1. Schema was attached to the wrong lifecycle boundary

The original draft repeatedly described schema as “per testset”. In this codebase, the durable snapshot is the **revision**, not the artifact. A schema that only lives on the top-level testset would make older revisions drift when the schema changes later.

Corrected direction:

- store schema on the revision snapshot
- optionally mirror summary flags on the testset or variant later if query ergonomics require it

### 2. Validation was specified against a generic testcase CRUD model that does not really exist

The draft said “validate on testcase creation/update”, but the real system writes testcases through:

- simple testset create/edit
- revision commit
- file upload
- delta commit expansion

Corrected direction:

- validate candidate rows on revision-producing writes
- do not design around a standalone testcase update endpoint that is not the primary persistence path

### 3. The original docs did not define what `is_strict` should mean operationally

`is_strict` is a reasonable starting point for the conversation, but the draft left key semantics undefined:

- Is validation off, warn, or error?
- What should happen when schema exists but old rows do not validate?
- Do uploads use the same behavior as API commits?
- How are warnings surfaced back to clients?

Corrected direction:

- keep `is_strict` in the initial design
- explicitly define what `is_strict=True` and `is_strict=False` mean on each write path
- document mismatch-management alternatives without forcing them into the first field shape

### 4. Prompt-runtime ideas need to stay in the design discussion, but not drive the first implementation phase

The original draft bundled:

- Jinja2 support
- JSONPath integration
- schema-driven hints
- `x-ag-type` semantics

with the foundational storage work, but those topics are still important because they shape how schema will be authored and consumed.

Corrected direction:

- keep the first implementation focused on persistence, validation, and API exposure
- keep prompt/runtime topics explicitly documented as downstream usage constraints that inform the schema design

### 5. Compatibility requirements were missing

The draft did not cover:

- CSV/JSON upload and download behavior
- `preview/simple/testsets/*` compatibility endpoints
- current frontend column inference from testcase rows
- evaluation-run mapping behavior that depends on actual testset columns

Corrected direction:

- preserve file formats
- cover both simple and revisioned APIs
- define how schema augments row-derived columns in the UI

## What Was Actually Missing In The Codebase

- No revision-scoped schema field in testset DTOs
- No concrete semantics for `is_strict`
- No domain exception for schema validation failure
- No service-layer validation step in commit/upload/simple flows
- No web model for declared schema columns that exist before row data does

## Corrected Design Target

The gap is not “we need schema somewhere.” The real gap is:

1. A revision-scoped schema contract for `testcase.data`
2. A write-time definition of what `is_strict` means on ingestion and commit
3. Backward-compatible API exposure
4. Web support that merges declared schema with inferred row columns
5. Clear phase separation between core validation delivery and future runtime integrations, without dropping those runtime topics from the design discussion
