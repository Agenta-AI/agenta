# M4a `remove-workspaces-org-storage` (mount part): interfaces

Status: proposed, round 2 (after the Codex review of round 1). Code read at `42ffe80bfe`; the lane base is `release/v0.122.11` (`f8e8fca4da`). Paths are relative to `api/` unless they start with `services/`, `web/`, `hosting/` or `docs/`. NEW marks a new file or symbol. Normative rules: `docs/design/sharing-program/CONTRACT.md` sections 9, 12 and 14.

Scope. M4a makes every mount row store its object-key prefix and makes all code read it. New mounts still get the project layout in M4a. The organization layout for new mounts, the per-mount predicate and the removal of the compatibility trigger ship one release later, in the M4b mount step (technical design section 3.5). M4b's workspace removal is not in scope. M4a has no implementation or release dependency and runs in parallel with M1 to M3.

Why the split. The owner rule is no downtime. Pods of the release before M4a compute every key from `project_id`. If M4a wrote the organization layout, those pods would read and write a different path for new mounts during the rolling deploy, and the two file trees would diverge. With the split, every row uses the project layout while old pods exist, and every pod agrees on every path. When the M4b mount step starts writing the organization layout, every pod already reads the stored prefix.

Owner rules applied: one release; no downtime; a clean one-time migration; old mounts keep their path; no copy and no repair; no long-lived compatibility code; no extra read on the request path.

## 1. Data

### 1.1 Table changes

| Table | Change |
| --- | --- |
| `mounts` | NEW column `storage_prefix VARCHAR NOT NULL`. Namespace-relative, no leading or trailing slash. Every row after M4a: `mounts/<project_id>/<mount_id>`. Written once, in the insert. Never updated, also not when `project_id` changes. No index (never a filter). |
| `mounts` | NEW `BEFORE INSERT` row trigger `trg_mounts_fill_legacy_storage_prefix`, `WHEN (NEW.storage_prefix IS NULL)`, function `mounts_fill_legacy_storage_prefix()`. It writes the project layout for inserts from pods of the previous release, which do not know the column. M4a code always writes the column, so the guard is false for it. The M4b mount step drops both. |
| All other tables | No change. |

### 1.2 Alembic revision (chain `core_oss`, both editions run it)

Revision id `oss000000050` (central allocation: M1 044 and 045, M2 046 and 047, M3 048 and 049, M4a 050). `down_revision` is the head of the integration target (`release/v0.122.11` in the GitButler workspace) at the time of merge; technical design section 3.3 gives the check.

| Revision (NEW) | `upgrade()`, in this order, in the hook transaction | `downgrade()` | Migration gate |
| --- | --- | --- | --- |
| `oss000000050_add_mounts_storage_prefix` | 1. `SET LOCAL lock_timeout = '5s'`. 2. `op.add_column("mounts", sa.Column("storage_prefix", sa.String(), nullable=True))`. 3. `_CREATE_FILL_FUNCTION_SQL`. 4. `_CREATE_FILL_TRIGGER_SQL`. 5. `_BACKFILL_STORAGE_PREFIX_SQL`. 6. `op.alter_column("mounts", "storage_prefix", nullable=False)`. | Drop the trigger, the function and the column. Safe in M4a: every row has the project layout, which the previous code computes. | Fails on step 6 (tightening to `nullable=False` with no `server_default`). Needs the `migration:destructive-approved` label (CONTRACT 12). |

Exact SQL (module-level constants, so tests can load them):

```sql
-- _CREATE_FILL_FUNCTION_SQL
CREATE OR REPLACE FUNCTION mounts_fill_legacy_storage_prefix() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.storage_prefix := 'mounts/' || NEW.project_id::text || '/' || NEW.id::text;
    RETURN NEW;
END;
$$;

-- _CREATE_FILL_TRIGGER_SQL
CREATE TRIGGER trg_mounts_fill_legacy_storage_prefix
BEFORE INSERT ON mounts
FOR EACH ROW
WHEN (NEW.storage_prefix IS NULL)
EXECUTE FUNCTION mounts_fill_legacy_storage_prefix();

-- _BACKFILL_STORAGE_PREFIX_SQL
UPDATE mounts
SET storage_prefix = 'mounts/' || project_id::text || '/' || id::text
WHERE storage_prefix IS NULL;
```

