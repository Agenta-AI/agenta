# WP1 — Domain and schema

Delivers the channels domain's data model end to end: the seven new tables (plus
WP7's two identity tables, riding the same migration) and the full stack around
them — dbas, dbes, dtos, types, dao, service — following the `triggers` domain's
layering exactly. Includes the one core function that composes an `external_key`
(a `uuid5`) from a structured locator, and `resolve_policy`, the pure intersection function
that computes a `ChannelEffectivePolicy` from the capability declaration, the
channel defaults, and the agent/space/grant policy documents. Excludes routers
(WP8) and anything adapter-shaped (WP2).

## Files

New:
- `api/oss/src/core/channels/dtos.py` — enums, flags, data payloads, entity DTOs (§4)
- `api/oss/src/core/channels/types.py` — domain exceptions (§5)
- `api/oss/src/core/channels/interfaces.py` — `ChannelsDAOInterface` (§7); shares
  this file with WP2's `ChannelAdapterInterface` per the seed commit — WP1 owns
  the file, WP2's half is frozen after C0 and edited only at a checkpoint
- `api/oss/src/core/channels/service.py` — `ChannelsService`, `resolve_policy` (§8)
- `api/oss/src/core/channels/utils.py` — `compose_external_key`, `ChannelKeyGrain` (§2.2)
- `api/oss/src/dbs/postgres/channels/dbas.py` — abstract mixins (§2)
- `api/oss/src/dbs/postgres/channels/dbes.py` — concrete entities + constraints (§3)
- `api/oss/src/dbs/postgres/channels/dao.py` — `ChannelsDAO` (§7)
- `api/oss/src/dbs/postgres/channels/mappings.py` — DBE <-> DTO
- `api/oss/databases/postgres/migrations/core_oss/versions/oss000000021_add_channels.py`
  — the one migration; creates all seven channel tables AND WP7's two identity
  tables (`channel_identity_links` and whatever companion table WP7's spec
  names) in the same revision, per the workstreams README collision table

Edited: none. This package touches no file another package owns.

## Interfaces

Reproduced verbatim from `entities.md` §4, §5, §7, §8. Do not rename, do not add
parameters not listed here.

### dtos.py — enums (§4)

```python
class ChannelSpaceKind(str, Enum):
    PRIVATE = "private"
    GROUP   = "group"
    TOPIC   = "topic"

class ChannelEventKind(str, Enum):
    MESSAGE = "message"
    ACTION  = "action"

class ChannelEventOrigin(str, Enum):
    PULLED = "pulled"
    PUSHED = "pushed"

class ChannelTriggerKind(str, Enum):
    MENTION = "mention"
    COMMAND = "command"
    ACTION  = "action"

class ChannelSessionScope(str, Enum):
    THREAD  = "thread"
    MESSAGE = "message"

SESSION_SCOPE_ORDER = [ChannelSessionScope.THREAD, ChannelSessionScope.MESSAGE]

class ChannelKeyGrain(str, Enum):
    """The two grains `external_key` is composed at (§2.2)."""
    SPACE  = "space"
    THREAD = "thread"

class ChannelPolicyLevel(str, Enum):
    CAPABILITY = "capability"
    CHANNEL    = "channel"
    AGENT      = "agent"
    SPACE      = "space"
    GRANT      = "grant"

class ChannelTriggerState(str, Enum):
    STARTED = "started"
    SETTLED = "settled"
    REFUSED = "refused"
    FAILED  = "failed"

class ChannelDeliveryState(str, Enum):
    CREATED   = "created"
    SENT      = "sent"
    FAILED    = "failed"
    ABANDONED = "abandoned"
```

There is no `ChannelInboxState` and no `ChannelBackfillState` — do not add them.

### dtos.py — flags

```python
class ChannelAgentFlags(BaseModel):
    is_active: bool = True
    is_default: bool = False

class ChannelSpaceFlags(BaseModel):
    is_active:     bool = True
    is_backfilled: bool = False

class ChannelGrantFlags(BaseModel):
    is_default: bool = False

class ChannelThreadFlags(BaseModel):
    is_active: bool = True

class ChannelInboxEventFlags(BaseModel):
    pass  # empty, deliberately — see entities.md §4

class ChannelInboxTriggerFlags(BaseModel):
    is_backfilled: bool = False

class ChannelOutboxEventFlags(BaseModel):
    pass  # empty, deliberately
```

