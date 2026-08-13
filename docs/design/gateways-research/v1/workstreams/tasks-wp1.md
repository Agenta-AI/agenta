# WP1 tasks — Gateway domain and storage

Ordered so each item is one reviewable commit. Depends on the seed commit
(`core/gateways/{dtos,types}.py`, `core/gateways/policy/{dtos,types,interfaces}.py`,
`core/gateways/{llms,mcps}/{dtos,types,interfaces}.py`) already existing on the base
branch, per `workstreams/README.md`.

## Setup

- [x] Verify the current migration head:
      `ls api/oss/databases/postgres/migrations/core_oss/versions/ | tail -3`. Record the
      actual latest revision id — do not assume `oss000000020` or `park00000000` from
      `specs-wp1.md` without re-checking, both may be stale by the time this starts.

## dbas

- [x] `dbs/postgres/gateways/llms/dbas.py`: add `LlmEndpointDBA` —
      `ProjectScopeDBA, IdentifierDBA, SlugDBA, LifecycleDBA, HeaderDBA, DataDBA,
      StatusDBA, FlagsDBA, TagsDBA, MetaDBA` plus `provider_key: String,
      nullable=False`, `deployment: SQLEnum(LlmDeploymentKind,
      name="llmdeploymentkind_enum"), nullable=False`, `secret_id: UUID,
      nullable=True`.
- [x] `dbs/postgres/gateways/mcps/dbas.py`: add `McpEndpointDBA` — same base mixins as
      `LlmEndpointDBA`, plus `auth_mode: SQLEnum(GatewayAuthScheme,
      name="gatewayauthscheme_enum"), nullable=False`, `secret_id: UUID,
      nullable=True`.
- [x] Add `McpGrantDBA` — `ProjectScopeDBA, IdentifierDBA, LifecycleDBA, StatusDBA,
      FlagsDBA, TagsDBA, MetaDBA` (no `SlugDBA`, no `HeaderDBA`, no `DataDBA`), plus
      `endpoint_id: UUID, nullable=False`, `user_id: UUID, nullable=True`,
      `secret_id: UUID, nullable=False`. Confirm by re-reading `entities.md` §2 that no
      `expires_at` column and no `DataDBA` exist on this class.
- [x] Ruff format + check both files; commit.

## dbes

- [x] `dbs/postgres/gateways/llms/dbes.py`: `LlmEndpointDBE` — `__tablename__ =
      "llm_gateway_endpoints"`; `PrimaryKeyConstraint(project_id, id)`; FK
      `project_id -> projects.id ondelete=CASCADE`; FK `secret_id -> secrets.id
      ondelete=SET NULL`; `UniqueConstraint(project_id, slug,
      name="uq_llm_gateway_endpoints_project_slug")`;
      `Index("ix_llm_gateway_endpoints_project_provider", project_id, provider_key)`;
      `Index("ix_llm_gateway_endpoints_flags", flags, postgresql_using="gin")`.
- [x] `dbs/postgres/gateways/mcps/dbes.py`: `McpEndpointDBE` — `__tablename__ =
      "mcp_gateway_endpoints"`; PK `(project_id, id)`; FK `project_id`
      `ondelete=CASCADE`; FK `secret_id -> secrets.id ondelete=SET NULL`;
      `UniqueConstraint(project_id, slug, name="uq_mcp_gateway_endpoints_project_slug")`;
      `Index("ix_mcp_gateway_endpoints_flags", flags, postgresql_using="gin")`.
- [x] `McpGrantDBE` — `__tablename__ = "mcp_gateway_grants"`; PK `(project_id, id)`; FK
      `project_id ondelete=CASCADE`; FK `secret_id -> secrets.id ondelete=CASCADE`
      (**not** `SET NULL` — confirm against specs before committing, this is the one
      place the two endpoint tables and the grant table diverge); partial unique
      `Index("uq_mcp_gateway_grants_user", project_id, endpoint_id, user_id,
      unique=True, postgresql_where=text("user_id IS NOT NULL"))`; partial unique
      `Index("uq_mcp_gateway_grants_project", project_id, endpoint_id, unique=True,
      postgresql_where=text("user_id IS NULL"))`; `Index("ix_mcp_gateway_grants_endpoint",
      project_id, endpoint_id)`.
- [x] Confirm by grep over both `dbes.py` files that no unique constraint or index
      mentions `url` or `secret_id` alone — deliberate absence (§3).
- [x] Ruff format + check; commit.

## Verification: models import

- [x] Import both `dbes.py` modules in a throwaway shell / smoke test — confirm the
      `SQLEnum` types resolve against the seed's `LlmDeploymentKind` and
      `GatewayAuthScheme` without a circular import (both live in seed-owned
      `core/gateways/**/dtos.py`, imported here, never redefined).

## mappings

