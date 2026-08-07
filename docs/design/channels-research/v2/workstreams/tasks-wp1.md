# WP1 tasks — Domain and schema

Ordered so each item is one reviewable commit. Depends on the seed commit
(`core/channels/interfaces.py`, `dtos.py`, `types.py`, `exceptions.py` stubs)
already existing on the base branch.

## dbas

- [ ] `dbs/postgres/channels/dbas.py`: add `ChannelAgentDBA` — `ProjectScopeDBA,
      LifecycleDBA, IdentifierDBA, SlugDBA, HeaderDBA, DataDBA, FlagsDBA,
      TagsDBA, MetaDBA` plus `connection_id: UUID, nullable=False`.
- [ ] Add `ChannelSpaceDBA` — same base mixins minus `SlugDBA`, plus
      `connection_id`, `kind: Enum(ChannelSpaceKind), nullable=False`,
      `external_key: UUID, nullable=False`.
- [ ] Add `ChannelGrantDBA` — same shape as space minus `kind`/`external_key`,
      plus `agent_id: UUID, nullable=False`, `space_id: UUID, nullable=False`.
- [ ] Add `ChannelThreadDBA` — `ProjectScopeDBA, LifecycleDBA, IdentifierDBA,
      DataDBA, FlagsDBA, TagsDBA, MetaDBA` (no `HeaderDBA`), plus `space_id`,
      `agent_id` (both `UUID, nullable=False`), `external_key: UUID,
      nullable=True`, `session_id: String, nullable=False`.
- [ ] Add `ChannelInboxEventDBA` — `ProjectScopeDBA, LifecycleDBA,
      IdentifierDBA, DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA`, plus
      `connection_id`, `external_id: String, nullable=False`, `kind:
      Enum(ChannelEventKind)`, `origin: Enum(ChannelEventOrigin)`, `space_id:
      UUID, nullable=True`.
- [ ] Add `ChannelInboxTriggerDBA` — `ProjectScopeDBA, LifecycleDBA,
      IdentifierDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA` (no `DataDBA`),
      plus `thread_id`, `event_id` (`UUID, nullable=False`), `turn_id: String,
      nullable=False`, `state: Enum(ChannelTriggerState)`. Confirm no `origin`
      column and no `is_trigger` flag exist anywhere in this class.
- [ ] Add `ChannelOutboxEventDBA` — `ProjectScopeDBA, LifecycleDBA,
      IdentifierDBA, DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA`, plus
      `connection_id`, `thread_id`, `turn_id: String, nullable=False`, `key:
      UUID, nullable=False`, `state: Enum(ChannelDeliveryState)`. Confirm no
      `attempts` column and no `idempotency_key` column.

## dbes

- [ ] `dbs/postgres/channels/dbes.py`: `ChannelAgentDBE` — `__tablename__ =
      "channel_agents"`; FK `project_id -> projects.id ondelete=CASCADE`;
      `PrimaryKeyConstraint(project_id, id)`;
      `UniqueConstraint(project_id, connection_id, slug,
      name="uq_channel_agents_connection_slug")`; partial unique
      `Index("uq_channel_agents_default", project_id, connection_id,
      unique=True, postgresql_where=text("(flags->>'is_default')::boolean"))`.
- [ ] `ChannelSpaceDBE` — `__tablename__ = "channel_spaces"`; FK on
      `project_id`; PK `(project_id, id)`;
      `UniqueConstraint(project_id, connection_id, external_key,
      name="uq_channel_spaces_connection_external_key")`;
      `Index("ix_channel_spaces_flags", flags, postgresql_using="gin")`.
- [ ] `ChannelGrantDBE` — `__tablename__ = "channel_grants"`; FK on
      `project_id`; PK `(project_id, id)`;
      `UniqueConstraint(project_id, agent_id, space_id,
      name="uq_channel_grants_agent_space")`; partial unique
      `Index("uq_channel_grants_default", project_id, space_id, unique=True,
      postgresql_where=text("(flags->>'is_default')::boolean"))`.
- [ ] `ChannelThreadDBE` — `__tablename__ = "channel_threads"`; FK on
      `project_id`; PK `(project_id, id)`;
      `Index("ix_channel_threads_current", project_id, space_id, external_key,
      agent_id, created_at)` — non-unique, deliberately (append-only, latest
      row wins).
