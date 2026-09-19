# WP1 — Gateway domain and storage

Delivers the storage stack for custom endpoints on both gateways: the two abstract
mixins, the two concrete tables, the two DAO implementations (two interfaces —
`LLMEndpointsDAOInterface`, `MCPEndpointsDAOInterface`), the
DBE↔DTO mappings, and the one migration that creates both tables. Standard and
builtin endpoints are generated and store nothing (D20) — there is no row, no DAO method,
and no namespace parameter anywhere in this package's surface, because every row this
package persists is a `custom` row by construction (`entities.md` §2.3, §7).

This package does not touch `core/gateways/` at all. The DAO interfaces it implements
(`LLMEndpointsDAOInterface`, `MCPEndpointsDAOInterface`) live in
`core/gateways/{llms,mcps}/interfaces.py`, which the seed commit already declares
verbatim from `entities.md` §7 — WP1 imports and implements them, never edits them.

## What this is NOT

- The namespace merge (`list_endpoints` composing generated + custom rows), `catalog.py`,
  and everything that reads `provider_key`/`slug` existence to decide whether a builtin
  endpoint exists — **WP7** (LLM) and **WP9** (MCP), against `core/gateways/{llms,mcps}/service.py`.
- The south port (`LLMUpstreamInterface`, `MCPUpstreamInterface`, the registries, the
  `providers/` adapters) — seed declares the interfaces, **WP6/WP7/WP8/WP9** implement
  registries and adapters. WP1 never imports or references them.
- `core/gateways/policy/resolution.py` (**WP2**) and `core/gateways/policy/service.py`
  (**WP3**) — WP1's tables are consumed by both, through the DAO interfaces only.
- Routers, wire models, and the endpoint CRUD API surface — **WP10**
  (`apis/fastapi/gateways/{llms,mcps}/{router,models}.py`).
- The two OAuth secret kinds (`oauth_provider`, `oauth_grant` — WP16) and the OAuth client
  (WP17) that mint the `oauth_grant` secret an MCP endpoint's `secret_id` points at. WP1
  builds the endpoint tables only; nothing in this package issues an OAuth token.

## Files

New, and owned by no other package (`workstreams/README.md` file-ownership table):

- `api/oss/src/dbs/postgres/gateways/llms/dbas.py` — `LLMEndpointDBA`
- `api/oss/src/dbs/postgres/gateways/llms/dbes.py` — `LLMEndpointDBE`
- `api/oss/src/dbs/postgres/gateways/llms/dao.py` — `LLMEndpointsDAO`
- `api/oss/src/dbs/postgres/gateways/llms/mappings.py`
- `api/oss/src/dbs/postgres/gateways/mcps/dbas.py` — `MCPEndpointDBA`
- `api/oss/src/dbs/postgres/gateways/mcps/dbes.py` — `MCPEndpointDBE`
- `api/oss/src/dbs/postgres/gateways/mcps/dao.py` — `MCPEndpointsDAO`
- `api/oss/src/dbs/postgres/gateways/mcps/mappings.py`
- `api/oss/databases/postgres/migrations/core_oss/versions/oss0000000NN_add_gateway_endpoints.py`
  — the one migration; creates both tables in one revision.

Edited: none outside the above. WP1 adds two lines to `api/entrypoints/routers.py` as a
diff applied at the IM1 merge (below) — it does not commit that file directly.

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
class LLMEndpointsDAOInterface(ABC):
    @abstractmethod
    async def create_endpoint(
        self, *, project_id: UUID, user_id: UUID, #
        endpoint: LLMEndpointCreate,
    ) -> Optional[LLMEndpoint]:
        """Insert. Raises EntityCreationConflict on a slug collision."""

    @abstractmethod
    async def fetch_endpoint(
        self, *, project_id: UUID, #
        endpoint_id: UUID,
    ) -> Optional[LLMEndpoint]: ...

    @abstractmethod
    async def fetch_endpoint_by_slug(
        self, *, project_id: UUID, #
        slug: str,
    ) -> Optional[LLMEndpoint]:
        """The data-plane route lookup. Backed by
        uq_llms_endpoints_project_slug — at most one row by
        construction. None means the custom namespace has no such name."""

    @abstractmethod
    async def edit_endpoint(
        self, *, project_id: UUID, user_id: UUID, #
        endpoint: LLMEndpointEdit,
    ) -> Optional[LLMEndpoint]:
        """Full PUT over data, flags, header, secret_id. provider_key and
        deployment_kind are absent from LLMEndpointEdit and therefore untouchable."""

    @abstractmethod
    async def delete_endpoint(
        self, *, project_id: UUID, #
        endpoint_id: UUID,
    ) -> bool: ...

    @abstractmethod
    async def query_endpoints(
        self, *, project_id: UUID, #
        endpoint: Optional[LLMEndpointQuery] = None, #
        windowing: Optional[Windowing] = None,
    ) -> List[LLMEndpoint]: ...
