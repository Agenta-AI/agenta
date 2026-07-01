# session_streams tags/flags schema drift

Date: 2026-07-02

A migration was edited in place after it had already been applied. The `session_streams`
table on any pre-existing database is now out of sync with the code that reads it. The UI
streaming path returns HTTP 500. Batch invoke is unaffected.

This note records the exact mismatch and the recommended fix.

## Symptom

- The UI streaming path 500s. It surfaces as `sign HTTP 500` in the session sign/stream flow.
- Batch invoke (`/invoke`, non-streaming) works fine. It never touches `session_streams`.
- The database itself is healthy. Alembic reports the heads as up to date. Nothing looks
  wrong until a request tries to read a stream row.

The Postgres error underneath the 500 is `column session_streams.tags does not exist` (and,
on the same table, `column session_streams.meta does not exist`).

## The mismatch: code reads columns the table does not have

The ORM and the mapping layer read `tags` and `meta`. A pre-existing table only has `flags`.

Code side (expects `flags`, `tags`, `meta`):

- `api/oss/src/dbs/postgres/sessions/streams/dbes.py:21-28` — `SessionStreamDBE` mixes in
  `FlagsDBA`, `TagsDBA`, and `MetaDBA`, so the model declares `flags`, `tags`, and `meta`
  columns.
- `api/oss/src/dbs/postgres/sessions/streams/dao.py:58` and `:76` — every read runs
  `select(SessionStreamDBE)`. SQLAlchemy expands that to a `SELECT` that names every mapped
  column, including `tags` and `meta`. If either column is missing, the whole query fails.
- `api/oss/src/dbs/postgres/sessions/streams/mappings.py:24,48` and `:62-63` — the create,
  read, and edit mappings all touch `stream_dbe.tags`. Lines `:25,49,64-65` do the same for
  `stream_dbe.meta`.

Table side (a stale database only has `flags`):

- `api/oss/databases/postgres/migrations/core_oss/versions/oss000000008_add_session_streams.py`
  is revision `oss000000008`. As it reads today, `upgrade()` creates `flags` (lines 28-32),
  `tags` (lines 33-37), and `meta` (lines 38-42), plus a GIN index
  `ix_session_streams_flags` on `flags` (lines 76-81).
- A fresh database that runs this file today gets `tags` and `meta`, so it works.
- A database that ran `oss000000008` before the file was edited does not have `tags` or
  `meta`. Alembic already marked `oss000000008` as applied, so it never re-runs the edited
  version. The old columns stay.

## Why it happened: an in-place edit of an applied migration

The migration was rewritten after it had shipped and been applied.

Commit `22d843c0ae` (`[chore] Clean up platform for big-agents Part II`) edited
`oss000000008_add_session_streams.py` in place. It renamed the original `status` JSONB column
to `tags`, added a `meta` JSON column, and added a new `status` VARCHAR column. The revision
was first created and applied earlier, by `a9dcfac55c`
(`feat(sessions): correct the streams backend`).

Alembic tracks migrations by revision id, not by file content. Once `oss000000008` is in a
database's `alembic_version` history, editing the file does not change that database. Fresh
databases build the new shape; existing databases keep the old shape. That split is the drift.

This is why the earlier repair pass flagged it as a runtime concern rather than a migration
blocker. The migration graph applies cleanly end to end. The damage only shows up at query
time on databases that were created between the two commits.

## Recommended fix: a reconciling forward migration

Add a new forward migration (for example `oss000000009`, `down_revision = oss000000008`) that
brings every existing database up to the shape the code expects. Make it idempotent so it is a
no-op on fresh databases that already got the columns from the edited `oss000000008`:

- `ALTER TABLE session_streams ADD COLUMN IF NOT EXISTS tags JSONB`
- `ALTER TABLE session_streams ADD COLUMN IF NOT EXISTS meta JSON`

`ADD COLUMN IF NOT EXISTS` is safe on both paths. A stale database gains the two columns. A
fresh database already has them, so the statement does nothing. No data is lost either way.

The orphaned `status` column does not need fixing. The current `SessionStreamDBE` declares no
`status` attribute, so no code reads it. On a stale database it stays as a dead JSONB column,
and on a fresh one it is a dead VARCHAR column. Either is harmless.

### Alternative: align the code to the table

Dropping `tags` and `meta` from `SessionStreamDBE` and the mappings would also stop the 500.
We do not recommend it. `tags` and `meta` are first-class fields on the `SessionStream` DTO,
and the streams service already writes them. Removing them would lose real functionality to
work around a migration bug.

## Guardrail for next time

Never edit a migration that may already be applied anywhere. Add a new revision instead. An
in-place edit only reshapes fresh databases and silently diverges every existing one, which is
exactly this failure.