- [ ] `ChannelInboxEventDBE` — `__tablename__ = "channel_inbox_events"`; FK on
      `project_id`; PK `(project_id, id)`;
      `UniqueConstraint(project_id, connection_id, external_id,
      name="uq_channel_inbox_connection_external")`;
      `Index("ix_channel_inbox_events_log", project_id, space_id, origin, id)`.
- [ ] `ChannelInboxTriggerDBE` — `__tablename__ = "channel_inbox_triggers"`; FK
      on `project_id`; PK `(project_id, id)`;
      `UniqueConstraint(project_id, thread_id, event_id,
      name="uq_channel_inbox_triggers_thread_event")`;
      `Index("ix_channel_inbox_triggers_latest", project_id, thread_id, id)`.
- [ ] `ChannelOutboxEventDBE` — `__tablename__ = "channel_outbox_events"`; FK
      on `project_id`; PK `(project_id, id)`;
      `UniqueConstraint(project_id, key, name="uq_channel_outbox_key")`;
      `Index("ix_channel_outbox_created", project_id, state, created_at)`.
- [ ] Confirm, by grep over `dbes.py`, that no `(space_id, external_key,
      agent_id)` unique constraint exists on `ChannelThreadDBE` — deliberate
      absence, not an oversight to "fix".

## dtos

- [ ] `core/channels/dtos.py`: add the nine enums (`ChannelSpaceKind`,
      `ChannelEventKind`, `ChannelEventOrigin`, `ChannelTriggerKind`,
      `ChannelSessionScope` + `SESSION_SCOPE_ORDER`, `ChannelPolicyLevel`,
      `ChannelTriggerState`, `ChannelDeliveryState`) as `str, Enum`, values
      exactly as in `entities.md` §4.
- [ ] Add the seven flags models (`ChannelAgentFlags`, `ChannelSpaceFlags`,
      `ChannelGrantFlags`, `ChannelThreadFlags`, `ChannelInboxEventFlags`
      empty, `ChannelInboxTriggerFlags`, `ChannelOutboxEventFlags` empty).
- [ ] Add `ChannelPolicy` (all four fields `Optional`, default `None`) and
      `ChannelEffectivePolicy` (all four fields required, plus `decided_by:
      Dict[str, ChannelPolicyLevel]`).
- [ ] Add the six `*Data` payload models (`ChannelAgentData`,
      `ChannelSpaceData`, `ChannelGrantData`, `ChannelThreadData`,
      `ChannelInboxEventData`, `ChannelOutboxEventData`), `raw`/`processed`
      left commented out on the last two per §4.
- [ ] Add `ChannelAgent` / `ChannelAgentCreate` / `ChannelAgentEdit` /
      `ChannelAgentQuery`.
- [ ] Add `ChannelSpace` / `ChannelSpaceCreate` / `ChannelSpaceEdit` /
      `ChannelSpaceQuery` / `ChannelSpaceCandidate` (the last is not an
      entity — no id, no lifecycle).
- [ ] Add `ChannelGrant` / `ChannelGrantCreate` / `ChannelGrantEdit` /
      `ChannelGrantQuery`.
- [ ] Add `ChannelThread` / `ChannelThreadCreate` / `ChannelThreadQuery` (no
      Edit).
- [ ] Add `ChannelInboxEvent` / `ChannelInboxEventCreate` /
      `ChannelInboxEventQuery` (no Edit).
- [ ] Add `ChannelInboxTrigger` / `ChannelInboxTriggerCreate` /
      `ChannelInboxTriggerQuery` (no Edit).
- [ ] Add `ChannelOutboxEvent` / `ChannelOutboxEventCreate` /
      `ChannelOutboxEventQuery` (no Edit).
- [ ] Unit test: instantiate every DTO class above with representative
      values; assert it constructs without validation error (the C0 exit
      condition, re-run against real classes).

## types

- [ ] `core/channels/types.py`: `ChannelsError` base, setting `self.message`.
- [ ] `ChannelNotSupported(*, channel: str)`.
- [ ] `ChannelSpaceNotFound(*, space_id: Optional[UUID] = None, external_key:
      Optional[UUID] = None)`.
