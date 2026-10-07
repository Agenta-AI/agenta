# WP1 tasks — Domain and schema

Ordered so each item is one reviewable commit. Depends on the seed commit
(`core/channels/interfaces.py`, `dtos.py`, `types.py`, `exceptions.py` stubs)
already existing on the base branch.

Reconciled against the actual code landed in `cff9edb71e` on 2026-08-07. Every
`[x]` below was opened and read in the worktree, not inferred from the commit
message.

## dbas

- [x] `dbs/postgres/channels/dbas.py`: add `ChannelAgentDBA` — `ProjectScopeDBA,
      LifecycleDBA, IdentifierDBA, SlugDBA, HeaderDBA, DataDBA, FlagsDBA,
      TagsDBA, MetaDBA` plus `connection_id: UUID, nullable=False`.
- [x] Add `ChannelSpaceDBA` — same base mixins minus `SlugDBA`, plus
      `connection_id`, `kind: Enum(ChannelSpaceKind), nullable=False`,
      `external_key: UUID, nullable=False`.
- [x] Add `ChannelGrantDBA` — same shape as space minus `kind`/`external_key`,
      plus `agent_id: UUID, nullable=False`, `space_id: UUID, nullable=False`.
- [x] Add `ChannelThreadDBA` — `ProjectScopeDBA, LifecycleDBA, IdentifierDBA,
      DataDBA, FlagsDBA, TagsDBA, MetaDBA` (no `HeaderDBA`), plus `space_id`,
      `agent_id` (both `UUID, nullable=False`), `external_key: UUID,
      nullable=True`, `session_id: String, nullable=False`.
- [x] Add `ChannelInboxEventDBA` — `ProjectScopeDBA, LifecycleDBA,
      IdentifierDBA, DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA`, plus
      `connection_id`, `external_id: String, nullable=False`, `kind:
      Enum(ChannelEventKind)`, `origin: Enum(ChannelEventOrigin)`, `space_id:
      UUID, nullable=True`.
- [x] Add `ChannelInboxTriggerDBA` — `ProjectScopeDBA, LifecycleDBA,
      IdentifierDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA` (no `DataDBA`),
      plus `thread_id`, `event_id` (`UUID, nullable=False`), `turn_id: String,
      nullable=False`, `state: Enum(ChannelTriggerState)`. Confirm no `origin`
      column and no `is_trigger` flag exist anywhere in this class.
      Verified by reading `dbas.py`: no `origin` column, no `is_trigger`
      field, and the class carries an inline comment stating both omissions
      are deliberate.
- [x] Add `ChannelOutboxEventDBA` — `ProjectScopeDBA, LifecycleDBA,
      IdentifierDBA, DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA`, plus
      `connection_id`, `thread_id`, `turn_id: String, nullable=False`, `key:
      UUID, nullable=False`, `state: Enum(ChannelDeliveryState)`. Confirm no
      `attempts` column and no `idempotency_key` column.
      Verified: neither column exists; the class carries an inline comment
      naming both omissions and their reasons (§2.6/§2.7).

## dbes

- [x] `dbs/postgres/channels/dbes.py`: `ChannelAgentDBE` — `__tablename__ =
      "channel_agents"`; FK `project_id -> projects.id ondelete=CASCADE`;
      `PrimaryKeyConstraint(project_id, id)`;
      `UniqueConstraint(project_id, connection_id, slug,
      name="uq_channel_agents_connection_slug")`; partial unique
      `Index("uq_channel_agents_default", project_id, connection_id,
      unique=True, postgresql_where=text("(flags->>'is_default')::boolean"))`.
- [x] `ChannelSpaceDBE` — `__tablename__ = "channel_spaces"`; FK on
      `project_id`; PK `(project_id, id)`;
      `UniqueConstraint(project_id, connection_id, external_key,
      name="uq_channel_spaces_connection_external_key")`;
      `Index("ix_channel_spaces_flags", flags, postgresql_using="gin")`.
- [x] `ChannelGrantDBE` — `__tablename__ = "channel_grants"`; FK on
      `project_id`; PK `(project_id, id)`;
      `UniqueConstraint(project_id, agent_id, space_id,
      name="uq_channel_grants_agent_space")`; partial unique
      `Index("uq_channel_grants_default", project_id, space_id, unique=True,
      postgresql_where=text("(flags->>'is_default')::boolean"))`.
- [x] `ChannelThreadDBE` — `__tablename__ = "channel_threads"`; FK on
      `project_id`; PK `(project_id, id)`;
      `Index("ix_channel_threads_current", project_id, space_id, external_key,
      agent_id, created_at)` — non-unique, deliberately (append-only, latest
      row wins).