```

From `core/gateways/mcps/interfaces.py` — `MCPEndpointsDAOInterface` has the identical
six verbs over `mcps_endpoints` (same signatures, `LLMEndpoint*` → `MCPEndpoint*`).

`None` disambiguation (`entities.md` §7, reproduce in the DAO's module docstring):

| method | `None` means | caller does |
| --- | --- | --- |
| `fetch_endpoint_by_slug` | no such custom endpoint | proxy 404s in its own shape |
| `edit_endpoint` | the row does not exist | 404 at the boundary |

## dbas.py — reproduce verbatim from `entities.md` §2

```python
# dbs/postgres/gateways/llms/dbas.py

class LLMEndpointDBA(
    ProjectScopeDBA, IdentifierDBA, SlugDBA, LifecycleDBA,
    HeaderDBA, DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    __abstract__ = True

    provider_key = Column(String, nullable=False)
    deployment_kind = Column(
        SQLEnum(LLMDeploymentKind, name="llmdeploymentkind_enum"), nullable=False
    )
    secret_id = Column(UUID(as_uuid=True), nullable=True)
    # data: { route, models, settings } — LLMEndpointData


# dbs/postgres/gateways/mcps/dbas.py

class MCPEndpointDBA(
    ProjectScopeDBA, IdentifierDBA, SlugDBA, LifecycleDBA,
    HeaderDBA, DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    __abstract__ = True

    auth_mode = Column(
        SQLEnum(GatewayAuthScheme, name="gatewayauthscheme_enum"), nullable=False
    )
    secret_id = Column(UUID(as_uuid=True), nullable=True)
    # data: { route, tools, settings, oauth } — MCPEndpointData
```

`LLMDeploymentKind` and `GatewayAuthScheme` are seed-owned enums
(`core/gateways/llms/dtos.py`, `core/gateways/dtos.py`) — import, do not redefine.

## dbes.py — reproduce verbatim from `entities.md` §3

```python
class LLMEndpointDBE(Base, LLMEndpointDBA):
    __tablename__ = "llms_endpoints"
    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="SET NULL"),
        UniqueConstraint("project_id", "slug",
                         name="uq_llms_endpoints_project_slug"),
        Index("ix_llms_endpoints_project_provider",
              "project_id", "provider_key"),
        Index("ix_llms_endpoints_flags", "flags", postgresql_using="gin"),
    )


class MCPEndpointDBE(Base, MCPEndpointDBA):
    __tablename__ = "mcps_endpoints"
    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="SET NULL"),
        UniqueConstraint("project_id", "slug",
                         name="uq_mcps_endpoints_project_slug"),
        Index("ix_mcps_endpoints_flags", "flags", postgresql_using="gin"),
    )