- [ ] `ChannelAgentNotFound(*, agent_id=None, slug=None)`.
- [ ] `ChannelAgentNotGranted(*, agent_id: UUID, space_id: UUID)`.
- [ ] `ChannelThreadNotFound(*, thread_id: UUID)`.
- [ ] `ChannelSignatureInvalid(*, channel: str)` — verify it carries no other
      field (no byte diff, no timestamp).
- [ ] `ChannelConnectionNotFound(*, connection_id: UUID)`.
- [ ] `ChannelPolicyDenied(*, field: str, level: ChannelPolicyLevel)`.
- [ ] `ChannelLocatorIncomplete(*, channel: str, grain: ChannelKeyGrain,
      missing: List[str])` — raised by `compose_external_key` when a locator
      is missing a field the capability declaration names in
      `identity.keys` for that grain.
- [ ] Unit test: each exception's `.message` is set and non-empty after
      construction with minimal args.

## interfaces (WP1's half)

- [ ] `core/channels/interfaces.py`: fill in `ChannelsDAOInterface` with every
      agent method (`create_agent`, `fetch_agent`, `fetch_agent_by_slug`,
      `fetch_default_agent`, `edit_agent`, `delete_agent`, `query_agents`),
      signatures exact per `entities.md` §7, replacing the seed's
      `NotImplementedError` stub bodies with real `@abstractmethod` ellipses.
- [ ] Fill in every space method (`create_space`, `fetch_space`,
      `fetch_space_by_key`, `edit_space`, `delete_space`, `query_spaces`,
      `mark_space_backfilled`).
- [ ] Fill in every grant method (`create_grant`, `fetch_grant`,
      `fetch_default_grant`, `edit_grant`, `delete_grant`, `query_grants`,
      `count_grants`).
- [ ] Fill in thread methods (`create_thread`, `fetch_current_thread`,
      `query_threads`).
- [ ] Fill in inbox log methods (`record_inbox_event`, `record_inbox_events`,
      `attach_space`, `query_events_since`, `query_inbox_events`).
- [ ] Fill in inbox offset methods (`fetch_latest_trigger`,
      `record_inbox_trigger`, `transition_inbox_trigger`,
      `query_inbox_triggers`).
- [ ] Fill in outbox methods (`record_outbox_event`, `fetch_outbox_event`,
      `fetch_outbox_event_by_key`, `claim_outbox_events`,
      `transition_outbox_event`, `query_outbox_events`).
- [ ] Fill in `get_project_and_connection_by_external_id(*, channel: str,
      external_id: str) -> Optional[Tuple[UUID, UUID]]` — the one method
      without `project_id` first; docstring states why (mirrors
      `get_project_and_subscription_by_trigger_id`).
- [ ] Confirm every method is keyword-only after `*` and every parameter list
      matches `entities.md` §7 exactly — no positional params, no renamed
      params.

## models (utils.py)

- [ ] `core/channels/utils.py`: add `ChannelKeyGrain(str, Enum)` with members
      `SPACE = "space"`, `THREAD = "thread"`.
- [ ] Implement `compose_external_key(capabilities: ChannelCapabilities,
      grain: ChannelKeyGrain, locator: Dict[str, Any]) -> Optional[UUID]` as
      the single function that derives `external_key`. It reads the field set
      from `capabilities.identity.keys[grain]` — never from a hardcoded
      per-channel list — restricts `locator` to those fields, and returns
      `uuid5(_CHANNELS, canonical_json(subset))`. No other function in the
      codebase may build an `external_key`.
- [ ] At `THREAD` grain, when `capabilities.identity.keys["thread"]` is
      `[]`, return `None` rather than raising (the platform-has-no-threads
      case).
- [ ] When a field named in `keys[grain]` is absent from `locator`,
      raise `ChannelLocatorIncomplete(channel=..., grain=..., missing=...)`
      naming every missing field — never compose a key over what is present.
- [ ] Unit test: two distinct locator shapes (differing only in a
      declared-but-not-obviously-distinguishing field, e.g. two different
      `thread_ts` with the same `team`/`channel`) produce two distinct
      `UUID` keys; the same locator produces the same key on repeat calls
      (determinism); the same locator with its keys reordered in the input
      dict produces the identical key (canonicalisation).
- [ ] Unit test: `grain=THREAD` against capabilities declaring `"thread": []`
      returns `None`.