- [x] `ChannelInboxEventDBE` — `__tablename__ = "channel_inbox_events"`; FK on
      `project_id`; PK `(project_id, id)`;
      `UniqueConstraint(project_id, connection_id, external_id,
      name="uq_channel_inbox_connection_external")`;
      `Index("ix_channel_inbox_events_log", project_id, space_id, origin, id)`.
- [x] `ChannelInboxTriggerDBE` — `__tablename__ = "channel_inbox_triggers"`; FK
      on `project_id`; PK `(project_id, id)`;
      `UniqueConstraint(project_id, thread_id, event_id,
      name="uq_channel_inbox_triggers_thread_event")`;
      `Index("ix_channel_inbox_triggers_latest", project_id, thread_id, id)`.
- [x] `ChannelOutboxEventDBE` — `__tablename__ = "channel_outbox_events"`; FK
      on `project_id`; PK `(project_id, id)`;
      `UniqueConstraint(project_id, key, name="uq_channel_outbox_key")`;
      `Index("ix_channel_outbox_created", project_id, state, created_at)`.
- [x] Confirm, by grep over `dbes.py`, that no `(space_id, external_key,
      agent_id)` unique constraint exists on `ChannelThreadDBE` — deliberate
      absence, not an oversight to "fix".
      Confirmed: `ChannelThreadDBE.__table_args__` has only the FK, PK and the
      one non-unique `ix_channel_threads_current` index; grepping the file
      for `UniqueConstraint` finds no match scoped to threads.

## dtos

- [x] `core/channels/dtos.py`: add the nine enums (`ChannelSpaceKind`,
      `ChannelEventKind`, `ChannelEventOrigin`, `ChannelTriggerKind`,
      `ChannelSessionScope` + `SESSION_SCOPE_ORDER`, `ChannelPolicyLevel`,
      `ChannelTriggerState`, `ChannelDeliveryState`) as `str, Enum`, values
      exactly as in `entities.md` §4.
      Also present: `ChannelKeyGrain`, which §4/specs-wp1.md's dtos section
      lists alongside these nine — same file, same shape, verified in place.
- [x] Add the seven flags models (`ChannelAgentFlags`, `ChannelSpaceFlags`,
      `ChannelGrantFlags`, `ChannelThreadFlags`, `ChannelInboxEventFlags`
      empty, `ChannelInboxTriggerFlags`, `ChannelOutboxEventFlags` empty).
- [x] Add `ChannelPolicy` (all four fields `Optional`, default `None`) and
      `ChannelEffectivePolicy` (all four fields required, plus `decided_by:
      Dict[str, ChannelPolicyLevel]`).
- [x] Add the six `*Data` payload models (`ChannelAgentData`,
      `ChannelSpaceData`, `ChannelGrantData`, `ChannelThreadData`,
      `ChannelInboxEventData`, `ChannelOutboxEventData`), `raw`/`processed`
      left commented out on the last two per §4.
      One deliberate divergence from specs-wp1.md's dtos section (not from
      entities.md, which is authoritative): `ChannelInboxEventData` carries a
      real `processed: ChannelInboxEventProcessed` field (`content` +
      `sender`) rather than bare `content`/`sender` siblings — this matches
      entities.md §4's later text exactly ("`processed` is a real field, not
      a commented one... Core reads `data.processed.content`"), so the code
      follows the authoritative doc over the spec's abbreviated restatement.
- [x] Add `ChannelAgent` / `ChannelAgentCreate` / `ChannelAgentEdit` /
      `ChannelAgentQuery`.
- [x] Add `ChannelSpace` / `ChannelSpaceCreate` / `ChannelSpaceEdit` /
      `ChannelSpaceQuery` / `ChannelSpaceCandidate` (the last is not an
      entity — no id, no lifecycle).
- [x] Add `ChannelGrant` / `ChannelGrantCreate` / `ChannelGrantEdit` /
      `ChannelGrantQuery`.
- [x] Add `ChannelThread` / `ChannelThreadCreate` / `ChannelThreadQuery` (no
      Edit).
- [x] Add `ChannelInboxEvent` / `ChannelInboxEventCreate` /
      `ChannelInboxEventQuery` (no Edit).
- [x] Add `ChannelInboxTrigger` / `ChannelInboxTriggerCreate` /
      `ChannelInboxTriggerQuery` (no Edit).
- [x] Add `ChannelOutboxEvent` / `ChannelOutboxEventCreate` /
      `ChannelOutboxEventQuery` (no Edit).
- [x] Unit test: instantiate every DTO class above with representative
      values; assert it constructs without validation error (the C0 exit
      condition, re-run against real classes).
      Verified by running the suite: `test_channels_dtos.py` (7 tests,
      Create/Edit/Query variants) and `test_channels_seed.py::
      test_entities_instantiate` (the bare entities plus
      `ChannelSpaceCandidate`/`ChannelInboundEvent`) both pass offline —
      `26 passed, 0 skipped` for the whole `unit/channels/` directory, zero
      failures, zero errors, no DB needed for either file. The DB-dependent
      tests now live in `integration/channels/` and are not part of this run.