```

Both endpoint tables take `SET NULL` on `secret_id` — a dead secret must not silently
delete configuration (D18).

No unique constraint mentions `url` or `secret_id` anywhere. Two endpoints may point at
one upstream with different tool policies; one secret may back several custom endpoints.

## dao.py

Two files, two classes: `LLMEndpointsDAO` (llms), `MCPEndpointsDAO`
(mcps). Each opens its own session through `TransactionsEngine`
(`dbs/postgres/shared/engine.py::get_transactions_engine`) — never receives a shared
session, matching every DAO in the tree.

**Precedent, read before writing:** `api/oss/src/dbs/postgres/gateway/connections/dao.py`
(`ConnectionsDAO`) is the closest sibling — one project-scoped table, a slug-uniqueness
create conflict, flag/data patch updates. Copy its shape:

- `@suppress_exceptions(exclude=[EntityCreationConflict])` on every `create_*` method;
  catch `IntegrityError`, inspect `str(e.orig)` for the unique-constraint name
  (`uq_llms_endpoints_project_slug`, `uq_mcps_endpoints_project_slug`), and
  raise `EntityCreationConflict(entity=..., message=..., conflict={"slug": ...})` — else
  re-raise.
- `@suppress_exceptions(default=None)` on `fetch_*`/`edit_*`,
  `@suppress_exceptions(default=False)` on `delete_*`, `@suppress_exceptions(default=[])`
  on `query_*` — read failures degrade, creates surface the one exception that matters
  (`entities.md` §7 house rule).
- `edit_endpoint` is a full PUT: load the row, overwrite `data`/`flags`/`name`/
  `description`/`secret_id`/`meta` wholesale from the `*Edit` DTO, `flag_modified` on the
  JSON columns exactly as `ConnectionsDAO.update_connection` does, `updated_at =
  datetime.now(timezone.utc)`, `updated_by_id = user_id`. Never a partial merge.

## mappings.py

Three functions per entity (`map_X_create_to_dbe`, `map_X_dbe_to_dto`,
`map_X_edit_to_dbe`), following
`dbs/postgres/gateway/connections/mappings.py`'s shape: `data`/`flags` are typed Pydantic
models on the DTO side (`LLMEndpointData`, `LLMEndpointFlags`, etc.) and dumped with
`model_dump(mode="json", exclude_none=True)` going in, reconstructed with
`ModelClass(**dbe.data)` coming out (`dbe.data`/`dbe.flags` are `None`-safe — default to
`{}` before unpacking so a row created before a field existed does not crash the read
path).

`map_llm_endpoint_dbe_to_dto` and `map_mcp_endpoint_dbe_to_dto` set
`namespace=GatewayEndpointNamespace.CUSTOM` unconditionally — every row this package's
DAOs return is a custom row (§1); the generated-entry stamping for `BUILTIN`/`AGENTA`
happens in WP7/WP9's service layer, never here.

## Migration

One revision, creating both tables with every constraint and index from §3 above.
Column types: `String` stays `String`; `SQLEnum(LLMDeploymentKind, ...)` and
`SQLEnum(GatewayAuthScheme, ...)` become `sa.Enum(..., name="llmdeploymentkind_enum")` /
`sa.Enum(..., name="gatewayauthscheme_enum")` in the migration (the enum name matters —
it is the Postgres type name, and it must match what the DBE declares or SQLAlchemy
creates a second anonymous type on next `create_all`). `JSON(none_as_null=True)` /
`JSONB(none_as_null=True)` map to `sa.JSON()` / `postgresql.JSONB()`. Follow
`oss000000020_add_session_attachments.py`'s structure: one `op.create_table(...)` per
table with inline constraints, then `op.create_index(...)` calls for anything not
inlineable. `downgrade()` drops indexes then tables in reverse dependency order:
`mcps_endpoints`, then `llms_endpoints`.

## Contracts this package must honour

- **`project_id` first, keyword-only after `*`**, on every DAO method — no exceptions in
  this package.
- **No `namespace` parameter anywhere.** Every DAO method operates on rows, and every row
  is `custom` (§2.3, D20). A namespace parameter here would silently invite someone to
  bolt generated-entry logic onto the DAO — that logic belongs in WP7/WP9's service.
- **No `UserScopeDBA` on either endpoint table.** Custom endpoints are project
  configuration; `user_id` on endpoint writes is authorship (`created_by_id`/
  `updated_by_id`) only, never a query key.
- **No lifecycle enum column on either table.** `ready`/`needs_auth`/
  `needs_input` are derived at read time by WP7/WP9's service, never stored (§2.6). If a
  task here seems to need a state column, that is a sign the task belongs to a different
  package.
- **`secret_id` FK behavior is `SET NULL` on both endpoint tables** (§2.1 above). Getting
  this swapped for `CASCADE` is the single easiest way to violate D18 (a dead secret must
  not delete configuration) without any test catching it locally, because the two behave
  identically until a secret is actually deleted under a live FK.
- **Verb naming is `create_/fetch_/edit_/delete_/query_`** — the newer house style
  (`core/workflows/`), not `ConnectionsDAO`'s `get_/update_`. Copy `ConnectionsDAO`'s
  *shape* (session handling, suppress_exceptions, flag_modified), not its verb names.

## Tests

**Unit (no services running, run now):**

- Every `map_*_dto_to_dbe*` / `map_*_dbe_to_dto` function round-trips a representative
  DTO through DBE construction and back without a database — these are pure Python
  object transforms and need no session. Assert field-for-field equality modulo
  server-assigned fields.
- `LLMEndpointData`/`MCPEndpointData` etc. (seed DTOs) serialize via
  `model_dump(mode="json", exclude_none=True)` to the shape the mapping functions expect
  — one instantiate-and-dump test per payload type touched by this package's mappings.

**Integration (needs Postgres — write, do not run without a local deployment):**
`api/oss/tests/pytest/integration/gateways/`

- `test_gateways_llm_endpoints_dao.py`: `create_endpoint` → `fetch_endpoint` round-trips
  field-for-field; a second `create_endpoint` with the same `(project_id, slug)` raises
  `EntityCreationConflict`; `edit_endpoint` fully replaces `data`/`flags` (a field omitted
  from the `LLMEndpointEdit.data` passed in is gone after the edit, not preserved —
  confirms this is a PUT, not a PATCH); `delete_endpoint` returns `True` once and `False`
  on a repeat; `query_endpoints` filters by `provider_key`/`deployment_kind`/`slug`.
- `test_gateways_mcp_endpoints_dao.py`: the same six assertions against
  `mcps_endpoints`.
- `test_gateways_migration.py`: `alembic upgrade head` then `alembic downgrade -1`
  round-trips cleanly against a throwaway database; every constraint and index named in
  §3 above exists after `upgrade` and is gone after `downgrade`; a second `upgrade` after
  `downgrade` also completes (idempotent round-trip).
- FK behavior: deleting a `secrets` row referenced by an endpoint's `secret_id` leaves the
  endpoint row present with `secret_id = NULL`.

## `api/entrypoints/routers.py` diff (apply at the IM1 merge)

WP1 contributes the two DAO constructions; nothing else in this file is WP1's.

```python
from oss.src.dbs.postgres.gateways.llms.dao import LLMEndpointsDAO
from oss.src.dbs.postgres.gateways.mcps.dao import MCPEndpointsDAO