- [ ] Unit test: a locator missing a declared field raises
      `ChannelLocatorIncomplete` naming the missing field, and no key is
      returned.

## dao

- [ ] `dbs/postgres/channels/mappings.py`: `map_agent_dto_to_dbe_create`,
      `map_agent_dbe_to_dto`, `map_agent_dto_to_dbe_edit` — follow
      `triggers/mappings.py`'s three-function-per-entity shape exactly
      (`model_dump(mode="json", exclude_none=True)` on `data`,
      `model_dump()` on `flags`).
- [ ] Add the same three-function set for spaces, grants.
- [ ] Add `map_thread_dto_to_dbe_create` / `map_thread_dbe_to_dto` (no edit
      mapper — threads have no `*Edit`).
- [ ] Add `map_inbox_event_dto_to_dbe_create` / `map_inbox_event_dbe_to_dto`
      (no edit mapper).
- [ ] Add `map_inbox_trigger_dto_to_dbe_create` /
      `map_inbox_trigger_dbe_to_dto` (no edit mapper; `transition_inbox_trigger`
      writes fields directly, not through an edit mapper).
- [ ] Add `map_outbox_event_dto_to_dbe_create` / `map_outbox_event_dbe_to_dto`
      (no edit mapper; `transition_outbox_event` writes fields directly).
- [ ] `dbs/postgres/channels/dao.py`: implement `ChannelsDAO.__init__(self,
      engine=None)` — same shape as `TriggersDAO`, opening its own sessions
      via `TransactionsEngine`.
- [ ] Implement the seven agent methods. `create_agent` follows
      `TriggersDAO.create_subscription`'s try/`IntegrityError`
      shape only if a uniqueness conflict is a real caller-facing case (slug
      collision within a connection) — else plain insert.
- [ ] Implement `fetch_agent_by_slug` backed by
      `uq_channel_agents_connection_slug`; `fetch_default_agent` backed by the
      partial unique index (returns at most one row by construction, no
      `LIMIT 1` needed for correctness but keep it for defense in depth).
- [ ] Implement the seven space methods, `fetch_space_by_key` backed by
      `uq_channel_spaces_connection_external_key`.
- [ ] Implement `mark_space_backfilled` as a targeted `UPDATE ... SET
      flags = jsonb_set(flags, '{is_backfilled}', 'true')` (or
      fetch-mutate-write within one session) — never routed through
      `edit_space`.
- [ ] Implement the seven grant methods; `count_grants` as `SELECT count(*)`,
      never a `query_grants` call under the hood.
- [ ] Implement the three thread methods; `fetch_current_thread` as `ORDER BY
      created_at DESC LIMIT 1`, no unique-constraint lookup.
- [ ] Implement `record_inbox_event` as `INSERT ... ON CONFLICT (project_id,
      connection_id, external_id) DO NOTHING ... RETURNING`, mirroring
      `TriggersDAO.claim_delivery`'s `on_conflict_do_nothing().returning()`
      pattern; returns `None` when nothing was inserted.
- [ ] Implement `record_inbox_events` (bulk) as one multi-row insert
      statement — not a loop of single inserts — so `id` order is fetch order.
- [ ] Implement `attach_space` as an `UPDATE ... WHERE id = :event_id
      RETURNING`.
- [ ] Implement `query_events_since` as `WHERE space_id = :space_id AND
      (origin, id) > (:origin, :after_event_id) ORDER BY origin, id`
      (row-tuple comparison), falling back to "whole log" when
      `after_event_id is None`.
- [ ] Implement `query_inbox_events` following `query_subscriptions`'s
      filter-building shape.
- [ ] Implement `fetch_latest_trigger` as `ORDER BY id DESC LIMIT 1`.
- [ ] Implement `record_inbox_trigger` as `INSERT ... ON CONFLICT
      (project_id, thread_id, event_id) DO NOTHING ... RETURNING`, returning
      `None` on conflict — mirrors `record_inbox_event`'s shape, applied to
      the offset table.
- [ ] Implement `transition_inbox_trigger` as `UPDATE ... WHERE id =
      :trigger_id RETURNING`, never an insert, mirroring
      `TriggersDAO.update_delivery`.
