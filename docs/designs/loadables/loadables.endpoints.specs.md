# Loadables — Endpoint Specifications

------------------------------------------------------------------------

## 1. Testsets

### 1.1 Testsets (Artifact)

Base prefix: `/api/testsets`

| Method | Path                       | Operation ID           |
|--------|----------------------------|------------------------|
| POST   | `/`                        | `create_testset`       |
| GET    | `/{testset_id}`            | `fetch_testset`        |
| PUT    | `/{testset_id}`            | `edit_testset`         |
| POST   | `/{testset_id}/archive`    | `archive_testset`      |
| POST   | `/{testset_id}/unarchive`  | `unarchive_testset`    |
| POST   | `/query`                   | `query_testsets`       |

### 1.2 Testset Variants

Base prefix: `/api/testsets/variants`

| Method | Path                              | Operation ID                |
|--------|-----------------------------------|-----------------------------|
| POST   | `/`                               | `create_testset_variant`    |
| GET    | `/{testset_variant_id}`           | `fetch_testset_variant`     |
| PUT    | `/{testset_variant_id}`           | `edit_testset_variant`      |
| POST   | `/{testset_variant_id}/archive`   | `archive_testset_variant`   |
| POST   | `/{testset_variant_id}/unarchive` | `unarchive_testset_variant` |
| POST   | `/query`                          | `query_testset_variants`    |

### 1.3 Testset Revisions

Base prefix: `/api/testsets/revisions`

| Method | Path                               | Operation ID                        |
|--------|------------------------------------|-------------------------------------|
| POST   | `/`                                | `create_testset_revision`           |
| GET    | `/{testset_revision_id}`           | `fetch_testset_revision`            |
| PUT    | `/{testset_revision_id}`           | `edit_testset_revision`             |
| POST   | `/{testset_revision_id}/archive`   | `archive_testset_revision`          |
| POST   | `/{testset_revision_id}/unarchive` | `unarchive_testset_revision`        |
| POST   | `/{testset_revision_id}/download`  | `fetch_testset_revision_to_file`    |
| POST   | `/{testset_revision_id}/upload`    | `create_testset_revision_from_file` |
| POST   | `/query`                           | `query_testset_revisions`           |
| POST   | `/commit`                          | `commit_testset_revision`           |
| POST   | `/retrieve`                        | `retrieve_testset_revision`         |
| POST   | `/log`                             | `log_testset_revisions`             |

------------------------------------------------------------------------

## 2. (Simple) Testsets

Base prefix: `/api/simple/testsets`

| Method | Path                       | Operation ID                      |
|--------|----------------------------|-----------------------------------|
| POST   | `/`                        | `create_simple_testset`           |
| GET    | `/{testset_id}`            | `fetch_simple_testset`            |
| PUT    | `/{testset_id}`            | `edit_simple_testset`             |
| POST   | `/{testset_id}/archive`    | `archive_simple_testset`          |
| POST   | `/{testset_id}/unarchive`  | `unarchive_simple_testset`        |
| POST   | `/{testset_id}/upload`     | `edit_simple_testset_from_file`   |
| POST   | `/{testset_id}/download`   | `fetch_simple_testset_to_file`    |
| POST   | `/query`                   | `query_simple_testsets`           |
| POST   | `/upload`                  | `create_simple_testset_from_file` |

------------------------------------------------------------------------

## 3. Testcases

Base prefix: `/api/testcases`

| Method | Path             | Operation ID      |
|--------|------------------|-------------------|
| GET    | `/{testcase_id}` | `fetch_testcase`  |
| GET    | `/`              | `fetch_testcases` |
| POST   | `/query`         | `query_testcases` |

------------------------------------------------------------------------

## 4. Queries

### 4.1 Queries (Artifact)

Base prefix: `/api/queries`

| Method | Path                      | Operation ID      |
|--------|---------------------------|-------------------|
| POST   | `/`                       | `create_query`    |
| GET    | `/{query_id}`             | `fetch_query`     |
| PUT    | `/{query_id}`             | `edit_query`      |
| POST   | `/{query_id}/archive`     | `archive_query`   |
| POST   | `/{query_id}/unarchive`   | `unarchive_query` |
| POST   | `/query`                  | `query_queries`   |

### 4.2 Query Variants

Base prefix: `/api/queries/variants`

| Method | Path                              | Operation ID              |
|--------|-----------------------------------|---------------------------|
| POST   | `/`                               | `create_query_variant`    |
| GET    | `/{query_variant_id}`             | `fetch_query_variant`     |
| PUT    | `/{query_variant_id}`             | `edit_query_variant`      |
| POST   | `/{query_variant_id}/archive`     | `archive_query_variant`   |
| POST   | `/{query_variant_id}/unarchive`   | `unarchive_query_variant` |
| POST   | `/query`                          | `query_query_variants`    |

### 4.3 Query Revisions

Base prefix: `/api/queries/revisions`

| Method | Path                               | Operation ID               |
|--------|------------------------------------|----------------------------|
| POST   | `/`                                | `create_query_revision`    |
| GET    | `/{query_revision_id}`             | `fetch_query_revision`     |
| PUT    | `/{query_revision_id}`             | `edit_query_revision`      |
| POST   | `/{query_revision_id}/archive`     | `archive_query_revision`   |
| POST   | `/{query_revision_id}/unarchive`   | `unarchive_query_revision` |
| POST   | `/query`                           | `query_query_revisions`    |
| POST   | `/commit`                          | `commit_query_revision`    |
| POST   | `/retrieve`                        | `retrieve_query_revision`  |
| POST   | `/log`                             | `log_query_revisions`      |

------------------------------------------------------------------------

## 5. (Simple) Queries

Base prefix: `/api/simple/queries`

| Method | Path                      | Operation ID             |
|--------|---------------------------|--------------------------|
| POST   | `/`                       | `create_simple_query`    |
| GET    | `/{query_id}`             | `fetch_simple_query`     |
| PUT    | `/{query_id}`             | `edit_simple_query`      |
| POST   | `/{query_id}/archive`     | `archive_simple_query`   |
| POST   | `/{query_id}/unarchive`   | `unarchive_simple_query` |
| POST   | `/query`                  | `query_simple_queries`   |

------------------------------------------------------------------------

## 6. Traces

### 6.1 Traces

Base prefix: `/api/traces`

| Method | Path           | Operation ID    |
|--------|----------------|-----------------|
| POST   | `/ingest`      | `ingest_traces` |
| POST   | `/`            | `create_trace`  |
| GET    | `/{trace_id}`  | `fetch_trace`   |
| GET    | `/?trace_id=...&trace_ids=...` | `fetch_traces`  |
| POST   | `/query`       | `query_traces`  |

### 6.2 Spans

Base prefix: `/api/spans`

| Method | Path                     | Operation ID    |
|--------|--------------------------|-----------------|
| POST   | `/ingest`                | `ingest_spans`  |
| POST   | `/`                      | `create_span`   |
| GET    | `/{trace_id}/{span_id}`  | `fetch_span`    |
| GET    | `/?trace_id=...&trace_ids=...&span_id=...&span_ids=...` | `fetch_spans`   |
| POST   | `/query`                 | `query_spans`   |

### 6.3 OTLP

Base prefix: `/api/otlp/v1`

| Method | Path       | Operation ID   |
|--------|------------|----------------|
| GET    | `/traces`  | `otlp_status`  |
| POST   | `/traces`  | `otlp_ingest`  |
