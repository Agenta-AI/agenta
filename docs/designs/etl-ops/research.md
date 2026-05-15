# Research

## Scope

This note investigates the ETL-style flows in the sketch:

- query revision to queue
- query revision to file
- query revision to testset
- query revision plus existing testcases to testset
- testset revision to queue
- testset revision to file
- testset revision to testset

The question is how these can be implemented with the API as it exists today, especially by a frontend, without forcing large trace/testcase payloads into browser memory or doing expensive transformations in the UI. It also compares that with server-side ETL primitives that could run behind the API.

## Image Interpretation

The sketch uses three operations:

- `extract(source_id, windowing, ids | records)` enumerates IDs or full records from a query/testset source.
- `transform(records, mapping)` converts source records into target records.
- `load(target_id, ids | records)` writes IDs or records into a queue, file, testcase store, or testset revision.

The small boxes in the sketch are boundaries where a source can be windowed, transformed, and written in batches. The main pressure point is whether those boxes live in the browser, in the API request handler, or in an async worker.

## Current API Surfaces

The relevant public prefixes are mounted in `api/entrypoints/routers.py`:

- `/queries` and `/simple/queries`
- `/traces` and `/spans`
- `/testsets` and `/simple/testsets`
- `/testcases`
- `/simple/queues`

The reusable scrolling/windowing primitive is `Windowing`, which supports time range fields, `limit`, `next`, `order`, `interval`, and `rate`. It is closer to cursor scrolling over a result stream than page-number pagination.

## Query Sources

Query revisions store expressions, not materialized trace lists:

- `data.formatting`
- `data.filtering`
- `data.windowing`

They may expose materialized data on read:

- `include_trace_ids=true` returns matching `trace_ids`.
- `include_traces=true` returns matching `traces`.
- both flags default to false because executing trace filters is expensive.

Relevant code:

- `api/oss/src/core/queries/dtos.py`
- `api/oss/src/core/queries/service.py`
- `api/oss/src/apis/fastapi/queries/models.py`

A frontend can window query-backed records without holding everything:

1. Call `POST /queries/revisions/retrieve` with `include_trace_ids=true` and a small `windowing.limit`, then fetch traces by ID with `GET /traces?trace_ids=...`.
2. Or call `POST /traces/query` directly with `query_revision_ref` and `windowing.limit`.
3. Or call `POST /queries/revisions/retrieve` with `include_traces=true` only for small batches where the revision endpoint owning hydration is acceptable.

Which path is best depends on the destination and the ownership of the operation:

- read-only UI scrolling: call the record endpoint directly with the revision ref
- direct queue loading: retrieve trace IDs in windows, then add those IDs to a direct queue
- source-attributed queue creation: use source-backed queue creation and let the API resolve IDs
- file export: scroll records in windows and stream rows to the file writer
- transform-to-testset: scroll records in windows, transform each batch, then load bounded testcase batches

## Testset Sources

Testset revisions store immutable ordered testcase IDs:

- `data.testcase_ids`
- `data.testcases` is populated when requested.

Testset read defaults differ from query read:

- `include_testcase_ids` defaults to true.
- `include_testcases` defaults to true.
- callers should explicitly pass `include_testcases=false` when they only need IDs.

Relevant code:

- `api/oss/src/core/testsets/dtos.py`
- `api/oss/src/core/testsets/service.py`
- `api/oss/src/apis/fastapi/testsets/models.py`
- `api/oss/src/apis/fastapi/testcases/router.py`

A frontend can window testset-backed records without holding everything:

1. Call `POST /testsets/revisions/retrieve` with `include_testcase_ids=true`, `include_testcases=false`, and a small `windowing.limit`.
2. Fetch records with `POST /testcases/query` using `testcase_ids`, or call `POST /testcases/query` with `testset_revision_ref` and a small `windowing.limit`.
3. Preserve the order returned by the revision ID list when loading into a destination.

Which path is best depends on the destination:

- read-only UI scrolling: call `POST /testcases/query` with `testset_revision_ref`
- direct queue loading: retrieve testcase IDs in windows, then add those IDs to a direct queue
- source-attributed queue creation: use source-backed queue creation and let the API resolve IDs
- file export: scroll testcases in windows and stream rows to the file writer, unless the current download endpoint is known to be safe for the size
- transform-to-testset: scroll records in windows, transform each batch, then load bounded testcase batches

## Queue Targets

The current worktree already supports two queue creation styles.

Direct item queues:

- `POST /simple/queues/` with `data.kind="traces"` or `data.kind="testcases"`.
- `POST /simple/queues/{queue_id}/traces/` with concrete trace IDs.
- `POST /simple/queues/{queue_id}/testcases/` with concrete testcase IDs.

Source-backed queues:

- `POST /simple/queues/` with `data.queries=[query_revision_id]`.
- `POST /simple/queues/` with `data.testsets=[testset_revision_id]`.
- `kind` is inferred as `traces` for query sources and `testcases` for testset sources.
- the run preserves source revision references in input steps.
- the service resolves source revision IDs and dispatches concrete trace/testcase batches at queue creation.

Important constraints:

- a queue requires evaluators.
- a request must not mix `kind` with `queries` or `testsets`.
- a request must not include both `queries` and `testsets`.
- direct add endpoints reject source-backed queues with a `400`.

Relevant code:

- `api/oss/src/core/evaluations/types.py`
- `api/oss/src/core/evaluations/service.py`
- `api/oss/src/apis/fastapi/evaluations/router.py`
- `api/oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py`

For the queue flows in the sketch, the lowest-pressure default path is high-level source-backed queue creation. It keeps source attribution server-side and avoids moving every trace/testcase ID through the browser.

The direct extract-then-add loop should still remain supported. It is useful when the frontend already has a curated explicit selection, needs custom source-window control, or is combining sources before deciding which concrete trace/testcase IDs belong in the queue. In that path, the client should extract IDs in bounded windows and add them to a direct `kind="traces"` or `kind="testcases"` queue in batches.

## File Targets

There is no general file domain or `file_id` target for ETL outputs.

The API supports testset CSV/JSON upload and download:

- `POST /simple/testsets/upload`
- `POST /simple/testsets/{testset_id}/upload`
- `POST /simple/testsets/{testset_id}/download`
- `POST /testsets/revisions/{testset_revision_id}/upload`
- `POST /testsets/revisions/{testset_revision_id}/download`

These endpoints are useful for testset import/export and are good enough for current bounded testset downloads. They are not generic ETL file operations yet, because they are scoped to testsets rather than arbitrary query/testset sources and mappings.

The implementation currently builds export buffers from materialized testcases before returning `StreamingResponse`. That is acceptable for now. A row-by-row streaming pipeline is only a future scale improvement if large exports become a problem.

Relevant code:

- `api/oss/src/apis/fastapi/testsets/router.py`
- `api/oss/tests/pytest/acceptance/testsets/test_testsets_files.py`

For query-to-file, the product shape is an export/download flow. Today the frontend can scroll traces in bounded windows and build the downloaded file locally. A backend export/download job would be the cleaner long-running version.

## Testset Targets

The public API loads records into testsets through testset creation, edit, upload, or revision commit:

- `POST /simple/testsets/` creates a simple testset and first revision.
- `PUT /simple/testsets/{testset_id}` commits replacement content when `data.testcases` is provided.
- `POST /testsets/revisions/commit` commits a new revision.
- file upload endpoints create/replace testset content from CSV/JSON.

There is no public standalone `POST /testcases/` endpoint today. For ETL, there probably should be one. Testcases are blob-backed records, and loading transformed records into the testcase store before attaching their IDs to a testset revision is a natural `load(testcase_id, records)` primitive from the sketch.

Without a standalone testcase loader, query-to-testset today has to:

1. Window query results.
2. Transform each trace to testcase-shaped `{data: ...}` records.
3. Accumulate enough records to submit a testset create/edit/commit payload.

That workaround can create browser memory pressure because the frontend may need to hold transformed testcase records before it can write the target testset.

A better API-backed path would split this into two loads and avoid holding all testcase records in memory:

1. `POST /testcases/` creates or upserts testcase records in batches and returns `testcase_ids`.
2. `POST /testsets/revisions/commit` commits a target revision with the resulting `testcase_ids`.

With that path, the frontend only needs the current source window, the current transformed batch, and the returned testcase IDs. The IDs are much smaller than full testcase records. For very large outputs, the remaining all-IDs commit can move behind a backend job or a future append/chunk revision primitive.

The file handoff path should also be supported:

1. query-to-file export/download produces CSV, JSON, or JSONL from bounded source windows
2. the user or frontend uploads that file through the existing testset upload endpoints
3. the upload path creates the testset or target revision

This is useful when the file itself is a desired artifact, when users want to inspect/edit the transformed rows before import, or when a disconnected export/import workflow is acceptable. It is less direct than `POST /testcases/` because it does two passes through serialization and upload parsing, but it is pragmatic and should remain supported.

## Transform Mapping And Filtering

There is no general public mapping/filtering DSL for ETL transforms.

Existing mapping concepts are evaluation-run result mappings, not a generic trace/testcase/file transformation engine. A frontend can still apply a mapping locally, but that is only safe for small or bounded batches.

A backend primitive would need to define:

- source selector paths for traces and testcases
- source field to destination field mappings
- transform-local filtering rules for dropping records after extraction
- output field names
- type coercion rules
- missing-field behavior
- filter error behavior
- error reporting per record
- dedup behavior for testcase creation

Transform filtering is different from source filtering:

- source filtering narrows what the query/testset source extracts
- transform filtering decides whether an extracted record should be loaded after mapping rules and local predicates are applied

The transform filtering DSL should be constrained JSON, not arbitrary code. It should support boolean groups, field selectors, simple comparison operators, and explicit behavior for missing values.

## Frontend-Only Pressure Profile

Safe frontend patterns today:

- use `windowing.limit` and process one source window at a time
- fetch IDs first when the destination can accept IDs
- use source-backed queue creation when source attribution and low browser pressure matter
- use direct queue loading when the frontend owns the concrete ID selection
- keep transform batches small
- use direct testcase batch creation when available instead of holding all transformed records
- support file export/import handoff when the file is the desired intermediate artifact
- use Web Workers for CPU-heavy local mapping
- write file exports through browser streaming APIs when available

