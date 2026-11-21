# Tasks — Storage Mounts

> Ordered, design-first. No implementation until [specs.md](./specs.md) open questions are
> resolved. `[ ]` = not started.

## 0. Decided / blockers

- [x] **`read_only` deferred** — not v1; later a `flags` boolean with external mounts.
- [x] Backend = Agenta-managed via **env vars** (SeaweedFS dev / S3 platform), not a row field;
      `is_external` + per-row creds/url deferred.
- [x] `data` carries `bucket`/`prefix`; identity+scope+lifecycle top-level.
- [x] **`session_id` = bare column, NOT an FK** (external sessions; no `sessions` table).
- [ ] Eager vs lazy provisioning. Lean: lazy.

## 1. Domain skeleton (new top-level domain)

- [ ] `api/oss/src/core/mounts/dtos.py` — `Mount`, `MountCreate`, `MountEdit`, `MountQuery`,
      and a `MountData` body. Reuse shared DTO mixins (`Identifier, Slug, Header, Lifecycle,
      Flags`) + `session_id` top-level + `data: MountData`. **No `status` field** (use
      lifecycle + flags).
- [ ] `api/oss/src/core/mounts/types.py` — domain exceptions
      (`MountNotFound`, `MountSlugConflict`, `MountImmutableField`, `MountReadOnly`).
- [ ] `api/oss/src/core/mounts/interfaces.py` — `MountsDAOInterface`.
- [ ] `api/oss/src/core/mounts/service.py` — create / edit (editable fields only) / query /
      archive / unarchive; enforce immutability of `slug`, `session_id`, `data.bucket`,
      `data.prefix`.

## 2. Persistence (core DB — mounts are config, not append-only)

- [ ] `api/oss/src/dbs/postgres/mounts/dbes.py` — `MountDBE` composing
      `IdentifierDBA, SlugDBA, HeaderDBA, ProjectScopeDBA, LifecycleDBA, FlagsDBA, DataDBA`
      + a `session_id` column (nullable). **No `StatusDBA`.**
- [ ] `api/oss/src/dbs/postgres/mounts/mappings.py` — DTO ↔ DBE (`bucket`/`prefix` ride `data`).
- [ ] `api/oss/src/dbs/postgres/mounts/dao.py` — CRUD + query; `project_id` enforced on
      every read/write; unique `(project_id, slug)`; index on `(project_id, session_id)`.
- [ ] Alembic migration for the `mounts` table.

## 3. API layer

- [ ] `api/oss/src/apis/fastapi/mounts/models.py` — request/response models, `count` + item
      envelope, explicit `operation_id`s.
- [ ] `api/oss/src/apis/fastapi/mounts/router.py` — `POST /mounts`, `POST /mounts/query`,
      `GET /mounts/{id}`, `PUT /mounts/{id}`, archive/unarchive; `@intercept_exceptions()`.
- [ ] `api/oss/src/apis/fastapi/mounts/utils.py` — query param + body merge.
- [ ] `POST /sessions/mounts/query` — session-filtered view (same domain, `sessions`
      namespace; NOT `/sessions/{id}/mounts`), for a
      consistent `/sessions/...` surface alongside transcripts + states.
- [ ] Mount the router in `api/entrypoints/routers.py`.
- [ ] **Path-injection guard (SEC-8, sharpest case)**: validate `bucket`/`prefix` shape at
      create AND re-assert at mount time (no `..`/absolute/charset — like `folders`
      `fullmatch(r"[\w -]+", …)`); **hash any id used in a path** (deterministic compact
      large-base digest of `session_id`/mount id) before it becomes a path segment, since
      `session_id` may be external.
- [ ] Ownership / id validation on every route (audit SEC-8: validate the id shape; enforce
      project scope so a mount can't be read/bound cross-tenant).

## 4. Store-side file ops (durable contents, sandbox-independent)

- [ ] `GET /mounts/{id}/files` (list) and `?read=<path>` (read) — S3/SeaweedFS via aioboto3
      (PoC `/sessions/{id}/files`).
- [ ] `DELETE /mounts/{id}/files?path=<p>` — delete file/prefix.
- [ ] Backend abstraction so `seaweedfs` now / `s3` later is a config switch, not a fork.

## 5. Runner integration seam (reference only — wiring is a follow-up)

- [ ] Define the run-time payload the service hands the runner per mount:
      `{bucket, prefix}` + the Agenta-managed endpoint/creds resolved from env
      vars (not from the row). External mounts (own url/creds) are out of scope.
- [ ] Note the runner responsibilities (FUSE mount before harness start, flush on turn end,
      unmount on teardown) — port the PoC `withGeesefs` / `geesefsScript` / `flushMount`.
      Lands in the runner worktree(s), not here.

## 6. Tests

- [ ] Unit: service immutability rules (reject `session_id`/`slug`/`bucket`/`prefix` edits);
      path-shape validation rejects `..`/absolute; id-hashing is deterministic.
- [ ] Integration: DAO against Postgres (tenant scope, slug uniqueness).
- [ ] Acceptance: create → query (by session_id) → file list/read/delete → archive, in both
      editions (ungated endpoint → OSS basic account + EE inline accounts).

## Out of scope (this worktree)

- Real S3 backend (platform PR).
- The combined "session overlay" endpoint (mounts + transcript + state) — sessions-persistence.
- Multi-mount-per-run orchestration in the runner — runner-scalability / follow-up.