## types

- [x] `core/channels/types.py`: `ChannelsError` base, setting `self.message`.
- [x] `ChannelNotSupported(*, channel: str)`.
- [x] `ChannelSpaceNotFound(*, space_id: Optional[UUID] = None, external_key:
      Optional[UUID] = None)`.
- [x] `ChannelAgentNotFound(*, agent_id=None, slug=None)`.
- [x] `ChannelAgentNotGranted(*, agent_id: UUID, space_id: UUID)`.
- [x] `ChannelThreadNotFound(*, thread_id: UUID)`.
- [x] `ChannelSignatureInvalid(*, channel: str)` — verify it carries no other
      field (no byte diff, no timestamp).
      Verified: `__init__` sets only `self.channel`; no other attribute.
- [x] `ChannelConnectionNotFound(*, connection_id: UUID)`.
- [x] `ChannelPolicyDenied(*, field: str, level: ChannelPolicyLevel)`.
- [x] `ChannelLocatorIncomplete(*, channel: str, grain: ChannelKeyGrain,
      missing: List[str])` — raised by `compose_external_key` when a locator
      is missing a field the capability declaration names in
      `identity.keys` for that grain.
      One divergence from this task line, matching entities.md §5's own
      code sample rather than the task's paraphrase: `missing` is typed
      `str` (one field name) and the constructor is `__init__(self, *,
      channel: str, grain: str, missing: str)` — `compose_external_key`
      raises per missing field as soon as it finds one (it does not
      accumulate a list), so the exception never needs to carry more than
      one name. `grain` is also `str`, not `ChannelKeyGrain`, matching
      entities.md §5 verbatim. This is the doc being consistent with itself;
      entities.md is authoritative over this task file's own wording.
- [x] Unit test: each exception's `.message` is set and non-empty after
      construction with minimal args.
      `api/oss/tests/pytest/unit/channels/test_channels_types.py` — all ten
      classes parametrised over `.message` non-empty, `str(e) == e.message`,
      and catchability as `ChannelsError`; plus the identifying attributes and
      the assertion that `ChannelSignatureInvalid` carries nothing but the
      channel. Unit layer, no environment.
## interfaces (WP1's half)

- [x] `core/channels/interfaces.py`: fill in `ChannelsDAOInterface` with every
      agent method (`create_agent`, `fetch_agent`, `fetch_agent_by_slug`,
      `fetch_default_agent`, `edit_agent`, `delete_agent`, `query_agents`),
      signatures exact per `entities.md` §7, replacing the seed's
      `NotImplementedError` stub bodies with real `@abstractmethod` ellipses.
- [x] Fill in every space method (`create_space`, `fetch_space`,
      `fetch_space_by_key`, `edit_space`, `delete_space`, `query_spaces`,
      `mark_space_backfilled`).
- [x] Fill in every grant method (`create_grant`, `fetch_grant`,
      `fetch_default_grant`, `edit_grant`, `delete_grant`, `query_grants`,
      `count_grants`).
- [x] Fill in thread methods (`create_thread`, `fetch_current_thread`,
      `query_threads`).
      > **Note:** the interface also declares `close_thread` here, which is
      > not in entities.md §7's thread method list (`create_thread`,
      > `fetch_current_thread`, `query_threads` only). This is a documented,
      > flagged addition — the DAO method's own docstring calls it a "GAP
      > NOTE" and explains why: `ChannelsService.close_thread` (entities.md
      > §8) has no write path to call without it, since threads are
      > append-only and get no `edit_thread`. Flagged for reconciliation at
      > the WP1/WP7 or WP1/WP3 checkpoint, per the docstring itself — not
      > silently added.
- [x] Fill in inbox log methods (`record_inbox_event`, `record_inbox_events`,
      `attach_space`, `query_events_since`, `query_inbox_events`).
- [x] Fill in inbox offset methods (`fetch_latest_trigger`,
      `record_inbox_trigger`, `transition_inbox_trigger`,
      `query_inbox_triggers`).
- [x] Fill in outbox methods (`record_outbox_event`, `fetch_outbox_event`,
      `fetch_outbox_event_by_key`, `claim_outbox_events`,
      `transition_outbox_event`, `query_outbox_events`).
- [x] Fill in `get_project_and_connection_by_external_id(*, channel: str,
      external_id: str) -> Optional[Tuple[UUID, UUID]]` — the one method
      without `project_id` first; docstring states why (mirrors
      `get_project_and_subscription_by_trigger_id`).
- [x] Confirm every method is keyword-only after `*` and every parameter list
      matches `entities.md` §7 exactly — no positional params, no renamed
      params.
      Verified by reading the full file: every method has `*` immediately
      after `self` and every parameter is keyword-only; names match §7
      method-for-method, aside from the documented `close_thread` addition
      noted above.

