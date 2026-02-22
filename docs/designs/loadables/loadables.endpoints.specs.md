# Loadables — Endpoint Specifications

------------------------------------------------------------------------

## 1. Testsets

Base prefix: `/api/preview/testsets`

### 1.1 Testsets (Artifact)

| Method | Path                       | Operation ID           |
|--------|----------------------------|------------------------|
| POST   | `/`                        | `create_testset`       |
| GET    | `/{testset_id}`            | `fetch_testset`        |
| PUT    | `/{testset_id}`            | `edit_testset`         |
| POST   | `/{testset_id}/archive`    | `archive_testset`      |
| POST   | `/{testset_id}/unarchive`  | `unarchive_testset`    |
| POST   | `/query`                   | `query_testsets`       |

### 1.2 Testset Variants

| Method | Path                                       | Operation ID                |
|--------|--------------------------------------------|-----------------------------|
| POST   | `/variants/`                               | `create_testset_variant`    |
| GET    | `/variants/{testset_variant_id}`           | `fetch_testset_variant`     |
| PUT    | `/variants/{testset_variant_id}`           | `edit_testset_variant`      |
| POST   | `/variants/{testset_variant_id}/archive`   | `archive_testset_variant`   |
| POST   | `/variants/{testset_variant_id}/unarchive` | `unarchive_testset_variant` |
| POST   | `/variants/query`                          | `query_testset_variants`    |

### 1.3 Testset Revisions

| Method | Path                                         | Operation ID                        |
|--------|----------------------------------------------|-------------------------------------|
| POST   | `/revisions/`                                | `create_testset_revision`           |
| GET    | `/revisions/{testset_revision_id}`           | `fetch_testset_revision`            |
| PUT    | `/revisions/{testset_revision_id}`           | `edit_testset_revision`             |
| POST   | `/revisions/{testset_revision_id}/archive`   | `archive_testset_revision`          |
| POST   | `/revisions/{testset_revision_id}/unarchive` | `unarchive_testset_revision`        |
| POST   | `/revisions/{testset_revision_id}/download`  | `fetch_testset_revision_to_file`    |
| POST   | `/revisions/{testset_revision_id}/upload`    | `create_testset_revision_from_file` |
| POST   | `/revisions/query`                           | `query_testset_revisions`           |
| POST   | `/revisions/commit`                          | `commit_testset_revision`           |
| POST   | `/revisions/retrieve`                        | `retrieve_testset_revision`         |
| POST   | `/revisions/log`                             | `log_testset_revisions`             |

------------------------------------------------------------------------

## 2. (Simple) Testsets

Base prefix: `/api/preview/simple/testsets`

> Simplified API — wraps the artifact/variant/revision stack into a
> single object. Intended for legacy and external integrations.

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

Base prefix: `/api/preview/testcases`

| Method | Path             | Operation ID      |
|--------|------------------|-------------------|
| GET    | `/`              | `fetch_testcases` |
| GET    | `/{testcase_id}` | `fetch_testcase`  |
| POST   | `/query`         | `query_testcases` |