- [ ] Implement `query_inbox_triggers`.
- [ ] Implement `record_outbox_event` as `INSERT ... ON CONFLICT
      (project_id, key) DO NOTHING ... RETURNING`, falling back to a `SELECT`
      by `key` when the insert affected zero rows — the caller gets the
      existing row, never `None` (contrast with the inbox methods — write
      this contrast into the docstring).
- [ ] Implement `fetch_outbox_event`, `fetch_outbox_event_by_key`.
- [ ] Implement `claim_outbox_events` as `SELECT ... WHERE state = 'created'
      ORDER BY created_at LIMIT :limit`, `project_id` optional (cross-project
      sweep), mirroring `fetch_active_schedules`'s optional-project shape.
- [ ] Implement `transition_outbox_event` as `UPDATE ... WHERE id = :event_id
      RETURNING`, accepting optional `status` and `data` to merge into the
      existing row without clobbering unrelated `data` keys.
- [ ] Implement `query_outbox_events`.
- [ ] Implement `get_project_and_connection_by_external_id` as an unscoped
      `SELECT` joining whatever locates a connection by its platform team/
      workspace external id — docstring states the deliberate absence of
      `project_id` scoping, mirroring
      `get_project_and_subscription_by_trigger_id`.

## service

- [ ] `core/channels/service.py`: `ChannelsService.__init__(self, *,
      channels_dao, adapter_registry, connections_service)`.
- [ ] Implement `create_agent`, `fetch_agent`, `edit_agent`, `delete_agent`,
      `query_agents` as thin DAO delegations (not bare pass-throughs — raise
      `ChannelConnectionNotFound` / `ChannelAgentNotFound` where the entity
      graph requires it).
- [ ] Implement `set_agent_default`: clear any existing connection-wide
      default first, then set the requested one — two DAO writes, one
      service call, mirroring `set_subscription_active`'s "clear then set"
      shape so the partial unique index is never hit by the write itself.
- [ ] Implement `create_space`, `fetch_space`, `edit_space`, `delete_space`,
      `query_spaces` as thin DAO delegations, computing `external_key` via
      `compose_external_key` before calling `create_space` — never inline.
- [ ] Implement `discover_spaces(*, project_id, connection_id)`: resolve the
      connection's adapter via `adapter_registry`, call its discovery method,
      map results to `ChannelSpaceCandidate`, mark `is_configured` by
      cross-referencing existing `channel_spaces` rows for that connection.
      Persists nothing.
- [ ] Implement `create_grant`, `edit_grant`, `delete_grant`, `query_grants`
      as thin DAO delegations.
- [ ] Implement `set_grant_default`: clear the space's existing default grant
      first, then set the requested one — same two-write shape as
      `set_agent_default`.
- [ ] Implement `query_threads` as a thin DAO delegation.
- [ ] Implement `close_thread(*, project_id, user_id, thread_id)`: append
      behavior per D12 — never deletes, never edits in place; writes a flag
      update via the DAO (state "closed" is `is_active=False` in
      `ChannelThreadFlags`, applied to the current row, not a new row — confirm
      against WP4's `!new` semantics before finalizing, since `!new` itself
      inserts a *new* thread row rather than closing the old one; `close_thread`
      only flips `is_active` on the row being closed).
- [ ] Implement `fetch_capabilities(*, channel)`: resolve the adapter via
      `adapter_registry`, call its capability declaration method, return as
      the WP1/WP2-shared `ChannelCapabilities` DTO. Depends on WP2's
      normalisation being in place — if WP2 is not yet merged in this
      worktree, code against the stub interface.
- [ ] Implement `resolve_effective_policy(*, project_id, agent_id, space_id)`:
      load agent, space, and grant (if any) rows, load the channel's
      capability declaration and channel defaults via `adapter_registry`, call
      `resolve_policy`, return the `ChannelEffectivePolicy`.
- [ ] Implement `resolve_policy` as a **pure function** (module-level, not a
      method) taking `(capabilities, channel_defaults, *levels)` — booleans:
      any `False` wins; sets: intersect all stated; enums: narrowest stated,
      by `SESSION_SCOPE_ORDER`; unstated everywhere falls through to
      `channel_defaults`. Populate `decided_by` per field.
- [ ] Declare (signature only, raising `NotImplementedError` until the owning
      package fills it in) `verify_signature`, `record_event`, `resolve`,
      `compose_input`, `open_turn`, `settle_turn`, `enqueue_output`, `deliver`
      — these belong to WP3/WP4/WP5 but must exist on `ChannelsService` now so
      those packages code against a stable signature.