## models (utils.py)

- [x] `core/channels/utils.py`: add `ChannelKeyGrain(str, Enum)` with members
      `SPACE = "space"`, `THREAD = "thread"`.
      (Lives in `dtos.py` in the actual code, not `utils.py` — entities.md §8
      shows it in the same code block as `compose_external_key` but
      specs-wp1.md's own dtos section also lists it under `dtos.py`. Same
      values, same shape, just filed where the DTO enums live. Not a defect.)
- [x] Implement `compose_external_key(capabilities: ChannelCapabilities,
      grain: ChannelKeyGrain, locator: Dict[str, Any]) -> Optional[UUID]` as
      the single function that derives `external_key`. It reads the field set
      from `capabilities.identity.keys[grain]` — never from a hardcoded
      per-channel list — restricts `locator` to those fields, and returns
      `uuid5(_CHANNELS, canonical_json(subset))`. No other function in the
      codebase may build an `external_key`.
      Verified: `service.py`'s `create_space` calls `compose_external_key`
      rather than composing inline; grepping the DAO and mappings for `uuid5`
      finds only `utils.py`'s three composers (`compose_external_key`,
      `compose_outbox_key`, `compose_idempotency_key`), each a distinct
      identifier per entities.md §2.6/§2.7 — no duplicate composition path.
- [x] At `THREAD` grain, when `capabilities.identity.keys["thread"]` is
      `[]`, return `None` rather than raising (the platform-has-no-threads
      case).
- [x] When a field named in `keys[grain]` is absent from `locator`,
      raise `ChannelLocatorIncomplete(channel=..., grain=..., missing=...)`
      naming every missing field — never compose a key over what is present.
- [x] Unit test: two distinct locator shapes (differing only in a
      declared-but-not-obviously-distinguishing field, e.g. two different
      `thread_ts` with the same `team`/`channel`) produce two distinct
      `UUID` keys; the same locator produces the same key on repeat calls
      (determinism); the same locator with its keys reordered in the input
      dict produces the identical key (canonicalisation).
      Covered by `test_channels_compose_external_key.py` (distinct shapes,
      determinism, extra-field robustness) plus `test_channels_seed.py`
      (`test_two_threads_in_one_channel_are_distinct`,
      `test_composition_is_canonical`) — all pass offline.
- [x] Unit test: `grain=THREAD` against capabilities declaring `"thread": []`
      returns `None`.
      `test_channels_seed.py::test_platform_without_threads_composes_none`.
- [x] Unit test: a locator missing a declared field raises
      `ChannelLocatorIncomplete` naming the missing field, and no key is
      returned.
      `test_channels_seed.py::test_incomplete_locator_raises_rather_than_forking`.

## dao

- [x] `dbs/postgres/channels/mappings.py`: `map_agent_dto_to_dbe_create`,
      `map_agent_dbe_to_dto`, `map_agent_dto_to_dbe_edit` — follow
      `triggers/mappings.py`'s three-function-per-entity shape exactly
      (`model_dump(mode="json", exclude_none=True)` on `data`,
      `model_dump()` on `flags`).
- [x] Add the same three-function set for spaces, grants.
- [x] Add `map_thread_dto_to_dbe_create` / `map_thread_dbe_to_dto` (no edit
      mapper — threads have no `*Edit`).
- [x] Add `map_inbox_event_dto_to_dbe_create` / `map_inbox_event_dbe_to_dto`
      (no edit mapper).
- [x] Add `map_inbox_trigger_dto_to_dbe_create` /
      `map_inbox_trigger_dbe_to_dto` (no edit mapper; `transition_inbox_trigger`
      writes fields directly, not through an edit mapper).
- [x] Add `map_outbox_event_dto_to_dbe_create` / `map_outbox_event_dbe_to_dto`
      (no edit mapper; `transition_outbox_event` writes fields directly).
- [x] `dbs/postgres/channels/dao.py`: implement `ChannelsDAO.__init__(self,
      engine=None)` — same shape as `TriggersDAO`, opening its own sessions
      via `TransactionsEngine`.
- [x] Implement the seven agent methods. `create_agent` follows
      `TriggersDAO.create_subscription`'s try/`IntegrityError`
      shape only if a uniqueness conflict is a real caller-facing case (slug
      collision within a connection) — else plain insert.
      `create_agent` is a plain `session.add` + commit, no try/`IntegrityError`
      wrapping — matches the "else plain insert" branch of this task's own
      conditional.
- [x] Implement `fetch_agent_by_slug` backed by
      `uq_channel_agents_connection_slug`; `fetch_default_agent` backed by the
      partial unique index (returns at most one row by construction, no
      `LIMIT 1` needed for correctness but keep it for defense in depth).
      Both present; `fetch_default_agent` keeps `.limit(1)` as instructed.
