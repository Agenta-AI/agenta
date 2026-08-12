# WP1 — Gateway domain and storage

Delivers the storage stack for custom endpoints on both gateways: the three abstract
mixins, the three concrete tables, the two DAO implementations (three interfaces —
`LlmEndpointsDAOInterface`, `McpEndpointsDAOInterface`, `McpGrantsDAOInterface`), the
DBE↔DTO mappings, and the one migration that creates all three tables. Standard and
builtin endpoints are generated and store nothing (D20) — there is no row, no DAO method,
and no namespace parameter anywhere in this package's surface, because every row this
package persists is a `custom` row by construction (`entities.md` §2.3, §7).

This package does not touch `core/gateways/` at all. The DAO interfaces it implements
(`LlmEndpointsDAOInterface`, `McpEndpointsDAOInterface`, `McpGrantsDAOInterface`) live in
`core/gateways/{llms,mcps}/interfaces.py`, which the seed commit already declares
verbatim from `entities.md` §7 — WP1 imports and implements them, never edits them.

## What this is NOT

- The namespace merge (`list_endpoints` composing generated + custom rows), `catalog.py`,
  and everything that reads `provider_key`/`slug` existence to decide whether a builtin
  endpoint exists — **WP7** (LLM) and **WP9** (MCP), against `core/gateways/{llms,mcps}/service.py`.
- The south port (`LlmUpstreamInterface`, `McpUpstreamInterface`, the registries, the
  `providers/` adapters) — seed declares the interfaces, **WP6/WP7/WP8/WP9** implement
  registries and adapters. WP1 never imports or references them.
- `core/gateways/policy/resolution.py` (**WP2**) and `core/gateways/policy/service.py`
  (**WP3**) — WP1's tables are consumed by both, through the DAO interfaces only.
- Routers, wire models, and the endpoint CRUD API surface — **WP10**
  (`apis/fastapi/gateways/{llms,mcps}/{router,models}.py`).
- The two OAuth secret kinds (`oauth_provider`, `oauth_grant` — WP16) and the OAuth client
  (WP17) that eventually populates `mcp_gateway_grants` for real. WP1 builds the table and
  the DAO only; nothing in this package issues an OAuth token.

## Files

New, and owned by no other package (`workstreams/README.md` file-ownership table):

- `api/oss/src/dbs/postgres/gateways/llms/dbas.py` — `LlmEndpointDBA`
- `api/oss/src/dbs/postgres/gateways/llms/dbes.py` — `LlmEndpointDBE`
- `api/oss/src/dbs/postgres/gateways/llms/dao.py` — `LlmEndpointsDAO`
- `api/oss/src/dbs/postgres/gateways/llms/mappings.py`
- `api/oss/src/dbs/postgres/gateways/mcps/dbas.py` — `McpEndpointDBA`, `McpGrantDBA`
- `api/oss/src/dbs/postgres/gateways/mcps/dbes.py` — `McpEndpointDBE`, `McpGrantDBE`
- `api/oss/src/dbs/postgres/gateways/mcps/dao.py` — `McpEndpointsDAO`, `McpGrantsDAO`
- `api/oss/src/dbs/postgres/gateways/mcps/mappings.py`
- `api/oss/databases/postgres/migrations/core_oss/versions/oss0000000NN_add_gateway_endpoints.py`
  — the one migration; creates all three tables in one revision.

Edited: none outside the above. WP1 adds three lines to `api/entrypoints/routers.py` as a
diff applied at the M1 merge (below) — it does not commit that file directly.

**Verify the migration head before branching.** `workstreams/README.md` records
`release/v0.112.0` at `park00000000` as the observed head at prep time and warns both
advance. In this tree, at the time this spec was written, `core_oss`'s actual head is
`oss000000020_add_session_attachments.py` (`down_revision = "oss000000019"`) —
`park00000000` belongs to the unrelated `tracing` chain. Run
`ls api/oss/databases/postgres/migrations/core_oss/versions/ | tail -3` immediately
before writing the migration file and set `down_revision` to whatever is actually latest;
do not trust either number above without re-checking.

## Interfaces (reproduce verbatim, seed-owned — do not edit the source files)

