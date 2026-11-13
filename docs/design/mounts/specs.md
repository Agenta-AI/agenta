# Mounts — specs

> Status: **draft for discussion**. Distilled from `poc-persistent-sessions`
> (`sessions/demo/`), cleaned up and re-shaped to the real API architecture and the shared
> DBA/DTO mixin conventions. Not implemented.

## Problem

An agent run needs a working directory that **survives the destruction of the sandbox it
ran in**. A sandbox (`local`, `daytona`, `e2b`, …) is ephemeral; its filesystem dies with
it. The PoC proved the fix: mount a durable object-store prefix into the sandbox as the
agent's `cwd`, so the workspace outlives any single run.

Beyond a single run's cwd, the product needs **connectable / shareable storage** (audit
item FUN-2): a project-level workspace several sessions can mount, a read-only reference
dataset. That is a first-class resource, not a per-session implementation detail.

## Core decision: a mount is a top-level resource, not part of sessions

A **Mount** is its own project-scoped domain with endpoints under `/mounts`, its own DBE,
DTO, and service. (Name: **`Mount` / `mounts`** — not "storage mount"; we know what it is.)

- A mount **may** be bound to a session (`session_id` set) → it is that session's durable
  cwd. It **may not** (`session_id` null) → a project-level mount shared across
  sessions/agents.
- Two surfaces, same domain: **`/mounts/`** (standalone — incl. project-level, non-session
  mounts) and **`/sessions/mounts/`** (the session-filtered view under the `sessions`
  namespace, keyed/filtered by `session_id`; NOT `/sessions/{id}/mounts`). Mounts is the one
  facet with a meaningful standalone surface (a mount can have no session).

This separation is the point of this worktree: decouple durable storage from the session
lifecycle.

## Internal (Agenta-managed) now; external later

For now every mount is **Agenta-managed**: the backend (SeaweedFS for local/dev, S3 for the
platform) and its credentials are **Agenta's**, selected by **environment variables**, not
stored per row. The row says *where within our store* (bucket + prefix), not *whose store*.