No `is_trigger` flag anywhere.

### dtos.py — policy documents

```python
class ChannelPolicy(BaseModel):
    triggers:      Optional[Set[ChannelTriggerKind]] = None
    session_scope: Optional[ChannelSessionScope] = None
    backfill:      Optional[bool]                = None
    forwardfill:   Optional[bool]                = None

class ChannelEffectivePolicy(BaseModel):
    triggers:      Set[ChannelTriggerKind]
    session_scope: ChannelSessionScope
    backfill:      bool
    forwardfill:   bool
    decided_by:    Dict[str, ChannelPolicyLevel]
```

### dtos.py — data payloads

```python
class ChannelAgentData(BaseModel):
    references: Dict[str, Reference]
    policy:     Optional[ChannelPolicy] = None

class ChannelSpaceData(BaseModel):
    external_locator: Dict[str, Any]
    policy:           Optional[ChannelPolicy] = None

class ChannelGrantData(BaseModel):
    policy: Optional[ChannelPolicy] = None

class ChannelThreadData(BaseModel):
    external_locator: Optional[Dict[str, Any]] = None

class ChannelInboxEventData(BaseModel):
    external_locator: Dict[str, Any]
    content:          List[Dict[str, Any]]
    sender:           Dict[str, Any]
    # raw / processed stay commented out — do not add them (entities.md §4)

class ChannelOutboxEventData(BaseModel):
    external_locator: Optional[Dict[str, Any]] = None
    # raw / processed stay commented out
```

No `ChannelInboxTriggerData` — the trigger row has no data payload.

### dtos.py — entity DTOs and variants

Four classes per entity (`X`, `XCreate`, `XEdit`, `XQuery`), reproduced exactly
as in `entities.md` §4 for: `ChannelAgent`, `ChannelSpace` (plus
`ChannelSpaceCandidate`, not an entity), `ChannelGrant`, `ChannelThread` (no
Edit), `ChannelInboxEvent` (no Edit), `ChannelInboxTrigger` (no Edit),
`ChannelOutboxEvent` (no Edit). Copy the class bodies from `entities.md` §4
verbatim — field names, types, and defaults are exact, not illustrative.

### dbas.py (§2)

```python
class ChannelAgentDBA(ProjectScopeDBA, LifecycleDBA, IdentifierDBA, SlugDBA,
                       HeaderDBA, DataDBA, FlagsDBA, TagsDBA, MetaDBA):
    __abstract__ = True
    connection_id = Column(UUID, nullable=False)

class ChannelSpaceDBA(ProjectScopeDBA, LifecycleDBA, IdentifierDBA,
                       HeaderDBA, DataDBA, FlagsDBA, TagsDBA, MetaDBA):
    __abstract__ = True
    connection_id = Column(UUID, nullable=False)
    kind          = Column(Enum(ChannelSpaceKind), nullable=False)
    external_key  = Column(UUID, nullable=False)

class ChannelGrantDBA(ProjectScopeDBA, LifecycleDBA, IdentifierDBA,
                       HeaderDBA, DataDBA, FlagsDBA, TagsDBA, MetaDBA):
    __abstract__ = True
    agent_id = Column(UUID, nullable=False)
    space_id = Column(UUID, nullable=False)

class ChannelThreadDBA(ProjectScopeDBA, LifecycleDBA, IdentifierDBA,
                        DataDBA, FlagsDBA, TagsDBA, MetaDBA):
    __abstract__ = True
    space_id     = Column(UUID,   nullable=False)
    agent_id     = Column(UUID,   nullable=False)
    external_key = Column(UUID,   nullable=True)
    session_id   = Column(String, nullable=False)

class ChannelInboxEventDBA(ProjectScopeDBA, LifecycleDBA, IdentifierDBA,
                            DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA):
    __abstract__ = True
    connection_id = Column(UUID,   nullable=False)
    external_id   = Column(String, nullable=False)
    kind          = Column(Enum(ChannelEventKind), nullable=False)
    origin        = Column(Enum(ChannelEventOrigin), nullable=False)
    space_id      = Column(UUID,   nullable=True)

class ChannelInboxTriggerDBA(ProjectScopeDBA, LifecycleDBA, IdentifierDBA,
                              StatusDBA, FlagsDBA, TagsDBA, MetaDBA):
    __abstract__ = True
    thread_id = Column(UUID,   nullable=False)
    event_id  = Column(UUID,   nullable=False)
    turn_id   = Column(String, nullable=False)
    state     = Column(Enum(ChannelTriggerState), nullable=False)
    # no origin, no is_trigger, no DataDBA — see entities.md §2

class ChannelOutboxEventDBA(ProjectScopeDBA, LifecycleDBA, IdentifierDBA,
                             DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA):
    __abstract__ = True
    connection_id = Column(UUID,   nullable=False)
    thread_id     = Column(UUID,   nullable=False)
    turn_id       = Column(String, nullable=False)
    key           = Column(UUID,   nullable=False)
    state         = Column(Enum(ChannelDeliveryState), nullable=False)
```