## migration

- [ ] Confirm the WP7 table shape with WP7's spec (`specs-wp7.md`) before
      writing DDL — WP1 carries WP7's tables in this file but does not design
      them.
- [ ] `api/oss/databases/postgres/migrations/core_oss/versions/oss000000021_add_channels.py`:
      header with `revision = "oss000000021"`, `down_revision =
      "oss000000020"`.
- [ ] `upgrade()`: `op.create_table("channel_agents", ...)` with every column
      from `ChannelAgentDBA`/`DBE`, all constraints and the partial-unique
      default index.
- [ ] `op.create_table("channel_spaces", ...)`, constraints, GIN flags index.
- [ ] `op.create_table("channel_grants", ...)`, constraints, partial-unique
      default index.
- [ ] `op.create_table("channel_threads", ...)`, the non-unique current-thread
      index.
- [ ] `op.create_table("channel_inbox_events", ...)`, the connection+external
      unique constraint, the log index.
- [ ] `op.create_table("channel_inbox_triggers", ...)`, the thread+event
      unique constraint, the latest-offset index.
- [ ] `op.create_table("channel_outbox_events", ...)`, the key unique
      constraint, the created-sweep index.
- [ ] `op.create_table(...)` for WP7's identity table(s), per WP7's spec.
- [ ] `downgrade()`: drop every index then every table, in reverse dependency
      order (outbox/triggers/inbox before threads/grants before
      spaces/agents, WP7 tables last or first as WP7's FK direction requires).
- [ ] Test: `alembic upgrade head` then `alembic downgrade -1` against a
      throwaway database completes with no errors; `upgrade` again after
      `downgrade` also completes (idempotent round-trip).

## tests

- [ ] `api/oss/tests/pytest/unit/channels/test_channels_dtos.py` — the DTO
      instantiation test from the dtos section above.
- [ ] `api/oss/tests/pytest/unit/channels/test_channels_dao_inbox.py` —
      dedup contracts for `record_inbox_event`, `record_inbox_events`
      ordering, `query_events_since` range and origin ordering.
- [ ] `api/oss/tests/pytest/unit/channels/test_channels_dao_triggers.py` —
      `record_inbox_trigger` race/dedup, `fetch_latest_trigger` empty case,
      `transition_inbox_trigger` in-place update.
- [ ] `api/oss/tests/pytest/unit/channels/test_channels_dao_outbox.py` —
      `record_outbox_event` conflict-returns-existing-row, `transition_outbox_event`
      in-place update, one-row-for-its-life assertion across the full
      CREATED→SENT→edited sequence.
- [ ] `api/oss/tests/pytest/unit/channels/test_channels_default_indexes.py` —
      the two partial-unique-index rejection tests (grant default, agent
      default), asserting the database raises, not application code.
- [ ] `api/oss/tests/pytest/unit/channels/test_channels_resolve_policy.py` —
      every `resolve_policy` case listed in `specs-wp1.md`'s Tests section.
- [ ] `api/oss/tests/pytest/unit/channels/test_channels_compose_external_key.py`
      — determinism, distinctness, canonicalisation, `THREAD`-grain-with-no-
      declared-fields returns `None`, and missing-field raises
      `ChannelLocatorIncomplete`.
- [ ] DAO round-trip tests for every entity's create/fetch pair (agents,
      spaces, grants, threads at minimum — inbox/outbox already covered
      above).

## Definition of done

Feeds **C1**. Exit condition, verbatim from `plan.md`: *"a signed request to
`POST /channels/slack/events/` writes exactly one `channel_inbox_events`
row and answers 202; an unsigned one is rejected; a redelivery of the same
event writes no second row. Migration applies and downgrades. The contract
suite fails a deliberately lying fake adapter."*

WP1 is done when: the migration (`oss000000021`) applies and downgrades
cleanly against a throwaway database; the DAO round-trips every entity;
`record_inbox_event` returns `None` on a duplicate rather than raising; and a
policy denied at any one of the five levels (capability, channel, agent,
space, grant) stays denied regardless of how permissive the other levels are,
verified by the `resolve_policy` unit tests above.
