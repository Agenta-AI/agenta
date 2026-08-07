# Channels: entities

The data model and its full stack, following the codebase's existing layering.
Column lists are the proposal, not migrations.

Domain layout mirrors `triggers` — the closest structural sibling, being the
other multi-provider integration domain — rather than `sessions`, whose
sub-domain split exists because its facets are independent surfaces. Channels is
one flat domain.

```text
core/channels/
  dtos.py          enums + core DTOs
  types.py         domain exceptions
  interfaces.py    ChannelsDAOInterface + ChannelAdapterInterface (the adapter port)
  registry.py      channel_key -> adapter instance
  service.py       holds dao + adapter_registry, never a concrete adapter
  utils.py
  providers/
    slack/adapter.py
    telegram/adapter.py
    ...
dbs/postgres/channels/
  dbas.py          abstract mixins
  dbes.py          concrete entities
  dao.py           implements the interface; opens its own sessions
  mappings.py      DBE <-> DTO
apis/fastapi/channels/
  models.py        request/response models
  router.py        route declarations
```

---

## 1. The tables

Seven new, one reused.

| table | what it is | what it is not |
| --- | --- | --- |
| `gateway_connections` *(reused)* | the installed platform app, its credentials and identifiers | not an agent identity; carries no routing policy |
| `channel_agents` | the roster this connection can reach, by slug; rules that hold wherever this agent runs | not a copy of the agent — a reference plus addressing config |
| `channel_grants` | restricts an agent to a subset of spaces; no rows means unrestricted; rules for that pair only | not "where may this app speak" — that is `channel_spaces` |
| `channel_spaces` | where agents may answer, and rules that hold whoever acts there | not about which agent |
| `channel_threads` | one agent's session history in one place; the latest row is current | not the session itself — it points at one |
| `channel_inbox_events` | the log of what was said in a space, in arrival order | **not per-agent**, and not a queue |
| `channel_inbox_triggers` | one row each time an agent is addressed; the latest is its position in the log | not a copy of the event, and never fill |
| `channel_outbox_events` | what we owe the platform, after interpretation | not a queue either |

Reading it as a sentence: *a connection has agents and spaces; each agent has its
own threads in a space; grants restrict which agents act where; a space has one log
of inbound messages, and each agent keeps its own position in it.*

The log-and-offsets pair is the one non-obvious shape here, and it exists because
two agents in one Slack thread must run independently while reading the same
history — §2.1 works through it.

### Why the unit is called a thread

**One thread is one session.** That is the whole mapping, and the name is chosen
to say so: a thread is a run of exchanges that continues, which is exactly what a
session is. Calling the row a *conversation* invited the reading that it holds
the messages; it does not — the session does, and the row points at it.

The word already carries the meaning on the platforms. A Slack thread, a Discord
thread and a Teams thread are all "the exchange that continues", and on platforms
without one the unit degenerates to the space, which is the same idea at a
coarser grain. `capabilities.md` keeps `conversation.units` as the *capability*
block name — there, `thread` is one of the values a platform may declare, so
renaming the block would collide with its own contents.

### Why the connection is reused

A Slack app becomes a `gateway_connections` row with a native `provider_key`.
The existing service already has an adapter port documented as awaiting a second
implementation, and a registry keyed by provider — so this is the second use of
an existing pattern, not a new one.

**No channels-specific columns are added to the shared table.** The sigil lives in
the capability declaration (`capabilities.md`) and the routing policy lives on the
channels tables, so nothing about a channel install needs a column on a table that
tools and triggers also use.

### Why agents and spaces are separate tables

They sit on opposite sides of the connection: agents point inward (which Agenta
agent, by what slug), spaces point outward (which external place, under what
rules). A single binding table would be their cross product, asserting per-pair
facts nobody configures — three agents in five spaces is eight rows, not fifteen.

**There is no coupling between them at all.** A space knows nothing about agents: the
default agent is a flag on the grant (§2.5), so the invariant that a default must be
granted holds structurally rather than by validation.

### Policy lives at three levels

Rules about what may happen do not all belong to one table, because they are not
all about the same thing. Three genuinely different statements exist:

- *"this space is read-only to agents, whoever is asking"* — about the **space**
- *"this agent never backfills, wherever it runs"* — about the **agent**
- *"this agent, in this space, may not run tools"* — about the **pair**

Forcing all three onto the grant makes the first two repeat once per grant row
and drift; forcing them onto the space makes the second unstateable. So the same
`policy` document hangs off `channel_agents`, `channel_spaces` and
`channel_grants`, and the effective policy for a turn is the three resolved
together.

**The document is one shape at all three levels**, so there is one validator and
one merge:

```json
{
  "triggers": ["mention", "command", "action"],
  "session_scope": "thread",
  "backfill": true,
  "forwardfill": false
}
```

Every field is **optional at every level**. Absent means *no opinion* — it does
not mean false, and it does not mean the default.