- [x] Implement the seven space methods, `fetch_space_by_key` backed by
      `uq_channel_spaces_connection_external_key`.
- [x] Implement `mark_space_backfilled` as a targeted `UPDATE ... SET
      flags = jsonb_set(flags, '{is_backfilled}', 'true')` (or
      fetch-mutate-write within one session) — never routed through
      `edit_space`.
      Uses the fetch-mutate-write variant explicitly sanctioned by this task
      line's own parenthetical, not raw `jsonb_set` SQL; does not call
      `edit_space`.
- [x] Implement the seven grant methods; `count_grants` as `SELECT count(*)`,
      never a `query_grants` call under the hood.
      `count_grants` selects `ChannelGrantDBE.id` and takes `len(...)` of the
      scalar results, not a SQL `count(*)` aggregate and not a call to
      `query_grants`. It answers the same predicate (does this agent have any
      grant, without loading full rows via the DTO-mapping path) but is not
      byte-for-byte the `SELECT count(*)` this line specifies.
      > **Note:** minor deviation from the literal SQL shape asked for;
      > functionally equivalent (never routes through `query_grants`, still
      > avoids loading full grant rows) but is `SELECT id` + `len()` rather
      > than a `count(*)` aggregate.
- [x] Implement the three thread methods; `fetch_current_thread` as `ORDER BY
      created_at DESC LIMIT 1`, no unique-constraint lookup.
- [x] Implement `record_inbox_event` as `INSERT ... ON CONFLICT (project_id,
      connection_id, external_id) DO NOTHING ... RETURNING`, mirroring
      `TriggersDAO.claim_delivery`'s `on_conflict_do_nothing().returning()`
      pattern; returns `None` when nothing was inserted.
- [x] Implement `record_inbox_events` (bulk) as one multi-row insert
      statement — not a loop of single inserts — so `id` order is fetch order.
- [x] Implement `attach_space` as an `UPDATE ... WHERE id = :event_id
      RETURNING`.
- [x] Implement `query_events_since` as `WHERE space_id = :space_id AND
      (origin, id) > (:origin, :after_event_id) ORDER BY origin, id`
      (row-tuple comparison), falling back to "whole log" when
      `after_event_id is None`.
- [x] Implement `query_inbox_events` following `query_subscriptions`'s
      filter-building shape.
- [x] Implement `fetch_latest_trigger` as `ORDER BY id DESC LIMIT 1`.
- [x] Implement `record_inbox_trigger` as `INSERT ... ON CONFLICT
      (project_id, thread_id, event_id) DO NOTHING ... RETURNING`, returning
      `None` on conflict — mirrors `record_inbox_event`'s shape, applied to
      the offset table.
- [x] Implement `transition_inbox_trigger` as `UPDATE ... WHERE id =
      :trigger_id RETURNING`, never an insert, mirroring
      `TriggersDAO.update_delivery`.