- [x] `dbs/postgres/gateways/llms/mappings.py`: `map_llm_endpoint_create_to_dbe`,
      `map_llm_endpoint_dbe_to_dto`, `map_llm_endpoint_edit_to_dbe` — follow
      `dbs/postgres/gateway/connections/mappings.py`'s shape (`model_dump(mode="json",
      exclude_none=True)` on `data`/`flags` going in, reconstruct the typed model going
      out). `map_llm_endpoint_dbe_to_dto` stamps `namespace=GatewayEndpointNamespace.CUSTOM`
      unconditionally.
- [x] `dbs/postgres/gateways/mcps/mappings.py`: the same three-function set for
      `McpEndpoint`, plus `map_mcp_grant_create_to_dbe` / `map_mcp_grant_dbe_to_dto` (no
      edit mapper for grants — `update_grant` writes fields directly, never through a
      mapper built from an Edit DTO, because no `McpGrantEdit` exists).
- [x] Unit test: instantiate one representative DTO per entity
      (`LlmEndpointCreate`, `McpEndpointCreate`, `McpGrantCreate`), map to DBE and back,
      assert field-for-field equality modulo server-assigned fields (`id`, timestamps).
      No database — pure object construction.
- [x] Ruff format + check; commit.

## dao — llms

- [x] `dbs/postgres/gateways/llms/dao.py`: `LlmEndpointsDAO.__init__(self, *,
      LlmEndpointDBE: type = LlmEndpointDBE, engine: TransactionsEngine = None)` —
      mirror `ConnectionsDAO.__init__`'s shape, defaulting `engine` via
      `get_transactions_engine()`.
- [x] Implement `create_endpoint`: `@suppress_exceptions(exclude=[EntityCreationConflict])`;
      map DTO → DBE via `map_llm_endpoint_create_to_dbe`; `session.add` + `commit` +
      `refresh`; catch `IntegrityError`, inspect `str(e.orig)` for
      `uq_llm_gateway_endpoints_project_slug`, raise `EntityCreationConflict(entity="LlmEndpoint",
      conflict={"slug": ...})` on match, else re-raise.
- [x] Implement `fetch_endpoint`, `fetch_endpoint_by_slug` — `@suppress_exceptions(default=None)`,
      `select(...).filter(project_id==..., id/slug==...).limit(1)`.
- [x] Implement `edit_endpoint` — `@suppress_exceptions(default=None)`; fetch the row by
      `(project_id, endpoint_id)`, return `None` if absent; overwrite `name`,
      `description`, `secret_id`, `data`, `flags`, `meta` wholesale from the `Edit` DTO
      (full PUT — no partial merge); `flag_modified` on `data`/`flags`; set `updated_at`,
      `updated_by_id`.
- [x] Implement `delete_endpoint` — `@suppress_exceptions(default=False)`; `delete(...)`
      by `(project_id, endpoint_id)`; return `result.rowcount > 0`.
- [x] Implement `query_endpoints` — `@suppress_exceptions(default=[])`; filter by
      `provider_key`/`deployment`/`slug` when present on the `LlmEndpointQuery`; apply
      `windowing` if given, else default ordering by `created_at desc`.
- [x] Ruff format + check; commit.

## dao — mcps (endpoints)

- [x] `dbs/postgres/gateways/mcps/dao.py`: `McpEndpointsDAO` — same six methods, same
      shape, over `mcp_gateway_endpoints` / `uq_mcp_gateway_endpoints_project_slug`.
- [x] Ruff format + check; commit.

## dao — mcps (grants)

- [x] Same file: `McpGrantsDAO.__init__` — same shape.
- [x] Implement `create_grant`: `@suppress_exceptions(exclude=[EntityCreationConflict])`
      is **not** used here — this method never raises a conflict, it resolves one. Use
      `sqlalchemy.dialects.postgresql.insert(McpGrantDBE).values(...)
      .on_conflict_do_nothing(index_where=...).returning(McpGrantDBE)`, with
      `index_where` matching whichever partial index applies
      (`user_id IS NOT NULL` when `grant.user_id` is set, `user_id IS NULL` otherwise).
      When the insert returns no row, call `fetch_grant` with the same
      `(project_id, endpoint_id, user_id)` and return that row — never `None`.
- [x] Implement `fetch_grant` — `@suppress_exceptions(default=None)`; filter
      `project_id`, `endpoint_id`, and `user_id == None` (`IS NULL`, not `== None` in
      Python-side comparison — use `.is_(None)`) or `user_id == <value>` depending on
      which was passed; this is an exact-owner lookup, no fallback.
- [x] Implement `fetch_grant_by_id` — `@suppress_exceptions(default=None)`.
- [x] Implement `update_grant` — `@suppress_exceptions(default=None)`; `UPDATE ... WHERE
      (project_id, id) = (...) RETURNING`; patch only `flags.is_valid` (via
      `flag_modified`, merged into the existing `flags` dict, not overwritten) and
      `status` when given; never touch `endpoint_id`, `user_id`, `secret_id`.
- [x] Implement `delete_grant` — `@suppress_exceptions(default=False)`; row delete by
      `(project_id, grant_id)` only — does not touch the vault secret (the service does
      that first, per §2.1).
- [x] Implement `query_grants` — `@suppress_exceptions(default=[])`; filter by
      `endpoint_id`/`user_id` when present on `McpGrantQuery`.
- [x] Ruff format + check; commit.

## migration

- [x] `api/oss/databases/postgres/migrations/core_oss/versions/oss0000000NN_add_gateway_endpoints.py`
      (NN = verified head + 1 from Setup): header with `revision`, `down_revision` set
      to the verified head.
- [x] `upgrade()`: `op.create_table("llm_gateway_endpoints", ...)` — every column from
      `LlmEndpointDBA`/`DBE`, the PK, both FKs, the slug unique constraint.
- [x] `op.create_index("ix_llm_gateway_endpoints_project_provider", ...)`,
      `op.create_index("ix_llm_gateway_endpoints_flags", ..., postgresql_using="gin")`.
- [x] `op.create_table("mcp_gateway_endpoints", ...)`, its PK, both FKs, the slug unique
      constraint, `op.create_index("ix_mcp_gateway_endpoints_flags", ...)`.
- [x] `op.create_table("mcp_gateway_grants", ...)`, PK, both FKs (`secret_id` →
      `ondelete="CASCADE"` — double check this is not `SET NULL`).
- [x] `op.create_index("uq_mcp_gateway_grants_user", ..., unique=True,
      postgresql_where=sa.text("user_id IS NOT NULL"))`.
- [x] `op.create_index("uq_mcp_gateway_grants_project", ..., unique=True,
      postgresql_where=sa.text("user_id IS NULL"))`.
- [x] `op.create_index("ix_mcp_gateway_grants_endpoint", ...)`.
- [x] `downgrade()`: drop every index created above, then `op.drop_table("mcp_gateway_grants")`,
      `op.drop_table("mcp_gateway_endpoints")`, `op.drop_table("llm_gateway_endpoints")`
      — reverse order.
- [x] Ruff format + check; commit.

## tests — unit (run now)

- [x] `api/oss/tests/pytest/unit/gateways/test_gateways_mappings.py` — the DTO↔DBE
      round-trip tests from the mappings section above, for all three entities. No
      database.

## tests — integration (write; do not run without a local deployment)

- [x] `api/oss/tests/pytest/integration/gateways/test_gateways_llm_endpoints_dao.py` —
      create→fetch round-trip; duplicate slug raises `EntityCreationConflict`;
      `edit_endpoint` replaces `data`/`flags` wholesale (a field omitted from the new
      `data` is gone after the edit); `delete_endpoint` idempotency (`True` then
      `False`); `query_endpoints` filters.
- [x] `api/oss/tests/pytest/integration/gateways/test_gateways_mcp_endpoints_dao.py` —
      same six assertions against `mcp_gateway_endpoints`.
- [x] `api/oss/tests/pytest/integration/gateways/test_gateways_mcp_grants_dao.py` —
      `create_grant(user_id=None)` called twice returns the same row the second time;
      `create_grant` with two distinct `user_id`s on one `endpoint_id` produces two rows;
      a raw `INSERT` that violates either partial unique index raises `IntegrityError`
      naming the constraint; `fetch_grant(user_id=None)` never returns a
      `user_id`-owned row and vice versa; `update_grant` flips `is_valid` without
      touching `endpoint_id`/`user_id`/`secret_id`; `delete_grant` then
      `fetch_grant_by_id` returns `None`.
- [ ] `api/oss/tests/pytest/integration/gateways/test_gateways_migration.py` — deliberately
      NOT written: the WP1 task brief overrides this item explicitly (`alembic
      upgrade`/`downgrade` is a by-hand Docker+Postgres check someone else runs at the
      merge, never a pytest, because a downgrade drops tables — a test would be either
      destructive or a lie). The migration itself was still verified by hand: module
      import, `revision`/`down_revision` metadata, and a grep confirming exactly one file
      in the chain declares each of `revision="oss000000021"` and
      `down_revision="oss000000020"`.
- [x] Same file or a sibling: deleting a `secrets` row referenced by an endpoint's
      `secret_id` leaves the endpoint row with `secret_id = NULL`; deleting a `secrets`
      row referenced by a grant's `secret_id` deletes the grant row (CASCADE).

## routers.py diff (hand off at merge, do not commit directly)

- [x] Write the three-line DAO-construction diff from `specs-wp1.md` into this
      package's PR description / merge notes for M1 — `LlmEndpointsDAO`,
      `McpEndpointsDAO`, `McpGrantsDAO` constructed with `_transactions_engine`.

## Definition of done

Feeds **M1**, then **Checkpoint A** via WP6/WP7/WP8/WP9/WP10. Exit condition, verbatim
from `plan.md`: *"a custom endpoint round-trips, and every DAO verb takes the owner."*

WP1 is done when: the migration applies and downgrades cleanly; a custom endpoint on
either plane round-trips create→fetch with field-for-field equality; a slug collision on
create raises `EntityCreationConflict` and nothing else does; `create_grant`'s conflict
path never returns `None`; the two partial unique indexes on grants reject violations at
the database level (verified by an `IntegrityError` assertion naming the constraint, not
just "it failed"); and grep over both `interfaces.py`-implementing files confirms every
method takes `project_id` first, keyword-only after `*`.