### dbes.py (§3)

Concrete `Base`-inheriting classes adding `__tablename__` and `__table_args__` —
`ForeignKeyConstraint`, `PrimaryKeyConstraint`, `UniqueConstraint`, `Index` —
exactly as listed in `entities.md` §3 for `ChannelAgentDBE`, `ChannelSpaceDBE`,
`ChannelGrantDBE`, `ChannelThreadDBE`, `ChannelInboxEventDBE`,
`ChannelInboxTriggerDBE`, `ChannelOutboxEventDBE`. Reproduce every index and
constraint listed there — none is decorative:

- `uq_channel_agents_connection_slug`, `uq_channel_agents_default` (partial, on `flags->>'is_default'`)
- `uq_channel_spaces_connection_external_key`, `ix_channel_spaces_flags` (GIN)
- `uq_channel_grants_agent_space`, `uq_channel_grants_default` (partial)
- `ix_channel_threads_current` (`project_id, space_id, external_key, agent_id, created_at`) — no unique constraint on this tuple, deliberately
- `uq_channel_inbox_connection_external`, `ix_channel_inbox_events_log` (`project_id, space_id, origin, id`)
- `uq_channel_inbox_triggers_thread_event`, `ix_channel_inbox_triggers_latest` (`project_id, thread_id, id`)
- `uq_channel_outbox_key`, `ix_channel_outbox_created` (`project_id, state, created_at`)

### types.py (§5)

```python
class ChannelsError(Exception):
    def __init__(self, message: str = "Channels error"): ...

class ChannelNotSupported(ChannelsError):
    def __init__(self, *, channel: str): ...

class ChannelSpaceNotFound(ChannelsError):
    def __init__(self, *, space_id: Optional[UUID] = None, external_key: Optional[UUID] = None): ...

class ChannelAgentNotFound(ChannelsError):
    def __init__(self, *, agent_id: Optional[UUID] = None, slug: Optional[str] = None): ...

class ChannelAgentNotGranted(ChannelsError):
    def __init__(self, *, agent_id: UUID, space_id: UUID): ...

class ChannelThreadNotFound(ChannelsError):
    def __init__(self, *, thread_id: UUID): ...

class ChannelSignatureInvalid(ChannelsError):
    def __init__(self, *, channel: str): ...

class ChannelConnectionNotFound(ChannelsError):
    def __init__(self, *, connection_id: UUID): ...

class ChannelPolicyDenied(ChannelsError):
    def __init__(self, *, field: str, level: ChannelPolicyLevel): ...

class ChannelLocatorIncomplete(ChannelsError):
    def __init__(self, *, channel: str, grain: ChannelKeyGrain, missing: List[str]): ...
```

Every subclass sets `self.message` plus its identifying attribute(s) in
`__init__`, per D31. `ChannelSignatureInvalid` carries nothing else — no byte
diff, no timestamp detail. `ChannelLocatorIncomplete` is raised by
`compose_external_key` when a locator is missing a field the capability
declaration names in `identity.keys` for that grain — it must never
compose a key over what happens to be present.

### interfaces.py — `ChannelsDAOInterface` (§7)

All methods `@abstractmethod`, keyword-only after `*`, `project_id: UUID` first
except the one unscoped ingress read. Reproduce every method in `entities.md`
§7 with its exact signature and docstring intent — the list, not a summary:

Agents: `create_agent`, `fetch_agent`, `fetch_agent_by_slug`,
`fetch_default_agent`, `edit_agent`, `delete_agent`, `query_agents`.

Spaces: `create_space`, `fetch_space`, `fetch_space_by_key`, `edit_space`,
`delete_space`, `query_spaces`, `mark_space_backfilled`.

Grants: `create_grant`, `fetch_grant`, `fetch_default_grant`, `edit_grant`,
`delete_grant`, `query_grants`, `count_grants`.

Threads: `create_thread`, `fetch_current_thread`, `query_threads`.

Inbox log: `record_inbox_event`, `record_inbox_events`, `attach_space`,
`query_events_since`, `query_inbox_events`.

Inbox offsets: `fetch_latest_trigger`, `record_inbox_trigger`,
`transition_inbox_trigger`, `query_inbox_triggers`.

Outbox: `record_outbox_event`, `fetch_outbox_event`,
`fetch_outbox_event_by_key`, `claim_outbox_events`, `transition_outbox_event`,
`query_outbox_events`.

Ingress (the one unscoped read): `get_project_and_connection_by_external_id(*, channel: str, external_id: str) -> Optional[Tuple[UUID, UUID]]`.

Full signatures — copy verbatim, including return types and docstrings, from
`entities.md` §7. In particular:

```python
@abstractmethod
async def record_inbox_event(
    self, *, project_id: UUID, event: ChannelInboxEventCreate,
) -> Optional[ChannelInboxEvent]: ...

@abstractmethod
async def query_events_since(
    self, *, project_id: UUID, space_id: UUID,
    after_event_id: Optional[UUID], limit: Optional[int] = None,
) -> List[ChannelInboxEvent]: ...

@abstractmethod
async def record_inbox_trigger(
    self, *, project_id: UUID, trigger: ChannelInboxTriggerCreate,
) -> Optional[ChannelInboxTrigger]: ...

@abstractmethod
async def transition_inbox_trigger(
    self, *, project_id: UUID, trigger_id: UUID,
    state: ChannelTriggerState, status: Optional[Status] = None,
) -> Optional[ChannelInboxTrigger]: ...

@abstractmethod
async def record_outbox_event(
    self, *, project_id: UUID, event: ChannelOutboxEventCreate,
) -> ChannelOutboxEvent: ...

@abstractmethod
async def claim_outbox_events(
    self, *, project_id: Optional[UUID] = None, limit: int = 100,
) -> List[ChannelOutboxEvent]: ...
```

### service.py — `ChannelsService` (§8), the WP1-owned surface

Constructor:

```python
class ChannelsService:
    def __init__(
        self, *,
        channels_dao: ChannelsDAOInterface,
        adapter_registry: ChannelAdapterRegistry,
        connections_service: ConnectionsService,
    ) -> None: ...
```