- `uuid::text` renders the lowercase hyphenated form, which is what `f"{uuid}"` renders in Python today.
- The backfill is one statement. The plan measures the revision's duration on a seeded table before the PR opens; the sizing evidence is kept outside the repository.
- `lock_timeout`: if the `ADD COLUMN` lock is not granted in 5 seconds, the revision fails, the hook fails, no new pod starts, and the old pods keep serving. The deploy is retried. Nothing is half applied, because the whole revision is one transaction.

### 1.3 Mixed-version behavior (one release, no downtime)

The Helm pre-upgrade hook runs the revision before any new pod starts. The API runs two replicas with `maxUnavailable=0`, so previous-release pods serve on the new schema during the rollout. Docker-compose runs one API process.

| Case | Behavior |
| --- | --- |
| Previous-release pod inserts a mount (`session.add` or the upsert) | No `storage_prefix` in the statement. The trigger writes `mounts/<project_id>/<mount_id>`, which is the key that pod computes. |
| Previous-release pod re-binds an existing mount (`ON CONFLICT DO UPDATE`) | Postgres checks NOT NULL on the proposed row before the conflict check, so without the trigger every re-bind on that pod fails (checked on Postgres 17 with a temporary table, 2026-10-22). The trigger fills the proposed row; the existing row and its prefix win. |
| Previous-release pod reads any mount | It computes `mounts/<project_id>/<mount_id>`, which equals every stored prefix. |
| M4a pod inserts or reads any mount | It writes and reads the stored prefix, which is the project layout. |
| Rollback of the application to the previous release | Every row has the project layout. The old code is correct on every row. The trigger keeps its inserts valid. |

There is no window in which two pods disagree on a path, so there is no repair procedure.

## 2. Core types

### 2.1 `oss/src/core/mounts/types.py` (MODIFIED)

The layout vocabulary goes here, next to the protected-mount vocabulary: the migration and the DAO write it, and both must agree with one definition.

```python
MOUNTS_KEY_ROOT = "mounts"                               # NEW


def project_storage_prefix(                              # NEW
    *,
    project_id: UUID,
    mount_id: UUID,
) -> str:
    """`mounts/<project_id>/<mount_id>`: namespace-relative, no trailing slash."""
```

The M4b mount step adds `organization_storage_prefix` here and `is_organization_keyed` in `service.py` (technical design section 3.5). M4a adds neither: nothing in M4a calls them.

### 2.2 `oss/src/core/mounts/dtos.py` (MODIFIED)

```python
class Mount(Identifier, Slug, Header, Lifecycle):
    project_id: UUID
    # Namespace-relative object-key prefix, written once at insert. Internal: not serialized.
    storage_prefix: str = Field(exclude=True)            # NEW
    session_id: Optional[str] = None
    ...                                                  # unchanged
```

- `exclude=True` keeps the field out of `model_dump()` and out of the generated OpenAPI schema of every response that embeds `Mount` or `SessionMount`. No API change. No Fern regeneration. An acceptance test checks the generated OSS and EE schemas and the JSON responses (technical design 4.3).
- The field is required. A `Mount` built without it fails loudly.
- `MountCreate`, `MountEdit`, `MountQuery`: unchanged. A caller cannot set the prefix.
- `MountData` comment: "The storage location is the row's `storage_prefix`, written by the server." The class stays empty.
- `MountCredentials` docstring and `prefix` comment: "scoped to `[<namespace>/]<storage_prefix>/*`". Fields unchanged. The OpenAPI description text of `MountCredentials` changes; the next Fern regeneration (M1, M2 and M3 each regenerate) carries it.

### 2.3 `oss/src/core/sessions/mounts/dtos.py`

No change. `SessionMount(Mount)` inherits the field.

## 3. Core interfaces

### 3.1 `oss/src/core/mounts/interfaces.py` (MODIFIED, docstrings only)

`MountsDAOInterface.create_mount` and `upsert_mount` keep their signatures. Their docstrings state: a new row stores the prefix the DAO writes (in M4a, `project_storage_prefix(project_id=..., mount_id=<new id>)`); on the upsert conflict path, the existing row and its prefix win.

### 3.2 `oss/src/core/mounts/service.py` (MODIFIED)