Remaining pressure:

- query-to-file is an export/download flow and currently requires client-side export orchestration unless a backend export job is added
- query-to-testset currently requires client-side transform and target commit orchestration unless using a future testcase loader or backend job
- existing testset download buffers rows server-side before streaming to the client, which is acceptable for bounded exports
- no resumable server-side ETL job exists if the browser tab closes

## Server-Side Runtime Considerations

Moving ETL behind the API later could shift the work to controllable server-side boundaries:

- extraction can run with server-side cursors and small windows
- transformation can run close to the data
- load operations can be idempotent and resumable
- queues can be dispatched without round-tripping every ID through the frontend
- file exports can stream from extractor to encoder to object storage or response

This is deferred until the transformation architecture is settled. If backend execution is added later, it should not be a synchronous request that materializes all records. It should be an async operation or job that stores progress, errors, and destination references.

## Summary Matrix

This matrix lists paths, not decisions. When one flow has two viable paths, both are separate rows.

| Flow | Path | API composition | Status | Pressure / tradeoff |
|---|---|---|---|---|
| Query -> queue | Source-backed queue | `POST /simple/queues/` with `data.queries=[query_revision_id]` | Available now | Lowest browser pressure; source attribution stays in run data |
| Query -> queue | Direct trace queue from extracted IDs | Window trace IDs, create `kind="traces"` queue, then `POST /simple/queues/{id}/traces/` | Available now | More frontend control; useful for explicit selections and combined sources |
| Query -> file | Frontend export/download | Window `/traces/query`, transform rows, append to browser file | Available now | Browser owns progress/cancel/retry; no backend job needed |
| Query -> file | File artifact handoff | Same export/download output, kept as CSV/JSON/JSONL artifact | Available now as frontend-owned file | Useful when the file itself is the deliverable |
| Query -> testset | Direct transformed commit | Window traces, transform to testcase records, commit target testset revision with records | Available now | Can pressure browser memory for large outputs |
| Query -> testset | Batch testcase load then commit IDs | Window traces, transform active batch, `POST /testcases/`, commit returned IDs to testset revision | Needs `POST /testcases/` design | Avoids holding full transformed testcase records |
| Query -> testset | File handoff | Export/download transformed rows, then upload through testset upload endpoint | Available with frontend export + existing upload | Two-pass serialization/parsing; supports user inspection/editing |
| Query + testcases -> testset | Frontend join then direct commit | Window traces and testcases, join/merge, transform, commit records | Available for bounded jobs | High coordination and memory pressure for large jobs |
| Query + testcases -> testset | Frontend join, batch testcase load, commit IDs | Window both sources, join/merge active windows, `POST /testcases/`, commit IDs | Needs transform architecture + `POST /testcases/` design | Lower record memory, still needs join/checkpoint semantics |
| Query + testcases -> testset | File handoff | Join/merge into export/download file, then upload to testset | Available with frontend export + existing upload | Practical checkpoint artifact; two-pass workflow |
| Testset -> queue | Source-backed queue | `POST /simple/queues/` with `data.testsets=[testset_revision_id]` | Available now | Lowest browser pressure; source attribution stays in run data |
| Testset -> queue | Direct testcase queue from extracted IDs | Window testcase IDs, create `kind="testcases"` queue, then `POST /simple/queues/{id}/testcases/` | Available now | More frontend control; useful for explicit selections and combined sources |
| Testset -> file | Built-in testset download | `POST /testsets/revisions/{id}/download` or simple testset download | Available now | Good enough for bounded exports |
| Testset -> file | Frontend windowed export/download | Window `/testcases/query`, transform rows, append to browser file | Available now | Needed for custom mapping/filtering before file output |
| Testset -> testset | Direct transformed commit | Window source testcases, transform to testcase records, commit target revision | Available now | Can pressure browser memory for large outputs |
| Testset -> testset | Batch testcase load then commit IDs | Window source testcases, transform active batch, `POST /testcases/`, commit returned IDs | Needs `POST /testcases/` design | Avoids holding full transformed testcase records |
| Testset -> testset | File handoff | Export/download transformed rows, then upload through testset upload endpoint | Available with frontend export + existing upload | Two-pass workflow; useful when file checkpoint matters |

## Current Path Inventory

The current API supports multiple paths. Which one applies depends on source, destination, UX, data size, and whether the user wants a file artifact.

- source-backed queue: create the queue from query/testset revision IDs and let the API resolve execution items
- direct queue: extract trace/testcase IDs in windows and add them to a direct queue
- read-only scrolling: call record endpoints with revision refs and small `windowing.limit`
- ID-driven transform: retrieve IDs in windows, fetch records in bounded chunks, transform, then load
- direct testcase loading: create/upsert testcases in batches, then commit a testset revision with returned IDs, once `POST /testcases/` exists
- file handoff: export/download transformed rows and upload them through testset file endpoints
- file output: export/download only, without creating a testset