**The defaults do not live on the connection.** `gateway_connections` is a
generic table shared with tools and triggers — its `data` and `status` are typed
per `ConnectionProviderKind` (today `composio` and `agenta` only), and it carries
no routing policy by design (that is in the table above: *"not an agent identity;
carries no routing policy"*). Hanging channel policy off it would put
channel-specific columns on a table shared with tools and triggers.

So the fallback is the **channel default**, which comes from the adapter
alongside its capability declaration and is the same for every install of that
channel. It is code, not configuration — a Slack install and another Slack
install start identically, and D18 settles that the starting posture is a
value rather than an architecture. An operator who wants a different baseline
states it on the space or the agent, which is where per-install choices belong.

**All four fields are policy, not columns**, including `session_scope`, `backfill`
and `forwardfill`. Each is a statement someone may want to make about an agent
regardless of space (a research agent that always backfills) as readily as about a
space regardless of agent (a compliance channel that never does), so none of them
belongs to one table.

### Precedence: stated rules intersect

Resolution is not last-writer-wins. It is: **start from the channel defaults,
then let every level that has an opinion constrain the result.**

- **Booleans** — `false` wins. Enabled at one level and disabled at another is
  disabled. A permission granted broadly is still refused where it is denied
  narrowly.
- **Sets** (`triggers`) — **intersection**. A space allowing mention and command
  and an agent allowing only mention yields mention.
- **Enums** (`session_scope`) — the **narrower** value wins, with an explicit
  ordering (`message` is narrower than `thread`). An enum has no natural
  intersection, so the ordering is written down rather than inferred.

The rule in one line: **a thing happens only if every level that spoke about it
allows it.** Nobody speaking means the channel default applies; that is the
only way a permissive outcome is reached, and it is reached by silence rather
than by one level overruling another.

This is default-deny extended to a lattice, and it is chosen for the same reason
default-deny is: the failure mode of the alternative is an agent doing something
in a space where someone had explicitly forbidden it, because a different level
said yes later. There is deliberately **no override or force flag** — one exists
in every system that later cannot explain its own behaviour.

The cost is honest: you cannot re-permit narrowly what was denied broadly. An
agent denied `forwardfill` globally cannot have it in one space. That is
acceptable because the broad statement is the one an operator makes deliberately;
if it turns out to be too blunt, the fix is to unstate it globally and state it
per space, which is a configuration change rather than a semantics change.

**The capability declaration is the outermost level.** A platform declaring
`backfill.supported: false` denies the field regardless of what any policy states,
and no policy can turn it on (`capabilities.md` §6). It participates in exactly
the same intersection; it is simply the level nobody can edit.

**Resolution is a pure function** — `(capabilities, channel_defaults,
agent.policy, space.policy, grant.policy) -> EffectivePolicy` — computed at
routing time, never stored. Storing it would need invalidation on four tables. It is also the natural
place for the configuration UI to explain itself: the same function can return
which level decided each field, so the UI can say *"forwardfill is off because
the agent disables it"* rather than showing a checkbox that mysteriously does
nothing.

---

## 2. dbas

Abstract mixins declaring columns, composed from `dbs/postgres/shared/dbas.py`.

**Flags, Tags and Meta go on every entity**, no exceptions — where `webhooks` and
`triggers` omit them on their delivery DBAs, that is a defect in those domains,
not a pattern to copy. Same for `ProjectScopeDBA`, `LifecycleDBA` and
`IdentifierDBA`.

`SlugDBA`, `HeaderDBA`, `DataDBA` and `StatusDBA` are **not** universal — each
answers a question about the entity, and adding one where the answer is no puts a
column nobody writes on a table forever.

| mixin | add it when | in this domain |
| --- | --- | --- |
| `SlugDBA` | the entity is addressed by a stable name someone types | agents only |
| `HeaderDBA` (`name`, `description`) | a human labels it in the UI | agents, spaces, grants |
| `DataDBA` | there is a typed payload the columns should not fragment | everything except grants |
| `StatusDBA` | an attempt against the outside world can fail | inbox events, outbox events |

`HeaderDBA` is user-authored labelling, which is why `webhook_deliveries` and
`trigger_deliveries` do not carry it and their subscriptions do. Applying the same
test: an operator names a space (*"#eng-oncall — pager escalations"*) and names a
grant; nobody names an individual inbound message. So the two ledgers get no
header, and the four configuration entities do.

### The two meanings of "status", and which one applies

The codebase uses the word for two unrelated things, and both are in play here:

| aspect | `StatusDBA` — a JSONB blob | `status` — a typed VARCHAR enum |
| --- | --- | --- |
| shape | `{timestamp, type, code, message, stacktrace}` | one value from an enum |
| means | *how did the last attempt go* | *where is this in its lifecycle* |
| used by | `webhook_deliveries`, `trigger_deliveries`, `gateway_connections` | `evaluation_runs`, `evaluation_scenarios`, `evaluation_results` |

They are not alternatives; an entity can need both. The rule this domain follows:

- **Lifecycle position** → typed enum column. Never a string, always an `Enum`.
- **Outcome of an attempt** → `StatusDBA`, which already carries the error detail
  so no `last_error_kind` column is needed.
- **Binary predicates** → `flags`, typed as a Pydantic model in the DTOs
  (following `TriggerSubscriptionFlags`). So `is_active`, `is_default` and
  friends are flags, not columns.

### What is a column, and what goes in `data`

A field is a **column** when the database must act on it — a foreign key, a
uniqueness constraint, an index, or a `WHERE` clause a worker runs constantly.
Everything else that is *typed configuration or payload* goes in `data`, which
`TriggerSubscriptionData` demonstrates: `event_key`, the mapping template, and
even `references` all live inside `data` rather than as sibling columns.

That test moves three things off the column list:

- **`policy` → `data.policy`.** It is never queried — `resolve_policy` loads the
  rows it already needs for routing and intersects in memory. A JSONB column
  nobody filters on is `data` by definition.
- **`references` → `data.references`**, on `channel_agents` only. Exactly where
  `TriggerSubscriptionData` puts it. A `Reference` is `Identifier + Slug + Version`,
  so it fits a workflow and not much else — a **turn** is a root `turn_id` column,
  as on `session_records` and `session_interactions`.
- **`attempts` → gone entirely** (see below).

And it keeps `state`, `external_id`, `space_id`, `thread_id`,
`event_id` and the kinds as columns, because every one of them is a key, a
constraint member, or part of the drain query.

`external_key` and `external_locator` are the pair worth contrasting, since they
describe the same place: the **key** is a column because a unique constraint and
the get-or-create lookup act on it, while the **locator** is `data` because it is
opaque payload we only ever read back whole. §2.2 works through why both exist.

```python
class ChannelAgentDBA(
    ProjectScopeDBA, LifecycleDBA, IdentifierDBA, SlugDBA,
    HeaderDBA, DataDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    __abstract__ = True
    connection_id = Column(UUID, nullable=False)
    # slug from SlugDBA — the addressing token, what someone types after the sigil
    # data: { references: {...}, policy: {...} }

class ChannelSpaceDBA(
    ProjectScopeDBA, LifecycleDBA, IdentifierDBA,
    HeaderDBA, DataDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    __abstract__ = True
    connection_id = Column(UUID,   nullable=False)
    kind          = Column(Enum(ChannelSpaceKind), nullable=False)
    external_key  = Column(String, nullable=False)  # derived; unique per connection
    # data: { external_locator: {...}, policy: {...} }
    # no default agent here — that is a fact about the pair, so it is a grant flag

class ChannelGrantDBA(
    ProjectScopeDBA, LifecycleDBA, IdentifierDBA,
    HeaderDBA, DataDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    __abstract__ = True
    agent_id = Column(UUID, nullable=False)
    space_id = Column(UUID, nullable=False)
    # data: { policy: {...} }   — is_default lives in flags (§2.5)

class ChannelThreadDBA(
    ProjectScopeDBA, LifecycleDBA, IdentifierDBA,
    DataDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    __abstract__ = True
    space_id     = Column(UUID,   nullable=False)
    agent_id     = Column(UUID,   nullable=False)
    external_key = Column(String, nullable=True)  # derived; null when scope is the space
    session_id   = Column(String, nullable=False)  # opaque — theirs, not ours
    # data: { external_locator: {...} }   — is_active lives in flags

class ChannelInboxEventDBA(
    ProjectScopeDBA, LifecycleDBA, IdentifierDBA,
    DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    """The space's log: what was said there, in order, whoever is listening."""
    __abstract__ = True
    connection_id = Column(UUID,   nullable=False)
    external_id   = Column(String, nullable=False)  # the platform's id — dedup key
    kind          = Column(Enum(ChannelEventKind), nullable=False)
    origin        = Column(Enum(ChannelEventOrigin), nullable=False)  # ordering, §2.4
    space_id      = Column(UUID,   nullable=True)   # null until routed
    # data: { external_locator, content, sender }
    # NOTHING agent-specific here — see §2.1

class ChannelInboxTriggerDBA(
    ProjectScopeDBA, LifecycleDBA, IdentifierDBA,
    StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    """One row each time this thread's agent is addressed.

    Append-only, so the latest row doubles as the agent's consumer offset into the
    space's log (D12) — and every row stays answerable for "which turn did this
    addressing produce".
    """
    __abstract__ = True
    thread_id = Column(UUID,   nullable=False)
    event_id  = Column(UUID,   nullable=False)  # the addressing event = the offset
    turn_id   = Column(String, nullable=False)  # minted by us, passed into invoke
    state     = Column(Enum(ChannelTriggerState), nullable=False)
    # no origin: an addressing event is always PUSHED — a backfilled message
    #   predates the agent's presence and cannot address it. So the offset is
    #   `(PUSHED, event_id)` and only the id needs storing (§2.4).
    # no is_trigger: a row exists only when addressed, so every row is a trigger
    # no DataDBA: the payload is on the event; this row holds only a position

class ChannelOutboxEventDBA(
    ProjectScopeDBA, LifecycleDBA, IdentifierDBA,
    DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    __abstract__ = True
    connection_id = Column(UUID,   nullable=False)
    thread_id     = Column(UUID,   nullable=False)
    turn_id       = Column(String, nullable=False)  # String, as on records/interactions
    key           = Column(UUID,   nullable=False)  # uuid5(thread, turn, item) — §2.6
    state         = Column(Enum(ChannelDeliveryState), nullable=False)
    # data: { external_locator }   — the receipt (§2.6); `processed` see §4
    # id is an ordinary uuid7; key is the stable identity of the ITEM (§2.6)
```

**`external_locator` is in `data` here too**, as on spaces, threads and inbox
events. It failed the column test for the same reason everywhere: nothing queries
inside it, and it is read back whole to hand to an adapter. The one thing that
tempted me to make it a column — *"is this posted yet?"* — is already answered by
`state`, which is a column. So the locator stays payload, and one name means one
shape in all four places.

**`agent_ref` → `data.references`.** The house type is `Dict[str, Reference]`,
where `Reference` is `Identifier + Slug + Version` (`sdk/models/shared.py`), and
`TriggerSubscriptionData` carries it inside `data` under exactly that name.

**`space_type` → `kind`, and it is an `Enum`.** `type` shadows the builtin
and reads as a Python type; `kind` is what `ConnectionProviderKind` already uses.
Same for `event_type` → `kind`.

**`external_event_id` → `external_id` inbound only.** It is the platform's id for
what *they* said, and the inbound dedup key. The outbox does **not** get the same
name, because what it holds is a different thing — §2.6 works through why.

**No `last_error_kind`.** `StatusDBA` is `{timestamp, type, code, message,
stacktrace}` — strictly more than a kind string, and it is what
`webhook_deliveries` and `trigger_deliveries` use for exactly this.

### 2.1 The log and the offsets (D26)

**Two agents in one Slack thread must run independently.** You mention `~triage`;
later in the same thread you mention `~deploy`:

- `~deploy`'s thread starts here, and runs. It sees the conversation so far.
- `~triage`'s thread continues, undisturbed. Your `~deploy` message is not
  addressed to it — so it is *content it will see next time it runs*, not something
  that runs it.
- Mention `~triage` again and the roles swap.

Two agents in one space do **not** share a session (D1: one thread is one
session, and the thread names its agent). So one platform message runs one agent
and merely accumulates for the other.

**The shape is a log plus a consumer offset per agent.**

- **`channel_inbox_events` is the log** — one row per platform message, in arrival
  order, deduped on `(connection_id, external_id)`. It is a property of the
  **space**: what was said there, once, regardless of who is listening. Every agent
  in the space reads the same log.
- **`channel_inbox_triggers` are the offsets** — one row each time an agent is
  **actually addressed**. It records which event triggered it and which turn
  consumed the backlog up to that point. It is a property of the **thread**, which
  is to say of one agent.

So the `~deploy` message writes **one** event row and **one** offset row —
against `~deploy`'s thread only. Nothing is written for `~triage`, and that absence
is the correct record: `~triage` has not been addressed, and its offset has not
moved.

**Fill is not stored, it is derived.** What an agent has yet to see is the range of
the log after its last offset:

```sql
SELECT * FROM channel_inbox_events
WHERE space_id = :space AND (origin, id) > (:offset_origin, :offset_id)
ORDER BY origin, id               -- backfilled first, then pushed (§2.4)
```

That is D21's drain, and it is a range query rather than a per-agent queue.

**What each agent tracks is only its own position**, which is the entire content of
an offset row. Nothing else about the log is per-agent — the message sequence and the
fetched history belong to the space, because two agents in one Slack thread see the
same history, it being the same history.

This is also what makes **agent-to-agent** work, with no special path. An agent's
post is an ordinary outbox delivery; the platform echoes it back as an ordinary
inbound event, appended to the log like any other. If it addresses another agent,
that agent gets an offset row and runs. The safeguards are the existing ones:
adapters mark bot-authored messages so an agent never consumes its own post (D23),
and `!stop` is the hygiene mechanism.

**The outbox needs no equivalent split.** It is already per-thread — one row is one
thing we owe the platform on behalf of one agent — so two agents posting into the
same Slack thread is just two outbox rows. The asymmetry is worth naming: inbound
is *one log, many readers*; outbound is *one intention, one post*.

**There is no `operation` column and no version suffix on the key.** Whether a row is
new or has been updated is carried by the lifecycle columns, and the item's identity
belongs *in* the key rather than beside it. A row is one thing we owe the platform,
carrying its receipt; updating a posted message is an update to that row, and the
receipt is what makes it addressable. That leaves no send-log-versus-projection
tension to resolve.

### 2.2 external_key and external_locator

Two fields, appearing together on spaces, threads and inbox events:

| field | where | what it holds |
| --- | --- | --- |
| `external_locator` | `data` | the platform's own fields, structured |
| `external_key` | column | the derived identifier — of the space, or of the thread |

**Both derived identifiers carry the same name**, because they are the same thing at
two grains and the table already says which grain: `channel_spaces.external_key`
identifies a place, `channel_threads.external_key` identifies a thread inside one.
Prefixing with `space_` or `thread_` would restate the table name in the column name
and make two identical concepts look like two different ones.

Every platform identifies a place with **several fields, not one**. A Slack thread
is `(team, channel, thread_ts)`. A Discord thread is `(guild, channel, thread)`. A
Telegram topic is `(chat, message_thread_id)`. Teams buries the thread inside
`conversation.id`. There is no single native string both unique and stable across
all of them — hence a structured locator plus a derived key.

**`external_locator` is `data`**, per §2: nothing queries inside it, and it is read
back whole to hand to an adapter. It is the structured truth — the platform's own
fields, typed per channel, exactly as reported.

**`external_key` is a column**, because a unique constraint and the get-or-create
lookup act on it. That is the whole reason it exists as a separate field: an index
wants one comparable value, not a JSONB shape.

**`_key`, not `_slug`.** The house `Slug` type validates against
`URL_SAFE_SLUG = ^[a-zA-Z0-9_\-][a-zA-Z0-9_.\-]*$`, so naming these slugs would
invite that validation onto values that legitimately fail it: a Slack `thread_ts`
is `1719849600.123456`, and a Teams `conversation.id` carries `:` and `=`. A slug
is *chosen* — url-safe, human-typed, meaningful; these are *composed* from whatever
the platform hands us. `channel_agents.slug` is a genuine slug (someone types
`~triage`); these are opaque keys.

On a thread, `external_key` is null when the configured scope is the space itself,
which is also the platform-has-no-threads case degrading to the same shape.

**One function composes it, no exceptions.** Adapters hand over the locator and
never compose keys. Every open-source gateway studied arrived at this rule, and
usually after the same bug: the moment two code paths build keys, one place maps
to two threads and an agent answers itself in a fork nobody can see.

### 2.3 Where backfill state lives

Backfill runs **once per space**, guarded by `flags.is_backfilled` on the space row —
the first time any agent is addressed there (§2.4). It is a flag rather than a derived
query because a successful fetch can return nothing, so counting `PULLED` rows cannot
distinguish *fetched and empty* from *not fetched*; §2.4 works through that.

**Nothing about backfill lives on the thread.** History belongs to the place: two
agents in one Slack thread must not be able to hold separate backfill state for the
same history and disagree about it.

The rest of what one might want to record about backfill is spread across three
places, each already holding facts of that kind:

- **Can this platform do it at all** — the **capability declaration**. Telegram
  declares `backfill.supported: false` and core never asks.
- **Was the permission refused on this attempt** — `StatusDBA` on the trigger row
  whose turn tried it, alongside every other attempt outcome.
- **Did this turn's input include fetched history** — `flags.is_backfilled` on that
  same **trigger row** (§4). Distinct from the space flag: the space flag is the
  guard and stays true forever, while only the first turn carries the record.

**When the space flag may be set is constrained by D10.** A permission granted
tomorrow must start working without re-running setup, so `flags.is_backfilled` is set
**only after a fetch the platform actually answered** — including one that answered
with nothing. A refusal leaves it false, so the next addressing in that space tries
again and picks up the newly-granted permission. The refusal itself is recorded on the
trigger row's `StatusDBA`, which is diagnosis rather than a cached decision.

The distinction that matters: *"we have the history"* is a durable fact worth
remembering, while *"we were not allowed to ask"* is a fact about one moment and must
not be remembered as though it settled anything.

### 2.4 D21 as a log read

An unaddressed message is **appended to the log and nothing else happens** — no
per-agent row, no state to advance, no session touched. That is the whole of
forwardfill on the write side.

When an agent *is* addressed, the worker:

1. reads that thread's latest trigger to get its offset,
2. selects the space's events after it, in `id` order,
3. mints a `turn_id`, invokes **once** with all of them,
4. appends a new trigger row at the addressing event, carrying that `turn_id`.

Step 4 is what moves the offset, and it is one insert rather than a bulk
transition. **Nothing is ever claimed or marked**, so two workers racing on the
same addressing collide on `(thread_id, event_id)` and one loses — the same
constraint-not-logic discipline as the event table.

**Backfill extends the log backwards, and it is written, not streamed.** Nobody was
listening before the space was configured, so the log begins there. The first time
*any* agent is addressed in a space, the worker fetches the platform's history and
**appends those messages as events** with `origin = PULLED`.

That makes history a property of the **space**, which is what it actually is: a
Slack thread has one history. The second agent's first trigger reads the same rows —
it does not refetch, and the two agents cannot disagree about what was said.

The structural reason is enough on its own, and it is the durable one. The
rate-limit argument is real but conditional: a shared Agenta-distributed app is
capped at 15 objects per minute, while a customer's own app gets 1,000 at 50+ per
minute (`channels.md`). Per-space fetching is right either way — under the tight
cap it is the difference between working and not, and under the generous one it is
still N-1 pointless calls.

**`flags.is_backfilled` on the space is what makes it once**, and specifically not a
count of `PULLED` rows, because **a successful fetch can legitimately return
nothing**: a brand-new Slack thread whose first message is the mention has no
history. Under a row-count test that space is indistinguishable from one never
fetched, so every subsequent agent's first trigger re-fetches — against a platform
that may be capped at 15 objects per minute — and every one of those calls returns
empty again. The flag distinguishes *fetched and empty* from *not fetched*.

It is a flag rather than a column because nothing filters on it: the worker has
the space row in hand already, having just resolved it (§8).

**`origin` carries the ordering, so no counter is needed.** Backfilled rows are
inserted *after* pushed rows in wall-clock terms but represent *older* messages, so
`id` alone sorts them wrongly. `origin` partitions the log and `uuid7` orders within
each partition:

```sql
SELECT * FROM channel_inbox_events
WHERE space_id = :space AND (origin, id) > (:offset_origin, :offset_id)
ORDER BY origin, id           -- PULLED sorts before PUSHED, by enum order
```

Within `PULLED` the ids are insertion order, which *is* fetch order because the
batch is written in one pass. Nothing maintains a sequence, and nothing writes
platform timestamps into `created_at`, which means ingest time everywhere else in the
codebase. `origin` costs one enum column and no upkeep.

**The stored offset is only an `event_id`**, because an addressing event is always
`PUSHED` — a backfilled message predates the agent's presence and cannot address it.
So the offset reads as `(PUSHED, event_id)`, and a thread with no trigger row yet
reads as *before everything*, which is what makes the first turn see the backfill.

**Forwardfill off skips the read, not the write.** The log accumulates regardless;
the policy decides only whether the turn takes the range or the addressing event
alone. So enabling forwardfill starts working immediately, with history already
present.

Two further consequences:

- **The read is per thread, so agents cannot eat each other's context.**
  `~triage`'s offset is its own; `~deploy` advancing changes nothing for it.
- **`space_id` is on the event**, because the log belongs to the space. The trigger
  row carries `thread_id` instead, because a position belongs to an agent.

There is **no generation counter** (D12). The current session for a thread key is
its most recent thread row, and the current offset is its most recent trigger row —
the same "latest row wins" rule in both places.

### 2.5 The default agent is a grant flag

*"Which agent answers here when nobody is named"* is a fact about **an agent in a
space** — which is precisely what a `channel_grants` row is. So it is a flag on the
grant:

```python
class ChannelGrantFlags(BaseModel):
    is_default: bool = False   # answers this space when no sigil names anyone
```

with the same partial unique index shape used for the connection-wide fallback:

```python
Index("uq_channel_grants_default", "project_id", "space_id",
      unique=True, postgresql_where=text("(flags->>'is_default')::boolean")),
```

**Three properties follow from putting it here.**

*No write-time validation is needed.* A default that is not granted is
**unexpressible**, because the grant's existence *is* the permission — so the
invariant holds by structure rather than by a check that a caller could bypass.

*There is no duplicate identifier.* The grant already carries `agent_id`, so the
agent is named once and cannot be left pointing at a row that no longer exists.

*The fallback chain is one mechanism at two scopes.* Both levels are `is_default` in
flags with a partial unique index — on the **grant** for "default in this space", on
the **agent** for "default across this connection".

Resolution reads: sigil → the space's default grant → the connection's default
agent. Same shape at each step.

### 2.6 Row identity, wire token, receipt

Three identifiers, and the mistake to avoid is collapsing any two of them:

| identifier | minted by | read by | stable across | job |
| --- | --- | --- | --- | --- |
| `id` (uuid7) | us | us | the row's whole life | identify the row |
| `idempotency_key` (uuid5, not stored) | us | **the platform** | retries of one send | tell *them* to drop a repeat |
| `external_locator` | **the platform** | us | the row's whole life | address the message to edit it |

**Why the row id cannot double as the wire token here**, even though
`webhooks/delivery.py` does exactly that with `"Idempotency-Key":
str(delivery_id)`: a webhook delivery is **insert-only and posts once**, so its id
and its single wire call are one-to-one. An outbox row is not. It makes **at least
two distinct calls** over its life:

1. `chat.postMessage` — create the message
2. `chat.update` — edit it into the final answer

Those are different operations with different payloads. Sending the same
`Idempotency-Key` on both means a platform that honours the header treats the edit
as a duplicate of the create, and **the edit silently does not happen**.

So the token is per **distinct thing we ask the platform to do**, and `updated_at`
is precisely the right discriminator — it changes when, and only when, the row
comes to mean something new to send.

**Row ids are ordinary `uuid7`; the item's identity is a separate stored column.**
`webhooks` overloaded one field to be both, which is why its id had to be derived
and why it cannot survive an update. Channels separates them:

```python
_CHANNELS = uuid5(uuid5(NAMESPACE_DNS, "agenta"), "channels")

# 1. row id — ordinary uuid7 from IdentifierDBA. Identifies the ROW.
# 2. item identity — stored, derived once at insert. Identifies WHAT we are sending.
#    `item` is the loop index over fold()'s output; it is NOT a column (see below).
key      = uuid5(_CHANNELS, f"{thread_id}:{turn_id}:{item}")
# 3. wire token — derived at send time, never stored. Identifies ONE REQUEST.
idempotency_key = uuid5(_CHANNELS, f"{key}:{updated_at.isoformat()}")
```

**`item` is not stored, and `key` is.** That looks backwards until you see
who needs which. The worker always arrives holding the turn and iterating a list —
turn-ended gives it `turn_id`, `fold()` gives it the messages — so `item` exists
exactly when a key must be computed, and never after.

Nothing in the design asks a row *"which position were you?"*, and the two things
that might are already covered: **ordering** is free from the time-ordered `uuid7`
id and from `created_at`, and once posted the platform holds the order anyway with
`external_locator` addressing each message directly.

`key` is stored because rows *are* asked *"does this item exist yet?"* — it
carries the unique constraint that makes the upsert idempotent, as one comparable
value rather than a composite. Ordering columns cannot answer that: on a re-run the
worker asks about a row it may never have written. Same argument as `external_key`
in §2.2.

**There is no `item_index` column**, and in particular it would not be a
`record_index`: two collapses sit between a session record and a posted message.
`fold()` turns a `message_start` plus N deltas into one message and turns thoughts,
usage and errors into none; rendering drops tool activity and splits one long message
across several posts. Fifty records can fold to three messages and render as four
posts, so no mapping exists in either direction.

The sibling tables in the codebase do not have this shape. `webhook_deliveries`
collapses all three roles into its id, which works only because it never updates;
`trigger_deliveries` spreads its natural key across `(subscription_id, event_id)`
with no single-column handle at all.

Three properties hold together here:

- **A retry of one send re-derives the same token.** A retry does not touch
  `updated_at` — the row is unchanged and TaskIQ simply re-runs the task — so the
  platform deduplicates. Correct.
- **The edit gets a new token**, because the edit is the thing that changed
  `updated_at`. The platform treats it as a new operation. Correct.
- **Finding the row uses `key`**, which the editing worker can derive from
  `(thread, turn, item)` without holding the row id — so the receipt stays
  retrievable and there is still exactly one row (§2.7).

**The token is derived, not stored**, and that is safe because both inputs are
committed columns: a worker crashing between composing and sending re-derives the
identical token on restart. `updated_at` carries the same guarantee here as
everywhere else in the codebase — every DAO stamps it explicitly on each write
(`webhooks/dao.py`, `triggers/dao.py`), rather than relying on a column
`onupdate`.

The rule, stated once so these do not collapse again: **an id identifies a row; a
wire token identifies a request.** A row's identity is arbitrary and permanent
(`uuid7`); a request's identity is derived and moves with the row's state.

**The receipt is a locator, not an id.** A receipt is rarely one
field. Editing a Slack message needs `(channel, ts)`; Discord needs
`(channel_id, message_id)`; Telegram needs `(chat_id, message_id)`. Only Slack's
`ts` is a lone string, and building the model around that accident would force
every other adapter to concatenate and re-split. It is the same structured-truth
argument as §2.2, so it gets the same name and shape — and it is nullable, because
before the post succeeds there is no receipt.

**The progress message, end to end**, showing which identifier does what:

| step | row | `updated_at` | `idempotency_key` sent | locator |
| --- | --- | --- | --- | --- |
| 1. turn starts — insert `state=PENDING` | created, `uuid7` | t₀ | — | — |
| 2. `chat.postMessage` | unchanged | t₀ | `uuid5(key, t₀)` | — |
| 3. receipt — update `state=SENT` | same row | t₁ | — | `(channel, ts)` set |
| 4. turn ends — update `data.processed` | same row | t₂ | — | unchanged |
| 5. `chat.update` | unchanged | t₂ | `uuid5(key, t₂)` | read, to address the edit |

Step 5 reads the locator off the row it already holds and sends a **different**
token than step 2, because steps 3 and 4 moved `updated_at`. A retry of either send
re-derives that step's own token unchanged, since a retry writes nothing.

Break either half and it fails differently:

- **A moving row id** → step 5 cannot find the row, has no locator, and posts a
  second message. "working…" stranded above a duplicate answer. (This is why the id
  is an arbitrary `uuid7` and never recomputed from content.)
- **A static wire token** → step 5 sends step 2's token, and a platform honouring
  the header drops the edit as a duplicate. The message stays "working…" forever.

A version or render count, if one were ever needed, belongs in the **wire token**,
where it distinguishes requests — never in the id, where it would fork the record and
post a new message per render.

**Where a new row identity IS correct**: a genuinely different item. A turn
emitting three messages gets items 0, 1, 2 — three keys, three rows, three
posts, each independently editable.

### 2.7 How deliveries work, and why there is no attempts column

There is no `attempts` column, because retrying is not something the tables record
(`tasks/taskiq/webhooks/tasks.py`):

- **TaskIQ owns retrying.** The task raises on 5xx/timeout and TaskIQ re-runs it;
  `retry_count` arrives as a **task parameter**, never a column, and
  `WEBHOOK_MAX_RETRIES` bounds it.
- **Retries write nothing.** A retryable failure records nothing at all until the
  last attempt, which writes the outcome and re-raises. Success and permanent
  failure (1xx/3xx/4xx — "the receiver understood, retrying is pointless") record
  immediately.
- **`Status` carries the outcome**: `Status(code="503", message="failed")` plus
  the error and response body in `data`. That is the whole record.

An `attempts` column would mean one write per attempt, on the hot path, to store
what the task runner already tracks.

**The outbox row is a small state machine, and that is the one way it differs from
`webhook_deliveries`.** That table is insert-only, because a webhook is
fire-and-forget: a delivery is an audit row and nothing revisits it. A channel
delivery has a **receipt**, because editing a progress message into the final answer
means calling the platform's update API with the message id it gave us. Keeping that
receipt findable is the entire justification for the outbox existing as a table.

**One posted message is one row, for its whole life.** Everything below is writes
to *that* row, found by its derived `key` — never additional rows, and never by
re-deriving the id, which is an arbitrary `uuid7` precisely so it survives updates
(§2.6).

| when | write | row count |
| --- | --- | --- |
| before posting | insert `state=PENDING` | 1 |
| receipt arrives | update `state=SENT`, set `data.external_locator` | still 1 |
| editing into the final answer | update `data.processed`, keep the locator | still 1 |
| gave up | update `state=FAILED` / `ABANDONED`, reason in `Status` | still 1 |

So **an edit is not a second outbox event.** It is the same row, whose
`external_locator` tells the worker which Slack message to call `chat.update` on. This
is the whole reason the receipt is persisted, and the reason the id must stay
stable across the update (§2.6).

Retries write nothing — they are TaskIQ's, bounded by `WEBHOOK_MAX_RETRIES`, and
only the terminal attempt records anything.

**When there genuinely are two rows:** a turn that emits two distinct messages.
Those are items 0 and 1 — two keys, two rows, two Slack messages,
each independently editable. The test is *"is this a different thing, or the same
thing later?"* Different thing → new row. Same thing later → same row.

`ChannelDeliveryState` is therefore a typed enum — genuine lifecycle position, which
§2 makes a column — describing a state machine on one row rather than a counter or an
append log. `ABANDONED` is the one state beyond the webhook set: a platform can revoke
access mid-thread, and the operator needs to see that the reply was never delivered
rather than finding a silently missing row.

The same reasoning applies inbound. `ChannelTriggerState` is
`STARTED → SETTLED`, plus `REFUSED`/`FAILED` as terminals — the fate of one turn,
not a counter and not a queue position. The offset itself never changes: it is the
row's `event_id`, fixed at insert.

## 3. dbes

Concrete entities adding `__tablename__` and constraints.

```python
class ChannelAgentDBE(Base, ChannelAgentDBA):
    __tablename__ = "channel_agents"
    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint("project_id", "connection_id", "slug",
                         name="uq_channel_agents_connection_slug"),
    )
```

`slug` comes from `SlugDBA` and is **not null**. The default agent is therefore never
encoded as an absent name — a partial unique index over a null would be a clever
encoding of a fact that deserves to be stated outright.

The fallback chain is stated explicitly instead, as `is_default` flags at two scopes
(§2.5): on the grant for "default in this space", and on the agent for
"default across this connection" — each with a partial unique index:

```python
Index("uq_channel_agents_default", "project_id", "connection_id",
      unique=True, postgresql_where=text("(flags->>'is_default')::boolean")),
```

This is the connection-wide fallback the resolution chain needs, and it lives on
the agent roster rather than on `gateway_connections` — which is generic and
carries no routing policy — for the same reason the policy defaults do not live
there either.

```python
class ChannelSpaceDBE(Base, ChannelSpaceDBA):
    __tablename__ = "channel_spaces"
    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint("project_id", "connection_id", "external_key",
                         name="uq_channel_spaces_connection_external_key"),
        Index("ix_channel_spaces_flags", "flags", postgresql_using="gin"),
    )

class ChannelGrantDBE(Base, ChannelGrantDBA):
    __tablename__ = "channel_grants"
    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint("project_id", "agent_id", "space_id",
                         name="uq_channel_grants_agent_space"),
        # at most one default agent per space (§2.5)
        Index("uq_channel_grants_default", "project_id", "space_id", unique=True,
              postgresql_where=text("(flags->>'is_default')::boolean")),
    )

class ChannelThreadDBE(Base, ChannelThreadDBA):
    __tablename__ = "channel_threads"
    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        # current thread for one agent in one place — agent_id is part of the key
        Index("ix_channel_threads_current",
              "project_id", "space_id", "external_key", "agent_id", "created_at"),
    )

class ChannelInboxEventDBE(Base, ChannelInboxEventDBA):
    __tablename__ = "channel_inbox_events"
    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint("project_id", "connection_id", "external_id",
                         name="uq_channel_inbox_connection_external"),
        # the log read, in true sequence: backfilled rows first, then pushed,
        # each ordered by their time-ordered uuid7 id (§2.4)
        Index("ix_channel_inbox_events_log",
              "project_id", "space_id", "origin", "id"),
    )

class ChannelInboxTriggerDBE(Base, ChannelInboxTriggerDBA):
    __tablename__ = "channel_inbox_triggers"
    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        # one addressing per (thread, event) — a re-route cannot double-trigger
        UniqueConstraint("project_id", "thread_id", "event_id",
                         name="uq_channel_inbox_triggers_thread_event"),
        # the offset read: this thread's latest trigger. uuid7 id IS arrival order,
        # so ORDER BY id DESC LIMIT 1 needs no timestamp column.
        Index("ix_channel_inbox_triggers_latest",
              "project_id", "thread_id", "id"),
    )

class ChannelOutboxEventDBE(Base, ChannelOutboxEventDBA):
    __tablename__ = "channel_outbox_events"
    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        # ordinary uuid7 id; dedup is key, not the id
        PrimaryKeyConstraint("project_id", "id"),
        # one row per item — a re-run of the outbox worker cannot fork a message
        UniqueConstraint("project_id", "key",
                         name="uq_channel_outbox_key"),
        # the delivery sweep: what is still owed, oldest first
        Index("ix_channel_outbox_pending",
              "project_id", "state", "created_at"),
    )
```

**There is deliberately no unique constraint on `(space_id, external_key,
agent_id)`.** The table is append-only and the latest row wins, so uniqueness
would forbid both `!new` and the one-session-per-message scope. Lookup is "most
recent row for this key", which the index supports.

**`agent_id` is part of the thread lookup key.** Two agents in one Slack thread
have two thread rows with the same `(space_id, external_key)` and different
`agent_id` — that is §2.1's requirement expressed as an index.

**Deduplication is in the natural keys, never in the row ids** (§2.6):

| mechanism | absorbs | protects |
| --- | --- | --- |
| `(connection_id, external_id)` on events | a platform redelivering the same message | us, from double-invoking |
| `(event_id, thread_id)` on triggers | a re-route of the same event to the same thread | us, from double-draining |
| `key` on outbox | a re-run of the outbox worker for one turn | us, from forking a message into two rows |
| `uuid5(key, updated_at)` sent as `Idempotency-Key` | a retry of one send | **them**, from double-posting |

The first three are unique constraints. The last is not a constraint at all — it is
a header, enforced by the receiver, and the one identifier that deliberately moves
when the row is updated. Row ids are plain `uuid7` and carry no dedup duty, exactly
as in `trigger_deliveries`. Nothing downstream reasons about retries.

## 4. dtos

Enums as `str, Enum` in `dtos.py`, following the sessions convention.

```python
class ChannelSpaceKind(str, Enum):
    PRIVATE = "private"
    GROUP   = "group"
    TOPIC   = "topic"

class ChannelEventKind(str, Enum):
    """The two kinds of thing an agent can be addressed by."""
    MESSAGE = "message"
    ACTION  = "action"      # button click, reaction

class ChannelEventOrigin(str, Enum):
    """Who initiated the transfer — and therefore where the row sorts.

    Declared oldest-first: PULLED rows predate every PUSHED row, so
    `ORDER BY origin, id` is the log's true sequence (§2.4).
    """
    PULLED = "pulled"   # we asked the platform for it (the history API)
    PUSHED = "pushed"   # the platform delivered it to our ingress

class ChannelTriggerKind(str, Enum):
    MENTION = "mention"
    COMMAND = "command"
    ACTION  = "action"      # button, reaction, delegation

class ChannelSessionScope(str, Enum):
    THREAD  = "thread"
    MESSAGE = "message"

# narrowest last; precedence picks the highest index any level stated
SESSION_SCOPE_ORDER = [ChannelSessionScope.THREAD, ChannelSessionScope.MESSAGE]

class ChannelPolicyLevel(str, Enum):
    CAPABILITY = "capability"   # the outermost; not editable
    CHANNEL    = "channel"      # per-channel defaults; see below
    AGENT      = "agent"
    SPACE      = "space"
    GRANT      = "grant"

# --- lifecycle states: typed enums, never free strings ---------------------- #

class ChannelTriggerState(str, Enum):
    """The fate of one turn. STARTED, not RUNNING: this column records what we
    did, not what is happening elsewhere. The row is written when we hand off to
    invoke and is never touched while the turn proceeds, so a crashed worker
    leaves rows reading STARTED forever — which is honest under "we started it"
    and a lie under "it is running". The states are all past tense for that
    reason, and liveness is the session's to report, not this row's."""
    STARTED = "started"   # we minted a turn and handed it to invoke
    SETTLED = "settled"   # the turn finished; the offset stands
    REFUSED = "refused"   # not granted, no agent, or an overlapping turn
    FAILED  = "failed"

class ChannelDeliveryState(str, Enum):
    """Where one outbound message is in its life. PENDING is kept and it is not
    the same non-word as a queue's "pending": the row is inserted *before* the
    post is attempted (§2.6 step 1), so there is a real committed state meaning
    "we owe this and have not yet sent it". That is what the delivery sweep
    selects on, and it is what makes a crash mid-post recoverable rather than
    invisible."""
    PENDING   = "pending"    # written, not yet posted
    SENT      = "sent"       # the platform acknowledged; locator held
    FAILED    = "failed"     # terminal after retries
    ABANDONED = "abandoned"  # we stopped trying — access revoked mid-thread
```

There is no `ChannelInboxState`: an event row has no lifecycle of its own. It was
received, and that is all it ever is — interpretation lives on the trigger rows.
`ChannelBackfillState` is gone entirely (§2.3).

Flags are typed as Pydantic models, following `TriggerSubscriptionFlags`:

```python
class ChannelAgentFlags(BaseModel):
    is_active: bool = True
    # the connection-wide fallback, used when there is no sigil and the space
    # names no default; at most one per connection (partial unique index)
    is_default: bool = False

class ChannelSpaceFlags(BaseModel):
    is_active:     bool = True
    # KEPT, and it is load-bearing — see below.
    is_backfilled: bool = False

class ChannelGrantFlags(BaseModel):
    # this agent answers this space when no sigil names anyone;
    # at most one per space (partial unique index) — §2.5
    is_default: bool = False

class ChannelThreadFlags(BaseModel):
    is_active: bool = True     # closed by !new, or by the space going inactive

class ChannelInboxEventFlags(BaseModel):
    """Empty today. FlagsDBA is on every table (§2), and the typed model is what
    makes the first flag a DTO change rather than a migration."""

class ChannelInboxTriggerFlags(BaseModel):
    # did THIS turn's input include fetched history? (§2.3) — per turn, where the
    # space-level flag records only that the one-time fetch happened
    is_backfilled: bool = False

class ChannelOutboxEventFlags(BaseModel):
    """Empty today, same reason as the inbox event flags."""
```

A trigger row has **no `is_trigger`**: a row exists only when an agent was
addressed, so the flag would be true in every row and false in none (§2.1).

**`is_backfilled` appears twice, at two grains, and they answer different
questions.** On the **space** it is *"has the one-time fetch happened here"* — the
guard that keeps backfill to once, including when the fetch legitimately returned
nothing (§2.4). On the **trigger** it is *"did this particular turn's input include
fetched history"* — a fact about one invoke, useful when reconstructing what an agent
actually saw. Neither substitutes for the other: the space flag stays true forever
after the first fetch, while only the first turn's trigger row carries it.

### The two policy documents, and why there are two

```python
class ChannelPolicy(BaseModel):
    """What one level STATED. Every field optional; None means no opinion."""
    triggers:      Optional[Set[ChannelTriggerKind]] = None
    session_scope: Optional[ChannelSessionScope] = None
    backfill:      Optional[bool]                = None
    forwardfill:   Optional[bool]                = None

class ChannelEffectivePolicy(BaseModel):
    """What the intersection DECIDED. Every field present, none optional."""
    triggers:      Set[ChannelTriggerKind]
    session_scope: ChannelSessionScope
    backfill:      bool
    forwardfill:   bool
    decided_by:    Dict[str, ChannelPolicyLevel]
```

**They are the same fields with opposite optionality, and that is the whole
point.** `ChannelPolicy` is what somebody wrote down; `ChannelEffectivePolicy` is
what is true for this turn. Collapsing them into one model with everything
optional would put the burden on every reader: each place that consumed
`policy.backfill` would have to know whether `None` meant *nobody stated it* or
*the resolver has not run yet*, and would re-implement the fallback — which is how
three call sites end up disagreeing about the default.

- **`ChannelPolicy` is persisted**, three times over, at `data.policy` on the
  agent, the space and the grant (§1). `None` is meaningful there and must be
  storable: *unstated* and *stated false* are different facts, and the intersection
  rule treats them differently — one falls through, the other wins.
- **`ChannelEffectivePolicy` is never persisted.** It is the return of
  `resolve_policy()` (§8), recomputed per turn. Storing it would need invalidation
  across four tables (§1), and its `decided_by` is only meaningful next to the
  levels it names.

**`decided_by` is on the effective document only**, keyed by field name, and it
exists so the configuration UI can explain a checkbox that appears to do nothing:
*"forwardfill is off because the agent disables it"*. Without it the intersection
is a black box — the operator sees the outcome, cannot see which of five levels
produced it, and toggles the wrong one. It is `Dict[str, ChannelPolicyLevel]`
rather than a typed-per-field model because it is diagnostic output consumed as a
lookup, and `ChannelPolicyLevel` includes `CAPABILITY`, which no policy row can
ever be (§1).

Note that `resolve_policy` returns *fields decided*, not *rows merged*: two fields
in one effective document routinely come from two different levels, which is why
`decided_by` is per field.

And the `data` payloads, one per entity, following `TriggerSubscriptionData`:

```python
class ChannelAgentData(BaseModel):
    references: Dict[str, Reference]              # the bound workflow/variant/revision
    policy:     Optional[ChannelPolicy] = None

class ChannelSpaceData(BaseModel):
    external_locator: Dict[str, Any]              # the platform's own fields (§2.2)
    policy:           Optional[ChannelPolicy] = None

class ChannelGrantData(BaseModel):
    policy: Optional[ChannelPolicy] = None

class ChannelThreadData(BaseModel):
    # Optional, and it tracks the nullable `external_key` column exactly: when the
    # session scope is the space, there is no thread to locate (§2.2). Both fields
    # are absent together or present together — they describe the same thing, one
    # as an indexable key and one as the platform's own fields.
    external_locator: Optional[Dict[str, Any]] = None

class ChannelInboxEventData(BaseModel):
    external_locator: Dict[str, Any]
    content:          List[Dict[str, Any]]        # normalised parts
    sender:           Dict[str, Any]              # platform user, pre-identity-link
    # raw:            Optional[Dict[str, Any]] = None   # see below
    # processed:      Optional[Dict[str, Any]] = None   # see below


# No ChannelInboxTriggerData: the row holds a position, not a payload. The slug
# that was named is on the event's content; recording it again per agent would
# duplicate a fact from the parent row.

class ChannelOutboxEventData(BaseModel):
    # no `references`: a turn is not a Reference (no slug, no version) — it is the
    # root `turn_id` column, exactly as on session_records and session_interactions
    external_locator: Optional[Dict[str, Any]] = None  # the receipt (§2.6)
    # raw:            Optional[Dict[str, Any]] = None   # see below
    # processed:      Optional[Dict[str, Any]] = None   # see below
```

**`raw` and `processed` are commented out deliberately, and they appear on both
tables.** Every channel event crosses a mapping boundary, and a mapping has two
ends. Naming them the same way on both sides makes the symmetry visible, where the
earlier `raw`-inbound / `rendered`-outbound pairing hid it behind two words for one
idea:

| | `raw` | `processed` |
| --- | --- | --- |
| inbox | the platform's payload, as received | `content` + `sender`, normalised |
| outbox | the turn's output, as folded | the platform-shaped request we posted |

Read down either column and it is the same field doing the same job — *before* the
mapping, and *after* it. `rendered` named only the outbound *after*, which is why it
had no inbound counterpart and looked like a one-off.

Neither is needed to *operate*: `content` and `sender` already carry everything a
turn consumes, and the platform holds the posted copy.

What they would be for is **audit**, and that is the argument against putting them
here. `trigger_deliveries` and `webhook_deliveries` keep their full payloads in
`data` because those tables *are* their domain's audit log. Channels has no audit
log, and inventing one as two fields on two operational tables is the wrong shape —
especially given §10: a busy space with forwardfill ingests every message, and `raw`
is the field that makes retention urgent rather than eventual.

So they stay commented, and land properly if channels ever gets system events. Being
in `data` means adding them later is a DTO change and no migration.

`external_locator` is `Dict[str, Any]` in core and typed per channel by the
adapter — core stores it, never reads inside it, which is D16. It appears on **four**
entities with the same meaning each time: on a space it locates the place, on a
thread the thread, on an inbox event the message we received, and on an outbox row
the message we posted — the receipt (D27). Two are nullable, for two different
reasons: on a thread because the scope may be the space, and on an outbox row
because it does not exist until the post succeeds.

### The entity DTOs and their variants

Four classes per entity, following `triggers`. The differences between them are small
and exact:

```python
# --- agents ---------------------------------------------------------------- #

class ChannelAgent(Identifier, Lifecycle, Header, Metadata):
    connection_id: UUID
    slug: str
    #
    data:  ChannelAgentData
    flags: ChannelAgentFlags = Field(default_factory=ChannelAgentFlags)

class ChannelAgentCreate(Header, Metadata):
    connection_id: UUID
    slug: str
    #
    data:  ChannelAgentData
    flags: ChannelAgentFlags = Field(default_factory=ChannelAgentFlags)

class ChannelAgentEdit(Identifier, Header, Metadata):
    data:  ChannelAgentData
    flags: ChannelAgentFlags = Field(default_factory=ChannelAgentFlags)

class ChannelAgentQuery(BaseModel):
    name: Optional[str] = None
    connection_id: Optional[UUID] = None
    slug: Optional[str] = None

# --- spaces ---------------------------------------------------------------- #

class ChannelSpace(Identifier, Lifecycle, Header, Metadata):
    connection_id: UUID
    kind: ChannelSpaceKind
    external_key: str
    #
    data:  ChannelSpaceData
    flags: ChannelSpaceFlags = Field(default_factory=ChannelSpaceFlags)

class ChannelSpaceCreate(Header, Metadata):
    connection_id: UUID
    kind: ChannelSpaceKind
    external_key: str
    #
    data:  ChannelSpaceData
    flags: ChannelSpaceFlags = Field(default_factory=ChannelSpaceFlags)

class ChannelSpaceEdit(Identifier, Header, Metadata):
    data:  ChannelSpaceData
    flags: ChannelSpaceFlags = Field(default_factory=ChannelSpaceFlags)

class ChannelSpaceQuery(BaseModel):
    name: Optional[str] = None
    connection_id: Optional[UUID] = None
    kind: Optional[ChannelSpaceKind] = None
    external_key: Optional[str] = None

class ChannelSpaceCandidate(BaseModel):
    """A place the app can see but nobody has configured — discover_spaces (§8).
    Not an entity: no id, no lifecycle, nothing persisted until chosen."""
    kind: ChannelSpaceKind
    external_key: str
    external_locator: Dict[str, Any]
    name: Optional[str] = None
    is_configured: bool = False

# --- grants ---------------------------------------------------------------- #

class ChannelGrant(Identifier, Lifecycle, Header, Metadata):
    agent_id: UUID
    space_id: UUID
    #
    data:  ChannelGrantData
    flags: ChannelGrantFlags = Field(default_factory=ChannelGrantFlags)

class ChannelGrantCreate(Header, Metadata):
    agent_id: UUID
    space_id: UUID
    #
    data:  ChannelGrantData
    flags: ChannelGrantFlags = Field(default_factory=ChannelGrantFlags)

class ChannelGrantEdit(Identifier, Header, Metadata):
    data:  ChannelGrantData
    flags: ChannelGrantFlags = Field(default_factory=ChannelGrantFlags)

class ChannelGrantQuery(BaseModel):
    agent_id: Optional[UUID] = None
    space_id: Optional[UUID] = None

# --- threads (no Edit: the table is append-only) --------------------------- #

class ChannelThread(Identifier, Lifecycle):
    space_id: UUID
    agent_id: UUID
    external_key: Optional[str] = None
    session_id: str
    #
    data:  ChannelThreadData
    flags: ChannelThreadFlags = Field(default_factory=ChannelThreadFlags)

class ChannelThreadCreate(BaseModel):
    space_id: UUID
    agent_id: UUID
    external_key: Optional[str] = None
    session_id: str
    #
    data:  ChannelThreadData
    flags: ChannelThreadFlags = Field(default_factory=ChannelThreadFlags)

class ChannelThreadQuery(BaseModel):
    space_id: Optional[UUID] = None
    agent_id: Optional[UUID] = None
    external_key: Optional[str] = None
    session_id: Optional[str] = None

# --- inbox events (no Edit either; append-only log) ------------------------ #

class ChannelInboxEvent(Identifier, Lifecycle):
    connection_id: UUID
    external_id: str
    kind: ChannelEventKind
    origin: ChannelEventOrigin
    space_id: Optional[UUID] = None
    #
    status: Optional[Status] = None
    data:   ChannelInboxEventData
    flags:  ChannelInboxEventFlags = Field(default_factory=ChannelInboxEventFlags)

class ChannelInboxEventCreate(BaseModel):
    connection_id: UUID
    external_id: str
    kind: ChannelEventKind
    origin: ChannelEventOrigin
    space_id: Optional[UUID] = None
    #
    data: ChannelInboxEventData

class ChannelInboxEventQuery(BaseModel):
    connection_id: Optional[UUID] = None
    space_id: Optional[UUID] = None
    kind: Optional[ChannelEventKind] = None
    origin: Optional[ChannelEventOrigin] = None
    external_id: Optional[str] = None

# --- inbox triggers -------------------------------------------------------- #

class ChannelInboxTrigger(Identifier, Lifecycle):
    thread_id: UUID
    event_id: UUID
    turn_id: str
    state: ChannelTriggerState
    #
    status: Optional[Status] = None
    flags:  ChannelInboxTriggerFlags = Field(default_factory=ChannelInboxTriggerFlags)

class ChannelInboxTriggerCreate(BaseModel):
    thread_id: UUID
    event_id: UUID
    turn_id: str
    state: ChannelTriggerState = ChannelTriggerState.STARTED
    #
    flags: ChannelInboxTriggerFlags = Field(default_factory=ChannelInboxTriggerFlags)

class ChannelInboxTriggerQuery(BaseModel):
    thread_id: Optional[UUID] = None
    event_id: Optional[UUID] = None
    turn_id: Optional[str] = None
    state: Optional[ChannelTriggerState] = None

# --- outbox events --------------------------------------------------------- #

class ChannelOutboxEvent(Identifier, Lifecycle):
    connection_id: UUID
    thread_id: UUID
    turn_id: str
    key: UUID
    state: ChannelDeliveryState
    #
    status: Optional[Status] = None
    data:   ChannelOutboxEventData
    flags:  ChannelOutboxEventFlags = Field(default_factory=ChannelOutboxEventFlags)

class ChannelOutboxEventCreate(BaseModel):
    connection_id: UUID
    thread_id: UUID
    turn_id: str
    key: UUID
    state: ChannelDeliveryState = ChannelDeliveryState.PENDING
    #
    data: ChannelOutboxEventData

class ChannelOutboxEventQuery(BaseModel):
    thread_id: Optional[UUID] = None
    turn_id: Optional[str] = None
    key: Optional[UUID] = None
    state: Optional[ChannelDeliveryState] = None
```

**Five properties hold across all of them**, each following `triggers` and each
avoidable-bug-shaped:

- **`*Create` drops `Identifier` and `Lifecycle`.** A caller cannot choose an id or
  backdate a row; the DAO mints both. `TriggerSubscriptionCreate` does the same.
  (`TriggerDeliveryCreate` keeps `Identifier` because its id *is* its dedup key —
  the very conflation §2.6 refuses, so channels does not copy it.)
- **`*Edit` keeps `Identifier` and drops the immutable columns.** No `connection_id`
  on `ChannelAgentEdit`, no `external_key` on `ChannelSpaceEdit`: reparenting an
  agent to another connection or repointing a space at a different Slack channel are
  not edits, they are different rows. The identity fields being absent from the model
  is what makes that unexpressible rather than merely discouraged.
- **Edits are full PUTs.** The model requires `data` and `flags` outright rather than
  making them optional, so a partial body cannot silently blank a field. Callers
  source the full document from the freshly-fetched entity and override what they own.
- **`*Query` has every field optional and none of `data`.** Querying inside a JSONB
  payload is not offered, which is the read-side half of the column-vs-`data` test
  (§2): if it were queryable it would be a column.
- **Three entities have no `*Edit` at all** — threads, inbox events, inbox triggers —
  because their tables are append-only or worker-owned. `ChannelInboxTrigger` gets no
  `*Edit` even though `transition_inbox_trigger` writes to it: a state transition
  takes an enum and a `Status`, not a document, so an edit model would advertise
  rewriting a turn's history.

`ChannelInboxEventFlags`, `ChannelInboxTriggerFlags` and `ChannelOutboxEventFlags`
are empty models today. They exist because `FlagsDBA` is on every table (§2), and an
empty typed model is what makes adding the first flag a DTO change rather than a
migration. `ChannelInboxTriggerFlags` is the one with a known first occupant:
`is_backfilled`, recording whether *this turn's* input included fetched history
(§2.3).

None of these import FastAPI. `Status` is the shared `{timestamp, type, code,
message, stacktrace}` DTO, present on the three ledger entities and absent from the
four configuration ones (§2).

## 5. types

Domain exceptions. The sessions sub-domains use `types.py` for this while
`triggers` and `webhooks` use `exceptions.py`; following sessions here, since
this domain sits closer to it in subject matter.

**Both conventions agree on the shape**: a domain base class, and every subclass
setting `self.message` plus the identifying attribute in `__init__`
(`ProviderNotFoundError.provider_key`, `SessionTurnNotFound.session_id`). The router
reads `.message` when translating to an `HTTPException` detail, so an exception
without one loses its diagnosis at the boundary.

```python
class ChannelsError(Exception):
    """Base exception for the channels domain."""

    def __init__(self, message: str = "Channels error"):
        self.message = message
        super().__init__(self.message)


class ChannelNotSupported(ChannelsError):
    """Raised when a channel key has no registered adapter."""

    def __init__(self, *, channel: str):
        self.channel = channel
        super().__init__(f"Channel not supported: {channel}")


class ChannelSpaceNotFound(ChannelsError):
    def __init__(self, *, space_id: Optional[UUID] = None, external_key: Optional[str] = None):
        self.space_id = space_id
        self.external_key = external_key
        super().__init__(f"Channel space not found: {space_id or external_key}")


class ChannelAgentNotFound(ChannelsError):
    def __init__(self, *, agent_id: Optional[UUID] = None, slug: Optional[str] = None):
        self.agent_id = agent_id
        self.slug = slug
        super().__init__(f"Channel agent not found: {agent_id or slug}")


class ChannelAgentNotGranted(ChannelsError):
    """Raised when an agent has grants, but none for this space (D17)."""

    def __init__(self, *, agent_id: UUID, space_id: UUID):
        self.agent_id = agent_id
        self.space_id = space_id
        super().__init__(f"Agent {agent_id} is not granted in space {space_id}")


class ChannelThreadNotFound(ChannelsError):
    def __init__(self, *, thread_id: UUID):
        self.thread_id = thread_id
        super().__init__(f"Channel thread not found: {thread_id}")


class ChannelSignatureInvalid(ChannelsError):
    """Raised when ingress HMAC verification fails. Carries no detail on purpose."""

    def __init__(self, *, channel: str):
        self.channel = channel
        super().__init__(f"Invalid signature for channel: {channel}")


class ChannelConnectionNotFound(ChannelsError):
    def __init__(self, *, connection_id: UUID):
        self.connection_id = connection_id
        super().__init__(f"Connection not found: {connection_id}")


class ChannelPolicyDenied(ChannelsError):
    """Raised when the effective policy forbids what was asked (§1)."""

    def __init__(self, *, field: str, level: ChannelPolicyLevel):
        self.field = field
        self.level = level
        super().__init__(f"Denied by {level.value} policy: {field}")
```

**`ChannelNotSupported` names the registry's miss** — *this channel key has no
registered adapter* — and reads exactly like `ProviderNotFoundError` in `triggers`.
There is no bus between core and the adapters: core calls the adapter port directly
(§8).

**`ChannelPolicyDenied` carries which level denied**, so the intersection stays
explainable at the point of failure, for the same reason `decided_by` exists on the
effective document (§4). An opaque denial from a five-level lattice is unactionable.

**`ChannelSignatureInvalid` deliberately carries nothing but the channel.** The
detail an attacker would want is exactly the detail that would help — which byte
differed, which timestamp was stale — so it is omitted rather than logged into a
response.

## 6. models

FastAPI request/response models, distinct from core DTOs. The router translates
request model → core DTO → service, and core DTO → response model back. Core DTOs
never reach the wire; wire models never reach the service.

**The house shape is three models per entity**, and it is unusually regular:

- **`*CreateRequest` / `*EditRequest`** — a single field named after the entity,
  wrapping the core `*Create` / `*Edit` DTO. Not the DTO bare: the envelope means a
  later sibling field (an `options`, an `idempotency` block) is an additive change
  rather than a breaking one.
- **`*QueryRequest`** — the optional `*Query` DTO plus `Windowing`, which is where
  paging lives. Note the entity field is `Optional` here and required on create:
  an empty query body is *"everything"*, which is a legitimate request.
- **`*Response` / `*sResponse`** — `count: int = 0` plus the entity, singular or as
  a list. The count is on both, and both are always returned even when the entity
  is `None`, so a caller never has to distinguish an empty body from a missing one.

```python
# --- agents ---------------------------------------------------------------- #

class ChannelAgentCreateRequest(BaseModel):
    agent: ChannelAgentCreate

class ChannelAgentEditRequest(BaseModel):
    agent: ChannelAgentEdit

class ChannelAgentQueryRequest(BaseModel):
    agent: Optional[ChannelAgentQuery] = None
    windowing: Optional[Windowing] = None

class ChannelAgentResponse(BaseModel):
    count: int = 0
    agent: Optional[ChannelAgent] = None

class ChannelAgentsResponse(BaseModel):
    count: int = 0
    agents: List[ChannelAgent] = Field(default_factory=list)

# --- spaces ---------------------------------------------------------------- #

class ChannelSpaceCreateRequest(BaseModel):
    space: ChannelSpaceCreate

class ChannelSpaceEditRequest(BaseModel):
    space: ChannelSpaceEdit

class ChannelSpaceQueryRequest(BaseModel):
    space: Optional[ChannelSpaceQuery] = None
    windowing: Optional[Windowing] = None

class ChannelSpaceResponse(BaseModel):
    count: int = 0
    space: Optional[ChannelSpace] = None

class ChannelSpacesResponse(BaseModel):
    count: int = 0
    spaces: List[ChannelSpace] = Field(default_factory=list)

# --- grants ---------------------------------------------------------------- #

class ChannelGrantCreateRequest(BaseModel):
    grant: ChannelGrantCreate

class ChannelGrantEditRequest(BaseModel):
    grant: ChannelGrantEdit

class ChannelGrantQueryRequest(BaseModel):
    grant: Optional[ChannelGrantQuery] = None
    windowing: Optional[Windowing] = None

class ChannelGrantResponse(BaseModel):
    count: int = 0
    grant: Optional[ChannelGrant] = None

class ChannelGrantsResponse(BaseModel):
    count: int = 0
    grants: List[ChannelGrant] = Field(default_factory=list)

# --- threads (read-only over the wire; created by routing) ----------------- #

class ChannelThreadQueryRequest(BaseModel):
    thread: Optional[ChannelThreadQuery] = None
    windowing: Optional[Windowing] = None

class ChannelThreadResponse(BaseModel):
    count: int = 0
    thread: Optional[ChannelThread] = None

class ChannelThreadsResponse(BaseModel):
    count: int = 0
    threads: List[ChannelThread] = Field(default_factory=list)

# --- inbox / outbox (read-only: observability, never authored) ------------- #

class ChannelInboxEventQueryRequest(BaseModel):
    event: Optional[ChannelInboxEventQuery] = None
    windowing: Optional[Windowing] = None

class ChannelInboxEventsResponse(BaseModel):
    count: int = 0
    events: List[ChannelInboxEvent] = Field(default_factory=list)

class ChannelOutboxEventQueryRequest(BaseModel):
    event: Optional[ChannelOutboxEventQuery] = None
    windowing: Optional[Windowing] = None

class ChannelOutboxEventsResponse(BaseModel):
    count: int = 0
    events: List[ChannelOutboxEvent] = Field(default_factory=list)

# --- capabilities ---------------------------------------------------------- #

class ChannelCapabilitiesResponse(BaseModel):
    count: int = 0
    capabilities: Optional[ChannelCapabilities] = None

# --- effective policy: the explain endpoint (§9) --------------------------- #

class ChannelPolicyResolveRequest(BaseModel):
    agent_id: UUID
    space_id: UUID

class ChannelPolicyResponse(BaseModel):
    count: int = 0
    policy: Optional[ChannelEffectivePolicy] = None

# --- ingress --------------------------------------------------------------- #

class ChannelEventAck(BaseModel):
    """The 202 body. Mirrors TriggerEventAck exactly."""
    status: str = "accepted"
    detail: Optional[str] = None
```

**Four entities get no `*CreateRequest`, and that is the interesting part.** Threads,
inbox events and outbox events are **written only by routing and by workers**, never
by an API caller — a thread comes into being because someone spoke in Slack, not
because someone POSTed. Giving them create models would advertise a way to forge a
conversation. They get query and response models only, because an operator does need
to *look* at them; that is the debugging surface D24 asks for.

**`ChannelEventAck` mirrors `TriggerEventAck` rather than inventing an envelope**,
because the ingress contract is the same one: verify, enqueue, answer `202` fast
(§9). Platforms retry aggressively on anything else, so the model exists mainly to
guarantee the response body is trivial to serialise.

**The `ChannelCapabilities` model is a response only.** The declaration is fetched
*from* the adapter (`capabilities.md`), so it is never a request body — nothing on
the wire may state what a platform can do.

## 7. daos

One interface in `core/channels/interfaces.py`, one implementation in
`dbs/postgres/channels/dao.py`. DAOs open their own database sessions; services
never touch the engine.

Four conventions from `TriggersDAOInterface` hold throughout, and each is
load-bearing rather than stylistic:

- **`@abstractmethod`, and everything after `*` is keyword-only.** No DAO call site
  passes positionally, so adding a parameter never silently shifts an argument.
- **`project_id: UUID` is the first parameter of every method.** Tenant scope is
  structural, not a filter someone remembers. The one exception here is unscoped
  because an inbound platform event carries no tenant, and its docstring says so —
  the same sanctioned shape as `get_project_and_subscription_by_trigger_id`.
- **`user_id` is present on writes and absent on reads**, because it feeds
  `created_by_id` / `updated_by_id` from `LifecycleDBA`. It is `Optional` where the
  writer is a worker rather than a person.
- **A bare `#` line separates parameter groups** — scope, then the entity, then
  modifiers like `windowing`. It is how every DAO in the codebase reads.

```python
class ChannelsDAOInterface(ABC):
    """Persistence contract for the channels domain."""

    # --- agents ------------------------------------------------------------- #

    @abstractmethod
    async def create_agent(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        agent: ChannelAgentCreate,
    ) -> ChannelAgent: ...

    @abstractmethod
    async def fetch_agent(
        self,
        *,
        project_id: UUID,
        #
        agent_id: UUID,
    ) -> Optional[ChannelAgent]: ...

    @abstractmethod
    async def fetch_agent_by_slug(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        #
        slug: str,
    ) -> Optional[ChannelAgent]:
        """Resolve the sigil. Backed by uq_channel_agents_connection_slug."""
        ...

    @abstractmethod
    async def fetch_default_agent(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> Optional[ChannelAgent]:
        """The connection-wide fallback — the last step of the chain (§2.5).

        Backed by the partial unique index on flags->>'is_default', so this
        returns at most one row by construction rather than by LIMIT 1.
        """
        ...

    @abstractmethod
    async def edit_agent(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        agent: ChannelAgentEdit,
    ) -> Optional[ChannelAgent]: ...

    @abstractmethod
    async def delete_agent(
        self,
        *,
        project_id: UUID,
        #
        agent_id: UUID,
    ) -> bool: ...

    @abstractmethod
    async def query_agents(
        self,
        *,
        project_id: UUID,
        #
        agent: Optional[ChannelAgentQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelAgent]: ...

    # --- spaces ------------------------------------------------------------- #

    @abstractmethod
    async def create_space(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        space: ChannelSpaceCreate,
    ) -> ChannelSpace: ...

    @abstractmethod
    async def fetch_space(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
    ) -> Optional[ChannelSpace]: ...

    @abstractmethod
    async def fetch_space_by_key(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        #
        external_key: str,
    ) -> Optional[ChannelSpace]:
        """The routing lookup — default-deny, so None means "not configured here".

        This is the whole reason external_key is a column rather than living
        inside the locator (§2.2): the unique constraint serves this read.
        """
        ...

    @abstractmethod
    async def edit_space(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        space: ChannelSpaceEdit,
    ) -> Optional[ChannelSpace]: ...

    @abstractmethod
    async def delete_space(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
    ) -> bool: ...

    @abstractmethod
    async def query_spaces(
        self,
        *,
        project_id: UUID,
        #
        space: Optional[ChannelSpaceQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelSpace]: ...

    @abstractmethod
    async def mark_space_backfilled(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
    ) -> Optional[ChannelSpace]:
        """Set flags.is_backfilled after the one-time history fetch (§2.4).

        Separate from edit_space because the writer is a worker, not a person:
        an operator editing a space must not be able to clear this and trigger a
        refetch, and this write must not clobber a concurrent operator edit.
        """
        ...

    # --- grants ------------------------------------------------------------- #

    @abstractmethod
    async def create_grant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        grant: ChannelGrantCreate,
    ) -> ChannelGrant: ...

    @abstractmethod
    async def fetch_grant(
        self,
        *,
        project_id: UUID,
        #
        agent_id: UUID,
        space_id: UUID,
    ) -> Optional[ChannelGrant]:
        """The pair lookup, for policy resolution. Backed by the unique constraint."""
        ...

    @abstractmethod
    async def fetch_default_grant(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
    ) -> Optional[ChannelGrant]:
        """The space's default agent — the middle step of the chain (§2.5)."""
        ...

    @abstractmethod
    async def edit_grant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        grant: ChannelGrantEdit,
    ) -> Optional[ChannelGrant]: ...

    @abstractmethod
    async def delete_grant(
        self,
        *,
        project_id: UUID,
        #
        grant_id: UUID,
    ) -> bool: ...

    @abstractmethod
    async def query_grants(
        self,
        *,
        project_id: UUID,
        #
        grant: Optional[ChannelGrantQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelGrant]: ...

    @abstractmethod
    async def count_grants(
        self,
        *,
        project_id: UUID,
        #
        agent_id: UUID,
    ) -> int:
        """Does this agent have ANY grant? Zero means unrestricted (§1).

        A count rather than a query because the service only needs the
        predicate, and an agent granted in five hundred spaces should not load
        five hundred rows to answer it.
        """
        ...

    # --- threads ------------------------------------------------------------ #

    @abstractmethod
    async def create_thread(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        thread: ChannelThreadCreate,
    ) -> ChannelThread: ...

    @abstractmethod
    async def fetch_current_thread(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
        external_key: Optional[str],
        agent_id: UUID,
    ) -> Optional[ChannelThread]:
        """The most recent thread row for this (space, key, agent) triple.

        `ORDER BY created_at DESC LIMIT 1` — the table is append-only and the
        latest row wins (D12), so there is deliberately no unique constraint to
        read against (§3). `external_key` is None when the scope is the space.
        """
        ...

    @abstractmethod
    async def query_threads(
        self,
        *,
        project_id: UUID,
        #
        thread: Optional[ChannelThreadQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelThread]: ...

    # --- inbox: the log ----------------------------------------------------- #

    @abstractmethod
    async def record_inbox_event(
        self,
        *,
        project_id: UUID,
        #
        event: ChannelInboxEventCreate,
    ) -> Optional[ChannelInboxEvent]:
        """Append to the log. Returns None if already recorded.

        `INSERT ... ON CONFLICT (project_id, connection_id, external_id) DO
        NOTHING ... RETURNING`. None is the dedup contract, not an error: the
        platform redelivered and the caller must not invoke again. Same shape as
        `claim_delivery` in triggers.
        """
        ...

    @abstractmethod
    async def record_inbox_events(
        self,
        *,
        project_id: UUID,
        #
        events: List[ChannelInboxEventCreate],
    ) -> List[ChannelInboxEvent]:
        """Bulk append for backfill — one statement, so `id` order is fetch order.

        This is what makes `origin` sufficient for ordering (§2.4): the batch is
        written in one pass, in the order the platform returned it.
        """
        ...

    @abstractmethod
    async def attach_space(
        self,
        *,
        project_id: UUID,
        #
        event_id: UUID,
        space_id: UUID,
    ) -> Optional[ChannelInboxEvent]:
        """Set space_id once the event is routed — it is null on arrival (§2)."""
        ...

    @abstractmethod
    async def query_events_since(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
        after_event_id: Optional[UUID],
        #
        limit: Optional[int] = None,
    ) -> List[ChannelInboxEvent]:
        """The backlog read — D21's drain as a range query (§2.4).

        `WHERE (origin, id) > (PUSHED, :after_event_id) ORDER BY origin, id`, or
        the whole log when `after_event_id` is None (a thread nobody has
        addressed yet, which reads as "from the beginning"). Consumes nothing and
        claims nothing: two threads can read the same range concurrently.
        """
        ...

    @abstractmethod
    async def query_inbox_events(
        self,
        *,
        project_id: UUID,
        #
        event: Optional[ChannelInboxEventQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelInboxEvent]: ...

    # --- inbox: the offsets ------------------------------------------------- #

    @abstractmethod
    async def fetch_latest_trigger(
        self,
        *,
        project_id: UUID,
        #
        thread_id: UUID,
    ) -> Optional[ChannelInboxTrigger]:
        """This agent's consumer offset — `ORDER BY id DESC LIMIT 1` (D26).

        None means never addressed, which is the case that triggers backfill.
        """
        ...

    @abstractmethod
    async def record_inbox_trigger(
        self,
        *,
        project_id: UUID,
        #
        trigger: ChannelInboxTriggerCreate,
    ) -> Optional[ChannelInboxTrigger]:
        """Move the offset — one insert, `ON CONFLICT DO NOTHING`.

        None when `(thread_id, event_id)` is taken: two workers raced the same
        addressing and this one lost. That is the entire concurrency story
        inbound; nothing is locked and nothing is claimed (§2.4).
        """
        ...

    @abstractmethod
    async def transition_inbox_trigger(
        self,
        *,
        project_id: UUID,
        #
        trigger_id: UUID,
        state: ChannelTriggerState,
        status: Optional[Status] = None,
    ) -> Optional[ChannelInboxTrigger]:
        """Record the turn's fate in place, by id — never inserts.

        Same discipline as `update_delivery` in triggers: a post-invoke write
        failure must not manifest as "no row exists" on retry.
        """
        ...

    @abstractmethod
    async def query_inbox_triggers(
        self,
        *,
        project_id: UUID,
        #
        trigger: Optional[ChannelInboxTriggerQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelInboxTrigger]: ...

    # --- outbox ------------------------------------------------------------- #

    @abstractmethod
    async def record_outbox_event(
        self,
        *,
        project_id: UUID,
        #
        event: ChannelOutboxEventCreate,
    ) -> ChannelOutboxEvent:
        """Insert at state=PENDING, idempotent on `key` (§2.6).

        `ON CONFLICT (project_id, key) DO NOTHING ... RETURNING`, falling back to
        a fetch — so a re-run of the outbox worker returns the EXISTING row
        rather than None. Unlike the inbox, the caller needs the row either way:
        it may still have to post it, and it must not fork the message.
        """
        ...

    @abstractmethod
    async def fetch_outbox_event(
        self,
        *,
        project_id: UUID,
        #
        event_id: UUID,
    ) -> Optional[ChannelOutboxEvent]: ...

    @abstractmethod
    async def fetch_outbox_event_by_key(
        self,
        *,
        project_id: UUID,
        #
        key: UUID,
    ) -> Optional[ChannelOutboxEvent]:
        """Find the row for an item without knowing its row id — for the edit path.

        The worker rendering a turn's final answer holds `(thread, turn, item)`
        and so can derive `key`, but it does not hold the `uuid7` id. This is why
        `key` is stored (§2.6).
        """
        ...

    @abstractmethod
    async def claim_outbox_events(
        self,
        *,
        project_id: Optional[UUID] = None,
        #
        limit: int = 100,
    ) -> List[ChannelOutboxEvent]:
        """The delivery sweep: PENDING rows, oldest first.

        `project_id` is Optional here and only here on the write side, because a
        single sweeper serves every project — the same cross-project shape, and
        the same justification, as `fetch_active_schedules` in triggers.
        """
        ...

    @abstractmethod
    async def transition_outbox_event(
        self,
        *,
        project_id: UUID,
        #
        event_id: UUID,
        state: ChannelDeliveryState,
        status: Optional[Status] = None,
        data: Optional[ChannelOutboxEventData] = None,
    ) -> Optional[ChannelOutboxEvent]:
        """Advance the row in place — SENT with a locator, or FAILED/ABANDONED.

        `data` is how the receipt lands (§2.7). One posted message is one row for
        its whole life, so this is an update and never an insert.
        """
        ...

    @abstractmethod
    async def query_outbox_events(
        self,
        *,
        project_id: UUID,
        #
        event: Optional[ChannelOutboxEventQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelOutboxEvent]: ...

    # --- ingress: the one unscoped read ------------------------------------- #

    @abstractmethod
    async def get_project_and_connection_by_external_id(
        self,
        *,
        channel: str,
        external_id: str,
    ) -> Optional[Tuple[UUID, UUID]]:
        """Resolve a platform workspace/team id to (project_id, connection_id).

        Deliberately cross-project, and the ONLY unscoped method here. An inbound
        Slack event carries a team id and no tenant scope, so this lookup
        *recovers* the project before anything else can be scoped. Exactly the
        shape and the justification of
        `get_project_and_subscription_by_trigger_id` in triggers.
        """
        ...
```

**There is no drain and nothing to claim on the inbox side.** D21 falls out of
`fetch_latest_trigger`, `query_events_since` and `record_inbox_trigger` rather than
being implemented (§2.4). `claim_outbox_events` is the only claim verb in the
interface, and it earns the name: an outbound sweep genuinely has to reserve work.

`record_inbox_trigger` is **singular**, because a row exists only when an agent was
addressed and at most one agent is addressed per message (§2.1).

**Three of these return `None` and it means three different things**, which is worth
stating once because they read alike:

| method | `None` means | caller does |
| --- | --- | --- |
| `record_inbox_event` | already recorded — the platform redelivered | stop; do not invoke |
| `record_inbox_trigger` | another worker won this addressing | stop; it is being handled |
| `fetch_space_by_key` | this space is not configured | stop; default-deny (D17) |

Only the third is a "not found". The first two are successful outcomes of a race,
and treating either as an error produces alarms on ordinary operation.

`record_outbox_event` deliberately does **not** join that list: it returns the
existing row on conflict rather than `None`, because its caller still has work to do
with a row it may not have written (§2.6).

### 7.1 The adapter port

The second interface in the same file, and the one every platform implements. It
is short on purpose: **core stores opaque values and reads a declaration** (D16),
so everything platform-shaped is on this side of the line.

```python
class ChannelAdapterInterface(ABC):
    """One platform, reached in process. A bridge is the same interface reached
    over the wire (D16) — `contract.md` is this file's wire projection, message
    for message."""

    channel: str    # the registry key: "slack", "telegram"

    # --- declaration ---

    @abstractmethod
    async def fetch_capabilities(self) -> ChannelCapabilities:
        """`capabilities.md` §2. Normalised by core, never trusted (§4 there)."""

    # --- ingress ---

    @abstractmethod
    async def verify_signature(self, *, headers: Dict[str, str], body: bytes) -> str:
        """Verify HMAC with timestamp replay protection; return the platform's own
        installation id. Verification and identification are one act — the caller
        maps that id to a connection (§8). Raises ChannelSignatureInvalid (§5)."""

    @abstractmethod
    async def parse_event(self, *, body: bytes) -> Optional[ChannelInboundEvent]:
        """Platform payload → the normalised event, or None for anything we do not
        act on (acks, bot echoes, platform noise). Carries `addressed`, which is
        the adapter's answer to trigger-or-fill (D9): the adapter knows its own
        platform's addressing conventions and core does not."""

    # --- egress ---

    @abstractmethod
    async def post_message(self, *, connection: ChannelConnection,
                           locator: Dict[str, Any], content: List[Dict[str, Any]],
                           idempotency_key: UUID) -> Dict[str, Any]:
        """Post, and return the `external_locator` receipt — a structured object,
        not a bare id, since editing needs `(channel, ts)` on one platform and
        `(chat_id, message_id)` on another (§2.6). Drop a command whose
        idempotency_key was already accepted; dedupe on that token and nothing
        else (`contract.md` §5)."""

    @abstractmethod
    async def edit_message(self, *, connection: ChannelConnection,
                           external_locator: Dict[str, Any],
                           content: List[Dict[str, Any]],
                           idempotency_key: UUID) -> Dict[str, Any]:
        """Edit in place — the indicator becoming the answer (D28). Offered only
        where the declaration says `rendering.message_update`."""

    # --- history ---

    @abstractmethod
    async def fetch_history(self, *, connection: ChannelConnection,
                            locator: Dict[str, Any], limit: int
                            ) -> List[ChannelInboundEvent]:
        """The one-time backfill (D21). Called only where the declaration says
        `fill.backfill.supported`. A permission refusal raises rather than
        returning empty — an empty fetch is a legitimate result and the two must
        stay distinguishable (D30)."""
```

**Six methods, and the count is the point.** Everything else an integration might
want — routing, dedup, offsets, policy, sessions — is core's, and an adapter that
grows a seventh method is usually core logic leaking across the port.

**`parse_event` returns `Optional`** for the same reason `record_inbox_event` does:
most of what a platform pushes is not addressed to anyone, and *nothing to do here*
is an ordinary outcome rather than an error.

**`post_message` and `edit_message` are separate**, though a single `deliver` could
switch on whether a locator exists. They are separate because the declaration gates
them separately: a platform can post and not edit, and core must degrade to a new
message rather than silently losing the update (`contract.md` §5).

## 8. services

Constructor takes interfaces via keyword-only DI, never concrete classes.

```python
class ChannelsService:
    def __init__(
        self,
        *,
        channels_dao: ChannelsDAOInterface,
        adapter_registry: ChannelAdapterRegistry,
        connections_service: ConnectionsService,
    ) -> None: ...
```

Routing is not the whole service: it is also the only writer of configuration. The
surface divides in three:

```python
class ChannelsService:
    # --- configuration: thin over the DAO, but never a pass-through --------- #

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

    # --- capability + policy: adapter reads, no persistence ---------------- #

    async def fetch_capabilities(self, *, channel: str) -> ChannelCapabilities: ...
    async def resolve_effective_policy(
        self, *, project_id, agent_id, space_id,
    ) -> ChannelEffectivePolicy: ...

    # --- routing: the inbound path (§2.1, §2.4) ---------------------------- #

    async def verify_signature(self, *, channel, headers, body) -> UUID: ...
    async def record_event(self, *, channel, envelope) -> Optional[ChannelInboxEvent]: ...
    async def resolve(self, *, project_id, connection_id, event) -> Optional[Resolution]: ...
    async def compose_input(self, *, project_id, resolution) -> ChannelTurnInput: ...
    async def open_turn(self, *, project_id, resolution, turn_id) -> ChannelInboxTrigger: ...
    async def settle_turn(self, *, project_id, trigger_id, state, status=None) -> None: ...

    # --- delivery: the outbound path (§2.6, §2.7) -------------------------- #

    async def enqueue_output(self, *, project_id, thread_id, turn_id, items) -> List[ChannelOutboxEvent]: ...
    async def deliver(self, *, project_id, event_id) -> ChannelOutboxEvent: ...
    async def query_inbox_events(self, *, project_id, event=None, windowing=None) -> List[ChannelInboxEvent]: ...
    async def query_outbox_events(self, *, project_id, event=None, windowing=None) -> List[ChannelOutboxEvent]: ...
```

**Five of these are not pass-throughs, and they are the reason the layer exists:**

- **`set_agent_default` / `set_grant_default`** are separate verbs rather than an
  `edit` with a flag, mirroring `set_subscription_active` in `triggers`. Setting a
  default must **clear the previous one first**, or the partial unique index rejects
  the write (§2.5). An operator ticking a checkbox means *"make this the default"*,
  not *"attempt to create a second default and fail"* — so the swap is one service
  call over two DAO writes.
- **`discover_spaces`** asks the adapter which places the app can actually see, so
  configuration is a pick-list rather than a paste-the-channel-id form. It returns
  candidates, not rows: nothing is persisted until the operator chooses.
- **`close_thread`** is `!new` and the `is_active` flag, and it is a service verb
  because the table is append-only (D12) — closing means writing, not deleting.
- **`verify_signature` returns the `connection_id`**, because verification and
  identification are the same act: you cannot check an HMAC without first finding
  the secret, and finding the secret means finding the connection. Returning it
  spares the caller a second unscoped lookup, and it is why
  `get_project_and_connection_by_external_id` is called once per event rather than
  twice.
- **`resolve_effective_policy`** exposes the pure function over the wire for the
  configuration UI. It is a service method and not just a utility because it must
  load three rows and the capability declaration before it can compute anything.

**`compose_input` is where the backlog read happens**, and it is deliberately its
own method rather than part of `resolve`. Resolution answers *who runs*; composition
answers *what they see* — and only the second depends on `policy.forwardfill`, on
whether backfill must run first, and on `AGENTA_CHANNELS_BACKFILL_LIMIT`. Keeping
them apart means the refusal paths in `resolve` cost no reads over the log.

**`open_turn` and `settle_turn` bracket the invoke**, and the split is the honest
one: `open_turn` writes the offset row at `STARTED` and returns before the agent
runs (D14 — invoke is detached), `settle_turn` records the fate whenever it
arrives. Nothing holds a transaction across the invoke.

**Resolution returns one agent or none**, which is §2.1 in the service: a message
addresses at most one agent, and unaddressed messages resolve to nothing at all
because they are already in the log.

```python
async def resolve(self, *, connection_id, event) -> Optional[Resolution]:
    space = await self.dao.fetch_space_by_key(...)          # default-deny
    agent = await self.addressed_agent(space, event)         # sigil, then defaults
    if agent is None:
        return None                       # fill: it is in the log, nothing to do

    grant = await self.grant_for(agent, space)
    if grant is None and self.has_any_grant(agent):
        return None                       # refuse, silently (D17)

    policy = resolve_policy(caps, channel_defaults,
                            agent.data.policy,
                            space.data.policy,
                            grant.data.policy if grant else None)

    thread = await self.get_or_create_thread(
        space, compose_external_key(event.external_locator),
        agent, policy.session_scope,
    )
    return Resolution(space, agent, thread, policy)
```

`addressed_agent()` holds the rule: the sigil names one, or nothing was named and
the space's default grant applies, or failing that the connection's default agent
(§2.5). **At most one agent is addressed per message**, and every other agent in
the space is unaffected — the message sits in the log and each of them will read it
on its own next trigger. That is the behaviour where `~triage` keeps running while
`~deploy` is spoken to, and it needs no per-agent write.

There is no enumeration of the agents present, and no loop over them: resolution
touches exactly the one thread that is about to run.

`resolve_policy` is the pure function of §1 — no I/O, no storage, fully unit
testable, and the single place the intersection rule lives:

```python
def resolve_policy(capabilities, channel_defaults, *levels) -> ChannelEffectivePolicy:
    # booleans: any stated False wins
    # sets:     intersect every stated set
    # enums:    the narrowest stated value, by SESSION_SCOPE_ORDER
    # unstated at every level: fall through to the channel defaults
```

Everything downstream reads `policy`, never a raw column — so a rule stated on
the agent and a rule stated on the space reach the worker the same way. Note it
is resolved **per agent**: two agents in one space can legitimately have
different effective policies, which is only expressible because policy hangs off
the agent and the grant as well as the space.

Thread continuation short-circuits agent resolution entirely: an existing
thread already names its agent, so a follow-up inherits rather than
re-parsing. Only an explicit sigil mid-thread switches it.

## 9. routers

Routes declared imperatively with `add_api_route`, following the house pattern. Every
route names an `operation_id` — it becomes the generated SDK method name, so it is API
surface rather than decoration — and a `response_model` with
`response_model_exclude_none=True`.

```python
class ChannelsRouter:
    def __init__(self, *, channels_service: ChannelsService, dispatch_task=None):
        self.channels_service = channels_service
        self.dispatch_task = dispatch_task
        self.router = APIRouter()

        # --- Ingress (public, HMAC-verified) ---
        # One literal route per in-process channel. Explicit, not generated.
        self.router.add_api_route(
            "/slack/events/",
            self.ingest_slack_event,
            methods=["POST"],
            operation_id="ingest_slack_event",
            response_model=ChannelEventAck,
            status_code=status.HTTP_202_ACCEPTED,
        )
        # ... one such block per channel as each adapter ships.

        # Bridges share one route: their channel key is not known at build time.
        self.router.add_api_route(
            "/bridge/events/",
            self.ingest_bridge_event,
            methods=["POST"],
            operation_id="ingest_bridge_event",
            response_model=ChannelEventAck,
            status_code=status.HTTP_202_ACCEPTED,
        )

        # --- Capabilities ---
        self.router.add_api_route(
            "/catalog/channels/",
            self.list_channels,
            methods=["GET"],
            operation_id="list_channels",
            response_model=ChannelsCatalogResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/channels/{channel}/capabilities/",
            self.fetch_capabilities,
            methods=["GET"],
            operation_id="fetch_channel_capabilities",
            response_model=ChannelCapabilitiesResponse,
            response_model_exclude_none=True,
        )

        # --- Connections (shared gateway_connections rows) ---
        self.router.add_api_route(
            "/connections/query",
            self.query_connections,
            methods=["POST"],
            operation_id="query_channel_connections",
            response_model=ChannelConnectionsResponse,
            response_model_exclude_none=True,
        )

        # --- Agents ---
        self.router.add_api_route(
            "/agents/", self.create_agent, methods=["POST"],
            operation_id="create_channel_agent",
            response_model=ChannelAgentResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/agents/", self.list_agents, methods=["GET"],
            operation_id="list_channel_agents",
            response_model=ChannelAgentsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/agents/query", self.query_agents, methods=["POST"],
            operation_id="query_channel_agents",
            response_model=ChannelAgentsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/agents/{agent_id}", self.fetch_agent, methods=["GET"],
            operation_id="fetch_channel_agent",
            response_model=ChannelAgentResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/agents/{agent_id}", self.edit_agent, methods=["PUT"],
            operation_id="edit_channel_agent",
            response_model=ChannelAgentResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/agents/{agent_id}", self.delete_agent, methods=["DELETE"],
            operation_id="delete_channel_agent",
        )
        self.router.add_api_route(
            "/agents/{agent_id}/default", self.set_agent_default, methods=["POST"],
            operation_id="set_channel_agent_default",
            response_model=ChannelAgentResponse,
            response_model_exclude_none=True,
        )

        # --- Spaces (same seven shapes, plus discovery) ---
        #   POST/GET   /spaces/            create_channel_space / list_channel_spaces
        #   POST       /spaces/query       query_channel_spaces
        #   GET/PUT    /spaces/{space_id}  fetch_channel_space / edit_channel_space
        #   DELETE     /spaces/{space_id}  delete_channel_space
        self.router.add_api_route(
            "/spaces/discover", self.discover_spaces, methods=["POST"],
            operation_id="discover_channel_spaces",
            response_model=ChannelSpaceCandidatesResponse,
            response_model_exclude_none=True,
        )

        # --- Grants ---
        #   POST/GET   /grants/            create_channel_grant / list_channel_grants
        #   POST       /grants/query       query_channel_grants
        #   PUT/DELETE /grants/{grant_id}  edit_channel_grant / delete_channel_grant
        #   POST       /grants/{grant_id}/default   set_channel_grant_default

        # --- Policy: the explain endpoint ---
        self.router.add_api_route(
            "/policy/resolve", self.resolve_policy, methods=["POST"],
            operation_id="resolve_channel_policy",
            response_model=ChannelPolicyResponse,
            response_model_exclude_none=True,
        )

        # --- Threads (read + close; never created over the wire) ---
        #   POST   /threads/query              query_channel_threads
        #   POST   /threads/{thread_id}/close   close_channel_thread

        # --- Inbox / outbox (read-only observability) ---
        #   POST   /inbox/events/query    query_channel_inbox_events
        #   POST   /outbox/events/query   query_channel_outbox_events
```

Handlers follow the house body exactly — decorators, permission check, service
call, response envelope:

```python
@intercept_exceptions()
@handle_adapter_exceptions()
async def create_agent(
    self,
    request: Request,
    *,
    body: ChannelAgentCreateRequest,
) -> ChannelAgentResponse:
    await self._check(request, Permission.EDIT_CHANNELS)

    try:
        agent = await self.channels_service.create_agent(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            #
            agent=body.agent,
        )
    except ChannelConnectionNotFound as e:
        raise HTTPException(status_code=404, detail=e.message) from e

    return ChannelAgentResponse(count=1 if agent else 0, agent=agent)
```

**Four things about this surface are deliberate.**

**The ingress routes are the only public ones, and each is a literal path.** An
in-process channel gets its own route written out — `/slack/events/`, and one such
block per adapter as it ships — **never `/{channel}/events/`**. This follows the two
public receivers already live: `/composio/events/` on `TriggersRouter` and
`/stripe/events/` on the billing router. Neither parameterises its provider.

Three things follow from the literal form, which is why the convention exists:

- **`_PUBLIC_ENDPOINTS` matches by `startswith`.** A parameterised segment has no
  literal prefix, so exempting it would mean exempting `/channels/` — every
  configuration route in this domain, public. A literal path is exemptible exactly.
- **A request for an unregistered channel 404s at the router**, before any handler
  runs. With a parameter it reaches the code and has to be rejected by hand.
- **`operation_id` names the channel**, so the generated SDK gets
  `ingest_slack_event` rather than one stringly-typed method.

**Bridges are the one exception, and they get `/bridge/events/`.** A bridge's
channel key is not known when the route table is built — that is what makes it a
bridge — so it cannot have a literal route of its own, and generating one per
registered bridge would mean a route table that changes at runtime. One fixed entry
point instead: the bridge credential identifies which bridge is calling (D16,
`contract.md` §6), which is the same act as verifying it, so the channel is resolved
from the authenticated caller rather than from the URL.

That asymmetry is honest rather than awkward. A first-party channel is known at
build time and says so in its path; a bridge is not, and does not pretend to be.

All of them authenticate by signature rather than by session, return `202` from a
handler that verifies, records and hands off to `dispatch_task`, and do nothing
else: platforms retry on slow responses, so no routing or invoking happens inside
the request. That is the same `dispatch_task` seam `TriggersRouter` takes in its
constructor.

The cost is one four-line `_PUBLIC_ENDPOINTS` block per channel shipped, plus one
for `/bridge/events/` — the same cost `triggers` pays per provider.

**GET and POST-query coexist on every collection**, and that is not redundancy. The
`GET` is the simple listing an SDK caller wants; the `POST /query` carries a body
because `Windowing` and the `*Query` DTO do not fit a query string once they include
nested filters. `triggers` ships both for exactly this reason.

**Threads, inbox events and outbox events have no create or edit routes**, matching
§6: they are written by routing and by workers. `POST /threads/{id}/close` is the
one exception and it is not an edit — it appends (D12).

**Collection routes keep their trailing slash**, and item routes do not. A slashless
collection 307s, loses the `/api` prefix, and hangs the web app.

Permissions mirror the workflow roles — `VIEW_CHANNELS`, `EDIT_CHANNELS`,
`RUN_CHANNELS` — checked inline at the top of each handler via `_check`. Every read
route takes `VIEW`, every configuration write takes `EDIT`, and `RUN` guards the
paths that cause an agent to act. The ingress route takes none of them: it has no
session to check, which is the whole reason its signature verification has to be
airtight.

## 10. Retention

Agenta has no operational retention today; core tables keep everything, because
partitioning is not yet handled. Channels inherits that and does not invent a
policy of its own.

Worth stating once: **channels is likely to be what forces the issue.** A busy
space with forwardfill enabled ingests messages the agent was never addressed in
and keeps raw platform payloads indefinitely — a volume profile unlike any
existing operational table. When retention arrives it should look like Agenta's
existing model (periodic, plan-configurable), not a per-row TTL.