WP1 implements the configuration and policy thirds of this surface — the
routing and delivery thirds (`verify_signature`, `record_event`, `resolve`,
`compose_input`, `open_turn`, `settle_turn`, `enqueue_output`, `deliver`) are
declared here (they are part of the frozen `entities.md` §8 surface) but their
bodies are filled by WP3/WP4/WP5 in later checkpoints — WP1 must not implement
routing logic, only leave the methods present and raising `NotImplementedError`
if the seed commit requires it (C0 only; by C1, WP1's methods below must be real):

```python
async def create_agent(self, *, project_id, user_id, agent) -> ChannelAgent: ...
async def fetch_agent(self, *, project_id, agent_id) -> Optional[ChannelAgent]: ...
async def edit_agent(self, *, project_id, user_id, agent) -> Optional[ChannelAgent]: ...
async def delete_agent(self, *, project_id, agent_id) -> bool: ...
async def query_agents(self, *, project_id, agent=None, windowing=None) -> List[ChannelAgent]: ...
async def set_agent_default(self, *, project_id, user_id, agent_id) -> ChannelAgent: ...

async def create_space(self, *, project_id, user_id, space) -> ChannelSpace: ...
async def fetch_space(self, *, project_id, space_id) -> Optional[ChannelSpace]: ...
async def edit_space(self, *, project_id, user_id, space) -> Optional[ChannelSpace]: ...
async def delete_space(self, *, project_id, space_id) -> bool: ...
async def query_spaces(self, *, project_id, space=None, windowing=None) -> List[ChannelSpace]: ...
async def discover_spaces(self, *, project_id, connection_id) -> List[ChannelSpaceCandidate]: ...

async def create_grant(self, *, project_id, user_id, grant) -> ChannelGrant: ...
async def edit_grant(self, *, project_id, user_id, grant) -> Optional[ChannelGrant]: ...
async def delete_grant(self, *, project_id, grant_id) -> bool: ...
async def query_grants(self, *, project_id, grant=None, windowing=None) -> List[ChannelGrant]: ...
async def set_grant_default(self, *, project_id, user_id, grant_id) -> ChannelGrant: ...

async def query_threads(self, *, project_id, thread=None, windowing=None) -> List[ChannelThread]: ...
async def close_thread(self, *, project_id, user_id, thread_id) -> ChannelThread: ...

async def fetch_capabilities(self, *, channel: str) -> ChannelCapabilities: ...
async def resolve_effective_policy(self, *, project_id, agent_id, space_id) -> ChannelEffectivePolicy: ...
```

`discover_spaces` calls into `adapter_registry` (WP2) to ask the adapter which
places the app can see — WP1 implements the service method's shape and the "no
persistence" contract; it does not implement any adapter.

### service.py — `resolve_policy` (§8, D25)

The pure function, no I/O:

```python
def resolve_policy(
    capabilities: ChannelCapabilities,
    channel_defaults: ChannelPolicy,
    *levels: Optional[ChannelPolicy],
) -> ChannelEffectivePolicy:
    ...
```

### utils.py — `compose_external_key` (§2.2)

One function — every space/thread `external_key` column is built by calling
this, and nothing else composes a key. It takes the **capabilities**, not the
locator's shape alone, because the field set that identifies a place is
declared per adapter (`capabilities.md`'s `identity.keys`), not known by
this function:

```python
def compose_external_key(
    capabilities: ChannelCapabilities,
    grain: ChannelKeyGrain,
    locator: Dict[str, Any],
) -> Optional[UUID]:
    """Derive `uuid5(_CHANNELS, canonical_json(subset))`, where `subset` is
    `locator` restricted to `capabilities.identity.keys[grain]`.

    Returns `None` at `THREAD` grain when the adapter declares no thread key
    fields (`"thread": []`) — the platform-has-no-threads case, not an error.

    Raises `ChannelLocatorIncomplete(channel=..., grain=..., missing=...)`
    when a field named in `keys[grain]` is absent from `locator` — never
    composes a key over what happens to be present (a too-small effective
    field set is the failure that silently merges two conversations, so a
    missing field must raise rather than key over the rest).
    """
    ...
```

## Contracts this package must honour

- **D31 / house layering.** DAO methods are `@abstractmethod`, keyword-only
  after `*`, `project_id` first except the one sanctioned unscoped read
  (`get_project_and_connection_by_external_id`), whose docstring says so.
  Exceptions derive from `ChannelsError` and set `.message` plus an identifying
  attribute. `*Create` drops `Identifier`/`Lifecycle`; `*Edit` drops immutable
  columns; edits are full PUTs (`data`/`flags` required, never partial).
- **`record_inbox_event` returns `None` on a duplicate, never raises.** The
  platform redelivering the same `external_id` is a successful outcome of the
  unique constraint `(project_id, connection_id, external_id)`, not an error —
  `INSERT ... ON CONFLICT DO NOTHING ... RETURNING`, and `None` means "already
  recorded, do not invoke again."
- **The log ordering is `ORDER BY origin, id`.** `ChannelEventOrigin` is
  declared oldest-first (`PULLED` before `PUSHED`) specifically so this
  ordering is the log's true sequence; `ix_channel_inbox_events_log` is
  `(project_id, space_id, origin, id)` and `query_events_since` must use it,
  never `created_at`.
- **D27's four identifiers, never conflated.** `id` (uuid7, ours, identifies
  the row) is separate from `key` (uuid5, stored, identifies the item —
  `uuid5(_CHANNELS, f"{thread_id}:{turn_id}:{item}")`) is separate from
  `idempotency_key` (uuid5, derived at send time, never stored —
  `uuid5(_CHANNELS, f"{key}:{updated_at.isoformat()}")`) is separate from
  `external_locator` (the platform's receipt, read by us, once posted). WP1
  owns the schema and DTOs that make `key` a stored column and
  `idempotency_key` un-stored; it does not compute `idempotency_key` (WP5's
  job at send time), but the column must not exist for it.
- **D28 — one row for its whole life.** `ChannelOutboxEventDBE` has no
  `attempts` column. `record_outbox_event` inserts once at `CREATED`;
  `transition_outbox_event` updates the same row in place by id, never
  inserts, for `SENT` (with `external_locator`), `FAILED`, or `ABANDONED`. An
  edit into the final answer is a write to the same row found by `key`, never
  a second row.
- **`resolve_policy`'s intersection rules (D25).** Given the capability
  declaration, the channel defaults, and the agent/space/grant `ChannelPolicy`
  documents (each optional, each field independently optional):
  - Absent at a level means *no opinion* — never treated as `false` and never
    treated as "use the default at this level"; only when **every** level is
    absent does the channel default apply.
  - Booleans: any level stating `false` wins, regardless of what other levels
    state, including `true`.
  - Sets (`triggers`): the intersection of every level that stated one; a
    level that said nothing does not shrink the intersection.
  - Enums (`session_scope`): the narrowest value stated by any level, per
    `SESSION_SCOPE_ORDER` (`message` narrower than `thread`).
  - The capability declaration participates in the same intersection as the
    outermost, uneditable level — a capability of `false` denies the field
    regardless of any policy level, and no policy can turn it on.
  - `decided_by` records, per field, which `ChannelPolicyLevel` produced the
    final value — including `CAPABILITY`, which no policy row can ever state.
  - `resolve_policy` is pure: no DAO calls, no adapter calls, callable in a
    unit test with plain DTOs.
- **D29 — the default agent is a grant flag, never a column elsewhere.**
  `is_default` lives in `ChannelGrantFlags` (default per space) and
  `ChannelAgentFlags` (default per connection), each backed by a partial
  unique index on `(flags->>'is_default')::boolean`. No `default_agent_id` or
  `default_agent_slug` column exists on `channel_spaces` or anywhere else.
- **D30 — the backfill guard is a flag, never a count.**
  `ChannelSpaceFlags.is_backfilled` is set only by `mark_space_backfilled`,
  called only after a fetch the platform actually answered (including an
  empty one); nothing in this package derives "has this space been
  backfilled" from counting `ChannelInboxEvent` rows with `origin=PULLED`. A
  refusal must leave the flag `False`.
- **§2.6 — the row id never doubles as a wire token, and vice versa.** No
  `idempotency_key` column on `ChannelOutboxEventDBE`; `key` is a plain
  `UUID` column with its own unique constraint (`uq_channel_outbox_key`),
  independent of `id`.
- **No `SlugDBA`/`HeaderDBA`/`DataDBA`/`StatusDBA` where entities.md doesn't
  put them.** In particular: no `data` column on `ChannelGrantDBA` beyond what
  §2's table lists (it has `DataDBA` per the class body, holding only
  `policy`), no `HeaderDBA` on inbox/outbox tables, no `StatusDBA` on
  agents/spaces/grants/threads.
- **Migration owns WP7's tables too (see workstreams/README.md).** Revision
  `oss000000021` is the one and only channels migration; it must not be split,
  and WP7 does not author a separate revision. Coordinate the exact WP7 table
  shape with WP7's spec before finalizing the migration — if WP7's spec
  disagrees with this document about the identity table's columns, WP7's spec
  is authoritative for that table's shape and this package just carries it in
  the same file.

## Tests

- Every DTO in `dtos.py` instantiates with representative values (mirrors C0's
  exit condition, re-run here against the real, filled-in classes).
- `record_inbox_event` called twice with the same `(connection_id,
  external_id)` returns a row the first time and `None` the second time,
  never raising, and no second row exists.
- `record_inbox_events` (bulk) writes rows whose `id` order equals input
  order, and a subsequent `query_events_since` with `origin=PULLED` returns
  them before any `PUSHED` row regardless of insertion wall-clock time.
- `query_events_since(after_event_id=None)` returns the full log (a thread
  never addressed reads as "from the beginning").
- `record_inbox_trigger` called twice for the same `(thread_id, event_id)`
  returns a row the first time and `None` the second time.
- `fetch_latest_trigger` on a thread with no trigger rows returns `None`.
- `transition_inbox_trigger` updates the existing row in place — no new row
  appears, and the row's `id` is unchanged before and after.
- `record_outbox_event` called twice with the same `key` returns the existing
  row the second time (not `None`, unlike the inbox methods).
- `transition_outbox_event` from `CREATED` to `SENT` sets `data.external_locator`
  and leaves `id` and `key` unchanged; the row count for that `key` stays one.
- `mark_space_backfilled` sets `flags.is_backfilled = True` and is idempotent
  (calling it twice does not error and does not create a second space row).
- The partial unique index on `channel_grants.flags->>'is_default'` rejects a
  second `is_default=true` grant in the same space at the database level (not
  caught earlier by application code) — assert the `IntegrityError`/constraint
  name, not just "it failed".
- Same assertion for `channel_agents`' connection-wide default index.
- `resolve_policy` unit tests, no DB, covering each stated conflict explicitly:
  - one level states `backfill=False`, another states `backfill=True` → result
    is `False`.
  - agent states `triggers={MENTION, COMMAND}`, space states
    `triggers={MENTION}` → result is `{MENTION}`.
  - agent states `session_scope=THREAD`, grant states `session_scope=MESSAGE`
    → result is `MESSAGE`.
  - no level states anything for a field → result equals the channel default,
    and `decided_by[field] == ChannelPolicyLevel.CHANNEL`.
  - capability declares `backfill.supported=False`; every policy level states
    `backfill=True` → result is `False`, `decided_by["backfill"] ==
    ChannelPolicyLevel.CAPABILITY`.
  - each field's `decided_by` entry names the correct level when two fields in
    one result come from two different levels.
- `compose_external_key` is exercised for at least two distinct locator shapes
  (e.g. a Slack-shaped thread locator and a Slack-shaped space locator) and
  produces different, stable `UUID` keys — same input, same output, called
  twice.
- `compose_external_key` at `THREAD` grain against capabilities declaring
  `"thread": []` returns `None`, not an exception.
- `compose_external_key` against a locator missing a field named in
  `keys[grain]` raises `ChannelLocatorIncomplete`, naming the missing
  field(s).
- Migration: `alembic upgrade head` then `alembic downgrade -1` round-trips
  cleanly against a throwaway database; every index and constraint named in
  §3 exists after `upgrade` and is gone after `downgrade`.
- DAO round-trip: for every entity with a `create_*`/`fetch_*` pair, creating
  then fetching returns a DTO equal (field-for-field) to what was passed in,
  modulo server-assigned fields (`id`, timestamps).

## Out of scope

- The adapter interface half of `interfaces.py` (`ChannelAdapterInterface`),
  the registry, and capability normalisation — WP2.
- Anything that calls an adapter to do real work (`discover_spaces`'s adapter
  call, `fetch_capabilities`'s adapter call) beyond the service method's
  signature and its "load rows, then delegate" shape — WP2 supplies the
  adapter; WP1 supplies the seam.
- The ingress route, signature verification wiring, and `_PUBLIC_ENDPOINTS` —
  WP3.
- Routing logic inside `resolve`, `compose_input`, `open_turn`, `settle_turn` —
  WP4. WP1 declares these methods on `ChannelsService` per §8 so downstream
  packages can code against the signature, but does not implement the routing
  behaviour.
- Outbound delivery logic inside `enqueue_output`, `deliver` — WP5.
- The FastAPI routers, request/response models, and `check_action_access`
  wiring — WP8.
- WP7's identity DAO/service code — WP1 only carries WP7's migration DDL in
  the shared revision; WP7 owns `core/channels/identity.py` and
  `dbs/postgres/channels/identity_*`.

## Checkpoint

Feeds **C1 — A message lands and is persisted** (with WP2 and WP3).

Exit condition, verbatim from `plan.md`: *"a signed request to `POST
/channels/slack/events/` writes exactly one `channel_inbox_events` row and
answers 202; an unsigned one is rejected; a redelivery of the same event
writes no second row. Migration applies and downgrades. The contract suite
fails a deliberately lying fake adapter."*

WP1's direct contribution to that exit condition: the migration applies and
downgrades cleanly, and `record_inbox_event`'s dedup contract is what makes
"a redelivery writes no second row" true underneath WP3's route.