From `core/gateways/llms/interfaces.py` (`entities.md` §7):

```python
class LlmEndpointsDAOInterface(ABC):
    @abstractmethod
    async def create_endpoint(
        self, *, project_id: UUID, user_id: UUID, #
        endpoint: LlmEndpointCreate,
    ) -> Optional[LlmEndpoint]:
        """Insert. Raises EntityCreationConflict on a slug collision."""

    @abstractmethod
    async def fetch_endpoint(
        self, *, project_id: UUID, #
        endpoint_id: UUID,
    ) -> Optional[LlmEndpoint]: ...

    @abstractmethod
    async def fetch_endpoint_by_slug(
        self, *, project_id: UUID, #
        slug: str,
    ) -> Optional[LlmEndpoint]:
        """The data-plane route lookup. Backed by
        uq_llm_gateway_endpoints_project_slug — at most one row by
        construction. None means the custom namespace has no such name."""

    @abstractmethod
    async def edit_endpoint(
        self, *, project_id: UUID, user_id: UUID, #
        endpoint: LlmEndpointEdit,
    ) -> Optional[LlmEndpoint]:
        """Full PUT over data, flags, header, secret_id. provider_key and
        deployment are absent from LlmEndpointEdit and therefore untouchable."""

    @abstractmethod
    async def delete_endpoint(
        self, *, project_id: UUID, #
        endpoint_id: UUID,
    ) -> bool: ...

    @abstractmethod
    async def query_endpoints(
        self, *, project_id: UUID, #
        endpoint: Optional[LlmEndpointQuery] = None, #
        windowing: Optional[Windowing] = None,
    ) -> List[LlmEndpoint]: ...
```

From `core/gateways/mcps/interfaces.py` — `McpEndpointsDAOInterface` has the identical
six verbs over `mcp_gateway_endpoints` (same signatures, `LlmEndpoint*` → `McpEndpoint*`).

`McpGrantsDAOInterface`:

```python
class McpGrantsDAOInterface(ABC):
    @abstractmethod
    async def create_grant(
        self, *, project_id: UUID, user_id: Optional[UUID], #
        grant: McpGrantCreate,
    ) -> Optional[McpGrant]:
        """Insert, idempotent on the owner: ON CONFLICT DO NOTHING ...
        RETURNING, falling back to a fetch — a re-entered OAuth callback
        returns the EXISTING row rather than None. user_id here is the OWNER
        (grant.user_id mirrors it); authorship lands in created_by_id from the
        same value when present."""

    @abstractmethod
    async def fetch_grant(
        self, *, project_id: UUID, #
        endpoint_id: UUID, user_id: Optional[UUID],
    ) -> Optional[McpGrant]:
        """THIS owner's grant on THIS endpoint. user_id=None selects the
        project-owned grant — it does not mean "any". No fallback walk here;
        that belongs to the resolver (WP2), which calls this at most twice."""

    @abstractmethod
    async def fetch_grant_by_id(
        self, *, project_id: UUID, #
        grant_id: UUID,
    ) -> Optional[McpGrant]: ...

    @abstractmethod
    async def update_grant(
        self, *, project_id: UUID, #
        grant_id: UUID,
        is_valid: Optional[bool] = None,
        status: Optional[Status] = None,
    ) -> Optional[McpGrant]:
        """Server-set operational state only: flip is_valid, record the
        refresh outcome. Not an edit_grant taking a document — there is no
        grant document to edit, and this update must not be able to move
        endpoint_id, user_id or secret_id."""

    @abstractmethod
    async def delete_grant(
        self, *, project_id: UUID, #
        grant_id: UUID,
    ) -> bool:
        """Row only. The service (WP17/WP18) deletes the vault secret FIRST,
        then this — the CASCADE covers the reverse arrival."""

    @abstractmethod
    async def query_grants(
        self, *, project_id: UUID, #
        grant: Optional[McpGrantQuery] = None, #
        windowing: Optional[Windowing] = None,
    ) -> List[McpGrant]: ...
```