```python
class MountsService:
    def _storage_key(self, *, mount: Mount, path: str = "") -> str:              # CHANGED: no project_id
        """[<namespace>/]<mount.storage_prefix>/<path>; with no path, the prefix and one trailing slash.
        The only place that builds a mount key."""
```

- Output for every M4a row is byte-identical to today's output.
- Every caller inside `service.py` drops its `project_id=` argument; all call sites are in this file. This covers every file operation, `sign_mount_credentials`, `materialize_entries_if_absent`, the attachment originals and `delete_session_mounts` (teardown).
- `sign_mount_credentials` keeps `prefix = self._storage_key(mount=mount).rstrip("/")`, so the STS policy covers exactly `[<namespace>/]<storage_prefix>/*` (CONTRACT 9). `core/store/storage.py` does not change.
- Public `MountsService` signatures: unchanged. No router, handler or worker change.

### 3.3 `oss/src/core/sessions/mounts/service.py` (MODIFIED)

`SessionMount(**mount.model_dump())` loses the excluded field. Replace it with `SessionMount(**mount.model_dump(), storage_prefix=mount.storage_prefix)`. This is the only `Mount` dump-and-rebuild in `oss/src` and `ee/src`.

## 4. DB layer

### 4.1 `oss/src/dbs/postgres/mounts/dbas.py` (MODIFIED)

```python
storage_prefix = Column(String, nullable=False)          # NEW, on MountDBA
```

### 4.2 `oss/src/dbs/postgres/mounts/dao.py` (MODIFIED)

- `create_mount` and `upsert_mount` mint `mount_id = uuid_utils.uuid7()` (the upsert mint moves here from the mapping) and pass `mount_id` and `storage_prefix=project_storage_prefix(project_id=project_id, mount_id=mount_id)` to the mappings.
- `on_conflict_do_update(set_=...)` does not list `storage_prefix`, so the existing row keeps its prefix; `.returning(MountDBE)` returns it.
- Readers: unchanged. The column is in the row they already read.

### 4.3 `oss/src/dbs/postgres/mounts/mappings.py` (MODIFIED)

```python
def map_mount_dto_to_dbe_upsert(*, project_id: UUID, user_id: UUID, now: datetime,
                                mount_id: UUID,          # NEW, no uuid7 inside
                                storage_prefix: str,     # NEW (M4b widens it to Union[str, ColumnElement[str]])
                                mount_create: MountCreate) -> Dict[str, Any]: ...

def map_mount_dto_to_dbe_create(*, project_id: UUID, user_id: UUID,
                                mount_id: UUID,          # NEW, sets MountDBE.id
                                storage_prefix: str,     # NEW (M4b widens it to Union[str, ColumnElement[str]])
                                mount_create: MountCreate) -> MountDBE: ...

def map_mount_dbe_to_dto(*, mount_dbe: MountDBE) -> Mount: ...   # sets storage_prefix
```

`map_mount_dto_to_dbe_edit`: unchanged. An edit never touches the prefix.

## 5. API surface

No route, model or OpenAPI property change (section 2.2). No Fern regeneration.

## 6. Runner and SDK surface

No change in M4a or in the M4b mount step. The runner reads `credentials.prefix` from the sign responses and treats it as opaque (`services/runner/src/engines/sandbox_agent/environment-setup.ts:144`, `mount.ts:266`). The in-process sweep walks `<root>/mounts/<scope>/<name>` two levels deep (`engines/inprocess/workspace/transcript-store.ts:41`). The web path parser takes the two segments after `mounts` without reading them (`web/packages/agenta-entities/src/session/core/fileActivity.ts:131`). Only comments that say `<project_id>/<mount_id>` change.

## 7. Latency

| Path | Postgres statements before | After |
| --- | --- | --- |
| `POST /sessions/mounts/sign`, `POST /mounts/agents/sign` (upsert on every turn, insert path and conflict path) | 1 upsert | 1 upsert |
| `POST /mounts/` (`create_mount`) | INSERT + refresh SELECT | same |
| Every file operation (`_resolve_mount`) | 1 | 1 |

No new round trip, no new cache, no Redis read. A Postgres test pins both upsert paths at one statement after a warm-up call (technical design 4.2).

## 8. Errors

No new exception.