llm_endpoints_dao = LLMEndpointsDAO(engine=_transactions_engine)
mcp_endpoints_dao = MCPEndpointsDAO(engine=_transactions_engine)
```

(`entities.md` §9's wiring block; WP2/WP3 add the resolver and policy service lines
alongside this at the same merge, WP7/WP9 add the two gateway services after that, WP10
mounts the routers last.)

## Checkpoint

Feeds **IM1 (foundation)**, then **C1** through WP6/WP7/WP8/WP9/WP10, all of
which depend on this package.

Exit condition, verbatim from `plan.md`: *"a custom endpoint round-trips, and every DAO
verb takes the owner."*

WP1 is done when: the migration applies and downgrades cleanly against a throwaway
database; `create_endpoint` → `fetch_endpoint` round-trips on both planes; a slug
collision on create raises `EntityCreationConflict` and nothing else does; and every DAO
method in both interfaces takes `project_id` first and `user_id` on writes exactly where
§7 says it should — verified by grep, not by memory.

## Out of scope

- `core/gateways/{llms,mcps}/{service,registry,catalog}.py` and `providers/` — WP6, WP7,
  WP8, WP9.
- `core/gateways/policy/*` — WP2, WP3.
- `apis/fastapi/gateways/**` — WP6, WP8, WP10.
- `core/access/permissions/types.py` — WP3.
- Anything under WP16/WP17 (the two OAuth secret kinds, the OAuth client). Both are
  independent of this package's tables; WP1 owns no OAuth-related row.
- User-level secret grants (a `mcps_grants`-style table narrowing an endpoint's
  `secret_id` per user) — removed from scope, see `../out-of-scope.md`.

## Missing from the design, needs a ruling

None found for this package's own surface — every DTO, column, exception and DAO method
this spec references exists in `entities.md` with the signature reproduced above.