Later we add **external mounts** (a user's own bucket): an `is_external` flag plus, under
`data`, the `url` / endpoint / credential-reference fields that only external mounts need.
That is explicitly **out of scope** here — but the shape (top-level identity + `data` body)
is chosen so external mounts slot in without reshaping the row.

## Field layout — top-level vs `data` (follow the shared mixins)

The repo's convention (see `git/dtos.py` `Artifact`/`Revision`, `shared/dbas.py`): identity,
scope, header, and lifecycle are **top-level mixins**; the entity-specific body lives in a
**`data` JSON column** (DTO `Data`, DBA `DataDBA`). Mounts follow this exactly.

### Top-level (mixins)

| Field | Source mixin | Notes |
|---|---|---|
| `id` | `Identifier` / `IdentifierDBA` | uuid7 |
| `slug` | `Slug` / `SlugDBA` | stable handle, unique per project, **immutable after create** |
| `name`, `description` | `Header` / `HeaderDBA` | display |
| `project_id` | `ProjectScope` / `ProjectScopeDBA` | tenant scope — enforced every read/write |
| `session_id` | top-level column | **nullable, immutable after create.** Null ⇒ project-shared; set ⇒ bound to that session for life (slug-like) |
| lifecycle | `Lifecycle` / `LifecycleDBA` | `created_at/updated_at/deleted_at` + `*_by_id`; archive over hard-delete |
| `flags` | `Flags` / `FlagsDBA` | small booleans (see below) |

### Under `data` (the body — `Data` / `DataDBA`)

| Field | Notes |
|---|---|
| `bucket` | object-store bucket (within Agenta's store) |
| `prefix` | key prefix = the mount root |

**`read_only` is DEFERRED** — not in v1. It returns later as a boolean in **`flags`**
(alongside the external-mount fields). No v1 consumer needs the shared-writable vs
shared-read-only distinction yet.

### Deliberately deferred (added with external mounts)

`is_external` (flag), and under `data`: `url`/endpoint, credentials reference, region, etc.
None of this exists in v1 because every mount is Agenta-managed via env vars.

### On `status`

We **do not** add a `status` column. The repo's `StatusDBA` is a JSONB state-machine slot;
mounts have no state machine. Lifecycle (`deleted_at`) covers archive/active. If a real
boolean is later needed (e.g. "provisioning"), it goes in `flags`, not a status enum. (This
matches the "flags unless it's genuinely a state machine" rule.)

### Invariants

- **`slug`, `session_id`, `bucket`, `prefix` are write-once.** Edit changes only
  `name`/`description` (and `flags`). Re-pointing a durable directory at a different session
  hands one session's files to another — a data-safety footgun.
- **`kind`/`backend` is not a row field** — it's the Agenta-managed env-var selection
  (SeaweedFS vs S3). It only becomes per-row when `is_external` arrives.

## Endpoints (proposed)

Root domain, house `apis/fastapi/<domain>` conventions:

- `POST /mounts` — create (`slug`, `session_id`, `data.bucket/prefix` fixed here)
- `POST /mounts/query` — filter (by project, `session_id`, …), cursor pagination
- `GET /mounts/{id}` — retrieve
- `PUT /mounts/{id}` — edit editable fields only (`name`, `description`)
- `POST /mounts/{id}/archive` / `unarchive`
- `GET /mounts/{id}/files`, `?read=<path>` — list/read durable contents straight from the
  store (works whether or not a sandbox is up; PoC `/sessions/{id}/files`)
- `DELETE /mounts/{id}/files?path=<p>` — delete file/prefix
- `POST /sessions/mounts/query` — the session-filtered view (same domain, `sessions` namespace)

## Integration seam (runner)

When the service starts a run for a session with a bound mount it hands the runner
`{bucket, prefix}` + the Agenta-managed endpoint/creds (from env); the runner
FUSE-mounts before the harness starts, flushes on turn end, unmounts on teardown (PoC
`withGeesefs` / `geesefsScript` / `flushMount` / `unmount`). This worktree owns the
**resource + API + store-side file ops**; runner wiring is a referenced seam.

## What we drop from the PoC

- Mount implicit in the sidecar → explicit resource.
- `bucket_prefix` derived as `demo/<sid>/` → explicit `data.bucket` + `data.prefix`.
- Hard `DELETE /sessions/{id}` → S3 wipe → archive + explicit file delete.

## Cross-cutting (see interactions/cross-cutting-review.md)

- **C1 — path injection + id hashing (sharpest SEC-8 case of the five).** `prefix`/`bucket`/
  `session_id` flow into a real filesystem/object path on the runner (PoC fed `session_id` into
  the geesefs mountpoint), and `session_id` may be **external** (not minted by us — see
  finding A). So: (a) **validate** `prefix`/`bucket` shape at create AND re-assert at mount time
  (no `..`, no absolute paths, charset/length cap — precedent: `folders` uses
  `fullmatch(r"[\w -]+", …)`); (b) **hash any id used in a path** — deterministic, compact
  large-base encoding (e.g. base32/62 of a digest) of `session_id`/mount id before it becomes a
  path/prefix segment, so an arbitrary external id can't inject and paths stay bounded.
- **A — `session_id` is NOT an FK** (external sessions, like trace/span ids; finding A). Bare
  column; no `sessions` table.

## Decided

- **`read_only` deferred** — not v1; returns as a `flags` boolean with the external-mount work.
- **`session_id` is a bare column, NOT an FK** — sessions may be external (finding A); no
  `sessions` table.
- **The cwd mount = the session-bound mount.** Non-bound / shared project mounts are **NOT
  implemented in v1** (the `session_id`-nullable column already supports them; we just don't
  build the shared flow yet). So v1 = one mount per session, the cwd.
- **Provisioning: create the bucket/prefix at mount-time, once per session** (lazy — no
  pre-provisioning).

## Open questions (for discussion)

None — mounts v1 is fully specced.