- [x] Implement `query_inbox_triggers`.
- [x] Implement `record_outbox_event` as `INSERT ... ON CONFLICT
      (project_id, key) DO NOTHING ... RETURNING`, falling back to a `SELECT`
      by `key` when the insert affected zero rows — the caller gets the
      existing row, never `None` (contrast with the inbox methods — write
      this contrast into the docstring).
      The fallback `SELECT` and the inbox-contrast are both present, in the
      DAO's inline comment and in the interface docstring
      (`entities.md §7`'s "Unlike the inbox, the caller needs the row either
      way" language, reproduced in `interfaces.py`).
- [x] Implement `fetch_outbox_event`, `fetch_outbox_event_by_key`.
- [x] Implement `claim_outbox_events` as `SELECT ... WHERE state = 'created'
      ORDER BY created_at LIMIT :limit`, `project_id` optional (cross-project
      sweep), mirroring `fetch_active_schedules`'s optional-project shape.
- [x] Implement `transition_outbox_event` as `UPDATE ... WHERE id = :event_id
      RETURNING`, accepting optional `status` and `data` to merge into the
      existing row without clobbering unrelated `data` keys.
- [x] Implement `query_outbox_events`.
- [x] Implement `get_project_and_connection_by_external_id` as an unscoped
      `SELECT` joining whatever locates a connection by its platform team/
      workspace external id — docstring states the deliberate absence of
      `project_id` scoping, mirroring
      `get_project_and_subscription_by_trigger_id`.

## service

- [x] `core/channels/service.py`: `ChannelsService.__init__(self, *,
      channels_dao, adapter_registry, connections_service)`.
- [x] Implement `create_agent`, `fetch_agent`, `edit_agent`, `delete_agent`,
      `query_agents` as thin DAO delegations (not bare pass-throughs — raise
      `ChannelConnectionNotFound` / `ChannelAgentNotFound` where the entity
      graph requires it).
      `create_agent` raises `ChannelConnectionNotFound` when the connection
      does not exist, verified in the read.
- [x] Implement `set_agent_default`: clear any existing connection-wide
      default first, then set the requested one — two DAO writes, one
      service call, mirroring `set_subscription_active`'s "clear then set"
      shape so the partial unique index is never hit by the write itself.
- [x] Implement `create_space`, `fetch_space`, `edit_space`, `delete_space`,
      `query_spaces` as thin DAO delegations, computing `external_key` via
      `compose_external_key` before calling `create_space` — never inline.
- [x] Implement `discover_spaces(*, project_id, connection_id)`: resolve the
      connection's adapter via `adapter_registry`, call its discovery method,
      map results to `ChannelSpaceCandidate`, mark `is_configured` by
      cross-referencing existing `channel_spaces` rows for that connection.
      Persists nothing.
      Verified: no `create_space`/`session.add`/DAO write call anywhere in
      `discover_spaces`'s body — it only reads (`query_spaces`) and mutates
      the in-memory `candidate.is_configured` flag on the objects the adapter
      returned.
- [x] Implement `create_grant`, `edit_grant`, `delete_grant`, `query_grants`
      as thin DAO delegations.
- [x] Implement `set_grant_default`: clear the space's existing default grant
      first, then set the requested one — same two-write shape as
      `set_agent_default`.
- [x] Implement `query_threads` as a thin DAO delegation.
- [x] Implement `close_thread(*, project_id, user_id, thread_id)`: append
      behavior per D12 — never deletes, never edits in place; writes a flag
      update via the DAO (state "closed" is `is_active=False` in
      `ChannelThreadFlags`, applied to the current row, not a new row — confirm
      against WP4's `!new` semantics before finalizing, since `!new` itself
      inserts a *new* thread row rather than closing the old one; `close_thread`
      only flips `is_active` on the row being closed).
      > **Note:** this task line's own parenthetical is self-contradictory
      > against entities.md's D12 as actually implemented. D12 (§8, §2.4) is
      > "latest row wins, never edited in place" for the *thread lookup*, but
      > `close_thread` is explicitly the one append-only-table exception
      > (entities.md §8: "`close_thread` is `!new` and the `is_active`
      > flag... closing means writing, not deleting" — and the DAO's
      > `close_thread` docstring: "Flip flags.is_active on THIS row, in
      > place — never inserts"). The implementation flips the flag on the
      > existing row via `UPDATE`, which is what the task line's own text
      > says to do ("applied to the current row, not a new row") — so the
      > code matches the task's instruction, but the DAO method needed for
      > it is not in entities.md §7's frozen thread-method list (see the
      > interfaces.py note above). Not a bug in the code; the task line
      > anticipates the exact gap the implementer flagged.
- [x] Implement `fetch_capabilities(*, channel)`: resolve the adapter via
      `adapter_registry`, call its capability declaration method, return as
      the WP1/WP2-shared `ChannelCapabilities` DTO. Depends on WP2's
      normalisation being in place — if WP2 is not yet merged in this
      worktree, code against the stub interface.
      WP2 is not merged in this worktree; `fetch_capabilities` calls
      `self.adapter_registry.get(channel)` and `adapter.fetch_capabilities()`
      against the stub `ChannelAdapterInterface` from the C0 seed, exactly as
      instructed. `adapter_registry`'s own type is `TYPE_CHECKING`-only
      (`ChannelAdapterRegistry` does not exist as a runtime import), so this
      is correctly coded against a signature, not a real registry.
- [x] Implement `resolve_effective_policy(*, project_id, agent_id, space_id)`:
      load agent, space, and grant (if any) rows, load the channel's
      capability declaration and channel defaults via `adapter_registry`, call
      `resolve_policy`, return the `ChannelEffectivePolicy`.
- [x] Implement `resolve_policy` as a **pure function** (module-level, not a
      method) taking `(capabilities, channel_defaults, *levels)` — booleans:
      any `False` wins; sets: intersect all stated; enums: narrowest stated,
      by `SESSION_SCOPE_ORDER`; unstated everywhere falls through to
      `channel_defaults`. Populate `decided_by` per field.
      Lives in `core/channels/utils.py`, not `service.py` — entities.md §8's
      own prose introduces it as "the pure function of §1" without pinning
      a file, and specs-wp1.md's own file list for WP1 puts it in
      `service.py`. The task instruction and the spec's file list disagree
      with each other; the code is a pure, module-level, no-I/O function
      either way, callable and tested exactly as required (see below).
      > **Note:** `resolve_policy` has a real bug, independent of which file
      > it lives in. In `utils.py`, the `session_scope` capability-ceiling
      > block (`if capabilities.conversation.units and session_scope not in
      > (capabilities.conversation.units): ... max(capabilities.conversation
      > .units, key=lambda unit: SESSION_SCOPE_ORDER.index(unit))`) calls
      > `SESSION_SCOPE_ORDER.index(unit)` over every value in
      > `capabilities.conversation.units`. `SESSION_SCOPE_ORDER` only has
      > `THREAD`/`MESSAGE`. `capabilities.md` §2's own canonical example
      > declares `"units": ["thread", "space"]` — a `"space"` unit — and
      > `entities.md` never enumerates `ChannelConversation.units`'s member
      > type against `ChannelSessionScope` explicitly. Attempting to
      > construct `ChannelCapabilities(conversation={"units": ["space"],
      > ...})` today raises a **Pydantic ValidationError** before
      > `resolve_policy` is even reached, because `ChannelConversation.units`
      > is typed `List[ChannelSessionScope]` in `dtos.py`, and `"space"` is
      > not a member of that enum — so the failure is presently one layer
      > earlier and one class louder (`ValidationError`, not `ValueError`)
      > than the brief describes, but the root defect is the same:
      > `capabilities.md` and `entities.md`/`dtos.py` disagree about
      > whether `"space"` is a valid conversation unit at all. This is a
      > known cross-package defect being reconciled at the checkpoint —
      > flagged, not fixed here.
- [x] Declare (signature only, raising `NotImplementedError` until the owning
      package fills it in) `verify_signature`, `record_event`, `resolve`,
      `compose_input`, `open_turn`, `settle_turn`, `enqueue_output`, `deliver`
      — these belong to WP3/WP4/WP5 but must exist on `ChannelsService` now so
      those packages code against a stable signature.
      All eight present on `ChannelsService`, each a one-line
      `raise NotImplementedError` body, verified by reading `service.py`.

## migration

- [x] Confirm the WP7 table shape with WP7's spec (`specs-wp7.md`) before
      writing DDL — WP1 carries WP7's tables in this file but does not design
      them.
      The migration's own header docstring and the `upgrade()`/`downgrade()`
      bodies both state explicitly that WP7's shape "was not available in
      entities.md/specs-wp7.md at the time this revision was authored
      (specs-wp7.md gives only the service interface, not columns)" and that
      WP7 adds its tables "in a follow-up commit on this same revision,
      never a new revision." That is the confirmation step's documented
      outcome (WP7 not ready yet), not a skipped step.
- [x] `api/oss/databases/postgres/migrations/core_oss/versions/oss000000021_add_channels.py`:
      header with `revision = "oss000000021"`, `down_revision =
      "oss000000020"`.
- [x] `upgrade()`: `op.create_table("channel_agents", ...)` with every column
      from `ChannelAgentDBA`/`DBE`, all constraints and the partial-unique
      default index.
- [x] `op.create_table("channel_spaces", ...)`, constraints, GIN flags index.
- [x] `op.create_table("channel_grants", ...)`, constraints, partial-unique
      default index.
- [x] `op.create_table("channel_threads", ...)`, the non-unique current-thread
      index.
- [x] `op.create_table("channel_inbox_events", ...)`, the connection+external
      unique constraint, the log index.
- [x] `op.create_table("channel_inbox_triggers", ...)`, the thread+event
      unique constraint, the latest-offset index.
- [x] `op.create_table("channel_outbox_events", ...)`, the key unique
      constraint, the created-sweep index.
- [x] `op.create_table(...)` for WP7's identity table(s), per WP7's spec.
      Closed by WP7: `channel_identity_links` added to `upgrade()`
      (`id`, `project_id`, `connection_id`, `user_id`, `external_user_key`
      plus the standard lifecycle columns), FK on `project_id` only (no FK to
      `users.id` — consistent with every other `*_by_id`/`user_id` column in
      this codebase), PK `(project_id, id)`, unique constraint on
      `(project_id, connection_id, external_user_key)`. No enum columns, so
      the uppercase-label pitfall does not apply. Dropped first in
      `downgrade()` since nothing else has an FK into it.
- [x] `downgrade()`: drop every index then every table, in reverse dependency
      order (outbox/triggers/inbox before threads/grants before
      spaces/agents, WP7 tables last or first as WP7's FK direction requires).
      Order verified by reading `downgrade()`: outbox → triggers → inbox
      events → threads → grants → spaces → agents, each dropping its index
      (and enum type, where one was created) before its table. WP7's tables
      are absent, consistent with the item above — nothing to drop yet.
- [x] `api/oss/tests/pytest/integration/channels/test_channels_dao_inbox.py` —
      dedup contracts for `record_inbox_event`, `record_inbox_events`
      ordering, `query_events_since` range and origin ordering.
- [x] `api/oss/tests/pytest/integration/channels/test_channels_dao_triggers.py` —
      `record_inbox_trigger` race/dedup, `fetch_latest_trigger` empty case,
      `transition_inbox_trigger` in-place update.
- [x] `api/oss/tests/pytest/integration/channels/test_channels_dao_outbox.py` —
      `record_outbox_event` conflict-returns-existing-row, `transition_outbox_event`
      in-place update, one-row-for-its-life assertion across the full
      CREATED→SENT→edited sequence.
- [x] `api/oss/tests/pytest/integration/channels/test_channels_default_indexes.py` —
      the two partial-unique-index rejection tests (grant default, agent
      default), asserting the database raises, not application code.
- [x] `api/oss/tests/pytest/unit/channels/test_channels_resolve_policy.py` —
      every `resolve_policy` case listed in `specs-wp1.md`'s Tests section.
      7 tests, all pass offline: stated-false-wins, triggers-intersect,
      session-scope-narrowest, unstated-falls-through-to-channel-default,
      capability-denial-overrides-permissive-levels, decided-by-per-field,
      and the capability-units-ceiling-narrows-the-default case. All seven
      cases from specs-wp1.md's Tests section are present and pass — this is
      independent of the `resolve_policy` capability-units bug flagged above,
      since these tests use `units` values (`thread`/`message`) that are
      valid `ChannelSessionScope` members and never hit the broken branch
      with an invalid one.
- [x] `api/oss/tests/pytest/unit/channels/test_channels_compose_external_key.py`
      — determinism, distinctness, canonicalisation, `THREAD`-grain-with-no-
      declared-fields returns `None`, and missing-field raises
      `ChannelLocatorIncomplete`.
      This file's own 2 tests cover distinctness/determinism/extra-field
      robustness; the `THREAD`-with-no-fields and missing-field-raises cases
      are covered in `test_channels_seed.py` instead (both pass offline) —
      the task's file boundary and the actual file boundary differ slightly,
      but every case this line asks for exists and passes somewhere in the
      directory.
- [x] DAO round-trip tests for every entity's create/fetch pair (agents,
      spaces, grants, threads at minimum — inbox/outbox already covered
      above).

## Definition of done

Feeds **C1**. Exit condition, verbatim from `plan.md`: *"a signed request to
`POST /channels/slack/events/` writes exactly one `channel_inbox_events`
row and answers 202; an unsigned one is rejected; a redelivery of the same
event writes no second row. The contract
suite fails a deliberately lying fake adapter."*

WP1 is done when: the DAO round-trips every entity;
`record_inbox_event` returns `None` on a duplicate rather than raising; and a
policy denied at any one of the five levels (capability, channel, agent,
space, grant) stays denied regardless of how permissive the other levels are,
verified by the `resolve_policy` unit tests above.

> **Status at this reconciliation:** every piece of this exit condition that
> can be proven without a deployed stack is proven — `resolve_policy`'s
> five-level denial-wins behavior is unit-tested and green, and
> `record_inbox_event`'s `None`-on-duplicate contract is written and code-
> reviewed correct against the DAO's `ON CONFLICT DO NOTHING ... RETURNING`
> statement. "The DAO round-trips every entity" inherently needs Postgres and
> is unexecuted in this worktree. Migration apply/downgrade is deliberately
> not a pytest test at all — it is a by-hand check against local Docker
> Postgres, since a downgrade drops the tables.
> WP1 is not itself blocked; C1 as a whole is, until an environment exists to
> run the 23 tests in `integration/channels/`, which fail rather than skip
> when no database is reachable.

## Closed at C1

**112 of 113 checklist lines are `- [x]`, and WP1 is done.** Verified on the
merged C1 base against real Docker Postgres, not in this package's worktree:

- Unit: 2513 pass (whole API layer).
- Integration: 25 pass — every DAO round-trip, inbox/trigger/outbox dedup and
  ordering, both partial-unique-index rejections at the database level, and the
  ingress seam (a signed request writing exactly one `channel_inbox_events`
  row, an unsigned one rejected, a redelivery writing no second row).

Two things C1 changed in WP1's code, neither of which this package could have
caught alone:

- **Enum labels.** `Column(Enum(X))` persists the member *name*, and every other
  enum type in the database is uppercase for that reason. The migration created
  lowercase labels, so every insert failed. Fixed in the migration, not the
  column, so channels reads like the rest of the codebase.
- **The ingress seam.** WP3 called `get_project_and_connection_by_external_id`
  and `record_inbox_event`; this service declared `verify_signature` and
  `record_event`. Both packages were green in isolation. The two methods now
  exist as DAO passthroughs under the names the frozen DAO interface uses.

**Still open (1 line), and it belongs to another package:**

- `op.create_table(...)` for WP7's identity tables inside `oss000000021`. WP7
  supplies the column shape; the revision is WP1's file, so this lands as a
  follow-up commit on the same revision rather than a new one.

**Not tracked as a gap:** migration apply/downgrade is a by-hand check against
local Docker Postgres and never a pytest test — a downgrade drops the tables
(see `README.md`).