`None` disambiguation (`entities.md` §7, reproduce in the DAO's module docstring):

| method | `None` means | caller does |
| --- | --- | --- |
| `fetch_endpoint_by_slug` | no such custom endpoint | proxy 404s in its own shape |
| `fetch_grant` | this owner has not connected | resolver applies the mode |
| `create_grant` | never — conflict returns the existing row | proceed with the row |
| `edit_endpoint` / `update_grant` | the row does not exist | 404 at the boundary |

## dbas.py — reproduce verbatim from `entities.md` §2

```python
# dbs/postgres/gateways/llms/dbas.py

class LlmEndpointDBA(
    ProjectScopeDBA, IdentifierDBA, SlugDBA, LifecycleDBA,
    HeaderDBA, DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    __abstract__ = True

    provider_key = Column(String, nullable=False)
    deployment = Column(
        SQLEnum(LlmDeploymentKind, name="llmdeploymentkind_enum"), nullable=False
    )
    secret_id = Column(UUID(as_uuid=True), nullable=True)
    # data: { route, model_slugs, config, extras } — LlmEndpointData


# dbs/postgres/gateways/mcps/dbas.py

class McpEndpointDBA(
    ProjectScopeDBA, IdentifierDBA, SlugDBA, LifecycleDBA,
    HeaderDBA, DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    __abstract__ = True

    auth_mode = Column(
        SQLEnum(GatewayAuthScheme, name="gatewayauthscheme_enum"), nullable=False
    )
    secret_id = Column(UUID(as_uuid=True), nullable=True)
    # data: { url, headers, tool_policy, config, oauth } — McpEndpointData


class McpGrantDBA(
    ProjectScopeDBA, IdentifierDBA, LifecycleDBA,
    StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    __abstract__ = True

    endpoint_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=True)
    # NULL = project-owned; a UUID = that member's grant in this project.
    secret_id = Column(UUID(as_uuid=True), nullable=False)
    # No DataDBA, no HeaderDBA, no SlugDBA, no expires_at column — entities.md §2
    # is explicit these are absent. Do not add them.
```

`LlmDeploymentKind` and `GatewayAuthScheme` are seed-owned enums
(`core/gateways/llms/dtos.py`, `core/gateways/dtos.py`) — import, do not redefine.

## dbes.py — reproduce verbatim from `entities.md` §3

```python
class LlmEndpointDBE(Base, LlmEndpointDBA):
    __tablename__ = "llm_gateway_endpoints"
    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="SET NULL"),
        UniqueConstraint("project_id", "slug",
                         name="uq_llm_gateway_endpoints_project_slug"),
        Index("ix_llm_gateway_endpoints_project_provider",
              "project_id", "provider_key"),
        Index("ix_llm_gateway_endpoints_flags", "flags", postgresql_using="gin"),
    )


class McpEndpointDBE(Base, McpEndpointDBA):
    __tablename__ = "mcp_gateway_endpoints"
    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="SET NULL"),
        UniqueConstraint("project_id", "slug",
                         name="uq_mcp_gateway_endpoints_project_slug"),
        Index("ix_mcp_gateway_endpoints_flags", "flags", postgresql_using="gin"),
    )


class McpGrantDBE(Base, McpGrantDBA):
    __tablename__ = "mcp_gateway_grants"
    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="CASCADE"),
        Index("uq_mcp_gateway_grants_user", "project_id", "endpoint_id", "user_id",
              unique=True, postgresql_where=text("user_id IS NOT NULL")),
        Index("uq_mcp_gateway_grants_project", "project_id", "endpoint_id",
              unique=True, postgresql_where=text("user_id IS NULL")),
        Index("ix_mcp_gateway_grants_endpoint", "project_id", "endpoint_id"),
    )
```

The FK ondelete behavior is not symmetric and must not be "fixed" to match: endpoints take
`SET NULL` on `secret_id` (a dead credential must not silently delete configuration),
grants take `CASCADE` (a grant row with no secret means nothing — `entities.md` §2.1).

No unique constraint mentions `url` or `secret_id` anywhere. Two endpoints may point at
one upstream with different tool policies; one secret may back several custom endpoints.

## dao.py

Two files, three classes: `LlmEndpointsDAO` (llms), `McpEndpointsDAO` + `McpGrantsDAO`
(mcps). Each opens its own session through `TransactionsEngine`
(`dbs/postgres/shared/engine.py::get_transactions_engine`) — never receives a shared
session, matching every DAO in the tree.

**Precedent, read before writing:** `api/oss/src/dbs/postgres/gateway/connections/dao.py`
(`ConnectionsDAO`) is the closest sibling — one project-scoped table, a slug-uniqueness
create conflict, flag/data patch updates. Copy its shape:

- `@suppress_exceptions(exclude=[EntityCreationConflict])` on every `create_*` method;
  catch `IntegrityError`, inspect `str(e.orig)` for the unique-constraint name
  (`uq_llm_gateway_endpoints_project_slug`, `uq_mcp_gateway_endpoints_project_slug`), and
  raise `EntityCreationConflict(entity=..., message=..., conflict={"slug": ...})` — else
  re-raise.
- `@suppress_exceptions(default=None)` on `fetch_*`/`edit_*`/`update_grant`,
  `@suppress_exceptions(default=False)` on `delete_*`, `@suppress_exceptions(default=[])`
  on `query_*` — read failures degrade, creates surface the one exception that matters
  (`entities.md` §7 house rule).
- `edit_endpoint` is a full PUT: load the row, overwrite `data`/`flags`/`name`/
  `description`/`secret_id`/`meta` wholesale from the `*Edit` DTO, `flag_modified` on the
  JSON columns exactly as `ConnectionsDAO.update_connection` does, `updated_at =
  datetime.now(timezone.utc)`, `updated_by_id = user_id`. Never a partial merge.
- `create_grant` is the one method with no `ConnectionsDAO` analog. Use SQLAlchemy's
  `insert(...).on_conflict_do_nothing(...).returning(...)` (the Postgres dialect,
  `sqlalchemy.dialects.postgresql.insert`) against the two partial unique indexes; when
  the insert returns nothing, `fetch_grant` the existing row by `(project_id, endpoint_id,
  user_id)` and return that — never `None`. `trigger_subscriptions`' partial-unique-index
  idiom (`dbs/postgres/triggers/dbes.py::ix_trigger_subscriptions_trigger_id`) is the
  precedent for the index shape (not the ON CONFLICT clause, which has no exact sibling
  in this tree yet — this package is the first to need it against a *partial* index; the
  `ON CONFLICT (project_id, endpoint_id) WHERE user_id IS NULL` / `... WHERE user_id IS
  NOT NULL` clause must match the partial index's predicate exactly or Postgres will not
  use it as an arbiter).
- `update_grant` is a targeted `UPDATE ... WHERE (project_id, id) = (...) RETURNING`,
  patching only `flags.is_valid` (via `flag_modified`) and `status` — never touching
  `endpoint_id`, `user_id`, or `secret_id`. No `edit_grant` method exists; do not add one.

## mappings.py

Three functions per entity (`map_X_create_to_dbe`, `map_X_dbe_to_dto`,
`map_X_edit_to_dbe` where an Edit exists — grants have no Edit, see above), following
`dbs/postgres/gateway/connections/mappings.py`'s shape: `data`/`flags` are typed Pydantic
models on the DTO side (`LlmEndpointData`, `LlmEndpointFlags`, etc.) and dumped with
`model_dump(mode="json", exclude_none=True)` going in, reconstructed with
`ModelClass(**dbe.data)` coming out (`dbe.data`/`dbe.flags` are `None`-safe — default to
`{}` before unpacking so a row created before a field existed does not crash the read
path).

`map_llm_endpoint_dbe_to_dto` and `map_mcp_endpoint_dbe_to_dto` set
`namespace=GatewayEndpointNamespace.CUSTOM` unconditionally — every row this package's
DAOs return is a custom row (§1); the generated-entry stamping for `BUILTIN`/`AGENTA`
happens in WP7/WP9's service layer, never here.

## Migration

One revision, creating all three tables with every constraint and index from §3 above.
Column types: `String` stays `String`; `SQLEnum(LlmDeploymentKind, ...)` and
`SQLEnum(GatewayAuthScheme, ...)` become `sa.Enum(..., name="llmdeploymentkind_enum")` /
`sa.Enum(..., name="gatewayauthscheme_enum")` in the migration (the enum name matters —
it is the Postgres type name, and it must match what the DBE declares or SQLAlchemy
creates a second anonymous type on next `create_all`). `JSON(none_as_null=True)` /
`JSONB(none_as_null=True)` map to `sa.JSON()` / `postgresql.JSONB()`. Follow
`oss000000020_add_session_attachments.py`'s structure: one `op.create_table(...)` per
table with inline constraints, then `op.create_index(...)` calls for anything not
inlineable (the two partial-unique grant indexes must be `op.create_index` with
`postgresql_where=sa.text(...)`, since `sa.UniqueConstraint` cannot express a partial
predicate). `downgrade()` drops indexes then tables in reverse dependency order: grants
before endpoints (grants FK-references nothing, but drop it first for symmetry with the
create order), then `mcp_gateway_endpoints`, then `llm_gateway_endpoints`.

## Contracts this package must honour

- **`project_id` first, keyword-only after `*`**, on every DAO method — no exceptions in
  this package (grants' `create_grant` still takes `project_id` first, `user_id` second,
  matching the interface exactly).
- **No `namespace` parameter anywhere.** Every DAO method operates on rows, and every row
  is `custom` (§2.3, D20). A namespace parameter here would silently invite someone to
  bolt generated-entry logic onto the DAO — that logic belongs in WP7/WP9's service.
- **No `UserScopeDBA` on either endpoint table.** Custom endpoints are project
  configuration; `user_id` on endpoint writes is authorship (`created_by_id`/
  `updated_by_id`) only, never a query key. `McpGrantDBA.user_id` is the one place the
  user dimension is a key, and it is nullable by design (§2.5) — do not make it
  `nullable=False`.
- **No lifecycle enum column on any of the three tables.** `ready`/`needs_auth`/
  `needs_input` are derived at read time by WP7/WP9's service, never stored (§2.6). If a
  task here seems to need a state column, that is a sign the task belongs to a different
  package.
- **No `expires_at` column on `McpGrantDBE`.** Refresh is lazy; expiry lives inside the
  encrypted `oauth_grant` payload (§2, `secrets.md`). Do not promote it to a column in
  this package.
- **`secret_id` FK behavior is per-table, not uniform** — `SET NULL` on both endpoint
  tables, `CASCADE` on grants (§2.1 above). Getting these swapped is the single easiest
  way to violate D18 (a dead secret must not delete configuration) without any test
  catching it locally, because both behave identically until a secret is actually deleted
  under a live FK.
- **Verb naming is `create_/fetch_/edit_/delete_/query_`** — the newer house style
  (`core/workflows/`), not `ConnectionsDAO`'s `get_/update_`. Copy `ConnectionsDAO`'s
  *shape* (session handling, suppress_exceptions, flag_modified), not its verb names.

## Tests

**Unit (no services running, run now):**

- Every `map_*_dto_to_dbe*` / `map_*_dbe_to_dto` function round-trips a representative
  DTO through DBE construction and back without a database — these are pure Python
  object transforms and need no session. Assert field-for-field equality modulo
  server-assigned fields.
- `LlmEndpointData`/`McpEndpointData`/`McpGrantFlags` etc. (seed DTOs) serialize via
  `model_dump(mode="json", exclude_none=True)` to the shape the mapping functions expect
  — one instantiate-and-dump test per payload type touched by this package's mappings.

**Integration (needs Postgres — write, do not run without a local deployment):**
`api/oss/tests/pytest/integration/gateways/`

- `test_gateways_llm_endpoints_dao.py`: `create_endpoint` → `fetch_endpoint` round-trips
  field-for-field; a second `create_endpoint` with the same `(project_id, slug)` raises
  `EntityCreationConflict`; `edit_endpoint` fully replaces `data`/`flags` (a field omitted
  from the `LlmEndpointEdit.data` passed in is gone after the edit, not preserved —
  confirms this is a PUT, not a PATCH); `delete_endpoint` returns `True` once and `False`
  on a repeat; `query_endpoints` filters by `provider_key`/`deployment`/`slug`.
- `test_gateways_mcp_endpoints_dao.py`: the same six assertions against
  `mcp_gateway_endpoints`.
- `test_gateways_mcp_grants_dao.py`: `create_grant` with `user_id=None` twice returns the
  same row the second time (never a second row, never `None`); `create_grant` with two
  different `user_id`s on the same `endpoint_id` produces two rows; a raw `INSERT`
  bypassing the DAO that violates either partial unique index raises `IntegrityError` at
  the database level (assert the constraint name, not just "it failed"); `fetch_grant`
  with `user_id=None` never returns a row created with a real `user_id`, and vice versa;
  `update_grant` flips `is_valid` and leaves `endpoint_id`/`user_id`/`secret_id`
  unchanged; `delete_grant` then `fetch_grant_by_id` returns `None`.
- `test_gateways_migration.py`: `alembic upgrade head` then `alembic downgrade -1`
  round-trips cleanly against a throwaway database; every constraint and index named in
  §3 above exists after `upgrade` and is gone after `downgrade`; a second `upgrade` after
  `downgrade` also completes (idempotent round-trip).
- FK behavior: deleting a `secrets` row referenced by an endpoint's `secret_id` leaves the
  endpoint row present with `secret_id = NULL`; deleting a `secrets` row referenced by a
  grant's `secret_id` deletes the grant row.

## `api/entrypoints/routers.py` diff (apply at the M1 merge)

WP1 contributes the three DAO constructions; nothing else in this file is WP1's.

```python
from oss.src.dbs.postgres.gateways.llms.dao import LlmEndpointsDAO
from oss.src.dbs.postgres.gateways.mcps.dao import McpEndpointsDAO, McpGrantsDAO

llm_endpoints_dao = LlmEndpointsDAO(engine=_transactions_engine)
mcp_endpoints_dao = McpEndpointsDAO(engine=_transactions_engine)
mcp_grants_dao = McpGrantsDAO(engine=_transactions_engine)
```

(`entities.md` §9's wiring block; WP2/WP3 add the resolver and policy service lines
alongside this at the same merge, WP7/WP9 add the two gateway services after that, WP10
mounts the routers last.)

## Checkpoint

Feeds **M1 (foundation)**, then **Checkpoint A** through WP6/WP7/WP8/WP9/WP10, all of
which depend on this package.

Exit condition, verbatim from `plan.md`: *"a custom endpoint round-trips, and every DAO
verb takes the owner."*

WP1 is done when: the migration applies and downgrades cleanly against a throwaway
database; `create_endpoint` → `fetch_endpoint` round-trips on both planes; a slug
collision on create raises `EntityCreationConflict` and nothing else does;
`create_grant`'s conflict path never returns `None`; and every DAO method in all three
interfaces takes `project_id` first and `user_id` on writes exactly where §7 says it
should — verified by grep, not by memory.

## Out of scope

- `core/gateways/{llms,mcps}/{service,registry,catalog}.py` and `providers/` — WP6, WP7,
  WP8, WP9.
- `core/gateways/policy/*` — WP2, WP3.
- `apis/fastapi/gateways/**` — WP6, WP8, WP10.
- `core/access/permissions/types.py` — WP3.
- Anything under WP16/WP17 (the two OAuth secret kinds, the OAuth client). This package's
  `mcp_gateway_grants` table exists before either lands; it simply has no rows until they
  do.

## Missing from the design, needs a ruling

None found for this package's own surface — every DTO, column, exception and DAO method
this spec references exists in `entities.md` with the signature reproduced above.

One cross-cutting item surfaced while writing this spec, relevant to whoever starts wave
1: the exact `ON CONFLICT` clause for `create_grant` against a *partial* unique index has
no in-tree precedent (`trigger_subscriptions` uses a partial unique index but nothing in
that DAO does `ON CONFLICT` against it — `TriggersDAO.claim_delivery`'s
`on_conflict_do_nothing()` targets a different, non-partial constraint). This is an
implementation detail, not a design gap — SQLAlchemy's `on_conflict_do_nothing(index_where=...)`
covers it — but it is worth a second pair of eyes at review since a mismatched predicate
fails silently (Postgres falls back to a full-table conflict check, which then raises
`IntegrityError` instead of hitting the `DO NOTHING` path).
