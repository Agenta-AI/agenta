# channel_connections

Channels stops sharing `gateway_connections` and gets its own table. This is the
design of that table, of the key it resolves on, and of the interface change the
platforms force.

Nothing is released, so the existing revision is edited in place. No compatibility
shims, no rename migration on the shared table.

## Why its own table

Two reasons, and the second is the one that would eventually have forced the move
anyway.

**Alignment.** Every other external identity in channels is a `*_locator` in `data`
plus an `external_key` column composed over the fields the adapter declares. A
connection is the third grain of the same thing and should read identically. Today
it is the odd one out: a raw string in `integration_key`, composed by nobody, with a
different name for the same job.

**The constraint we need is wrong for the gateway.** Ingress resolves the tenant
*from* this key, so it must be unique **globally** — across projects. That is
exactly wrong for the gateway, where two projects legitimately connect to the same
Composio product and must not collide. One table cannot hold both rules. This is
not a preference; it is why the current `LIMIT 1` exists and why it is unsafe.

A third reason, weaker but real: the gateway may not survive in its current form,
and channels should not be coupled to a table whose future is someone else's.

**The scope is small, and smaller than first claimed.** All eight channel tables
land in one head revision (`oss000000021_add_channels.py`), so a ninth is an edit to
a file no released database has run. Four source files touch the gateway connection:
`core/channels/service.py`, `core/channels/dtos.py`,
`apis/fastapi/channels/router.py`, `dbs/postgres/channels/dao.py`. The ~300
`integration_key` references in the tree are overwhelmingly tools, triggers and
Composio, which this does not touch.

## What the platforms actually do

Checked against the platforms' own documentation. Two results decide the schema.

### Enterprise Grid: an org-wide install is ONE connection

Settled, and it was the open question. An org-wide install is installed once at the
organization level and issues **a single token** covering every workspace in the
org. Events carry `is_enterprise_install: true` in their `authorizations`.

The consequence is the one that breaks the old rule: **both models can coexist for
one app.** Slack's own guidance is explicit that some installations may be on a
single workspace while others are deployed org-wide. So for one `api_app_id` there
can be an org-wide row *and* per-workspace rows, live at the same time.

Therefore `team_id` cannot be part of the identity:

- for the org-wide row it identifies nothing — the install spans many `team_id`s
- keying strictly on `team_id` fragments one logical installation into many rows,
  each holding the same token
- and a per-workspace install in the same org would collide with the org-wide one

The discriminator is **`enterprise_id` when `is_enterprise_install`, and `team_id`
otherwise**. Which is to say: the adapter chooses per install model, and core cannot.

### Telegram carries no identity in the body at all

Confirmed against the `Update` object's full field list: no bot field on any update
variant. The bot is identified **by the transport** — the webhook URL was registered
with that bot's token.

The mechanism Telegram gives us is `setWebhook`'s `secret_token`, echoed on every
request as `X-Telegram-Bot-Api-Secret-Token`. Per-bot, chosen by us, present always.

This is what forces the interface change below. It also collapses two steps into
one for that adapter: the secret is on every request, so resolving the connection
and verifying it are the same act — which is what the ingress already assumes.

### The rest, in brief

| platform | discriminator | on every payload |
| --- | --- | --- |
| slack | `api_app_id` + (`enterprise_id` or `team_id`) | yes, in two shapes |
| telegram | a secret token we minted | header only |
| discord | `application_id`; guild absent in DMs | yes |
| bridge | the credential the bridge presents | yes |
| agenta | the project | yes |

Slack has **two payload shapes**: `team_id` flat on Events API and slash commands,
`team` nested on interactivity. An extractor reading only `team_id` returns nothing
for a button click — the path we have not built yet.

## The rule, corrected

`connection-identity.md` concluded *"the key is the bot, and the tenant is a
qualifier."* **That rule is wrong** and this document supersedes it.

It fails at both ends. Enterprise Grid has no single tenant to qualify with, and
the bridge has no bot at all — a bridge fronts a platform we never see, so "bot" is
a Slack shape generalised into a rule. It was also right for the wrong reason: the
useful half was never *bot-versus-tenant*, it was *always-present versus
sometimes-absent*.

What replaces it:

**Core does not know what identifies a connection. The adapter declares it, and one
function composes it.** Same discipline as `SPACE` and `THREAD`, which already work
this way — and the reason it already works there is the reason it must work here.

So the grain joins the existing enum:

```
CONNECTION → connection_locator → external_key
SPACE      → space_locator      → external_key
THREAD     → thread_locator     → external_key
```

`compose_external_key(capabilities, grain, locator)` is already generic over grain,
so composing takes no new code. `ChannelKeyGrain` gains `CONNECTION`.

**One behaviour of it does need changing, and it is not cosmetic.** The function
returns `None` when the declaration names no fields for a grain. At `THREAD` that is
a legitimate answer — the platform has no threads, so the scope degrades to the
space. At `CONNECTION` there is no such case: a channel that declares no connection
key fields cannot be routed to at all, and a `None` there would resolve to no
connection and refuse every event **silently**.

That is the same failure the defaulted `installation_hint` produced once already. So
at `CONNECTION` grain an empty declaration raises rather than returns `None` — an
adapter that does not say what identifies its connections fails loudly, at
configuration time, instead of going quiet in production.

**The grain is `CONNECTION`, not `BOT`.** Grains name the row they key. "Bot" is the
product word and belongs in the UI, where a user does think of it as their bot.

What `external_key` identifies is **provider-defined**:

| provider | the unit a connection is |
| --- | --- |
| slack | one installation — an org-wide install, or an app in one workspace |
| telegram | one bot, identified by a secret on the header |
| discord | one application |
| bridge | **one bridge**, fronting a platform we do not know |
| agenta | one bot in one project |

The bridge row is the one that disproves any universal framing: many bridges, many
connections, one `provider_key`. This is already what `contract.md` commits to —
`provider_key="bridge"` selects the one adapter, and the second level distinguishes
every bridge.

## The table

```python
class ChannelConnectionDBA(
    ProjectScopeDBA, LifecycleDBA, IdentifierDBA, SlugDBA,
    HeaderDBA, DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    __abstract__ = True
    channel      = Column(String, nullable=False)   # the registry key
    external_key = Column(UUID,   nullable=False)   # uuid5 over the declared fields
    # data: { connection_locator: {...}, credentials: {...} }
```

Mixins follow `entities.md` §2: `ProjectScopeDBA`, `LifecycleDBA`, `IdentifierDBA`,
`FlagsDBA`, `TagsDBA`, `MetaDBA` on everything. `SlugDBA` because an operator
addresses a connection by name; `HeaderDBA` because they label it; `DataDBA` for the
locator and credentials; `StatusDBA` because verification is an attempt against the
outside world that can fail.

```python
class ChannelConnectionDBE(Base, ChannelConnectionDBA):
    __tablename__ = "channel_connections"
    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        # GLOBAL, deliberately not project-scoped — see below
        UniqueConstraint("channel", "external_key",
                         name="uq_channel_connections_external_key"),
        UniqueConstraint("project_id", "channel", "slug",
                         name="uq_channel_connections_project_channel_slug"),
        Index("ix_channel_connections_flags", "flags", postgresql_using="gin"),
    )
```

### The one constraint that is not project-scoped, and why that is not a violation

Every table in this codebase is project-scoped, and this one is too: `project_id` is
in the primary key, and every read except one is scoped by it.

The exception is the uniqueness of `(channel, external_key)`, and it has to be
global for a structural reason. **Ingress resolves the project *from* this key.**
It is the one query that cannot be project-scoped, because its job is to establish
the scope everything after it uses. A key unique only per project would let two
projects register the same installation, and one tenant's event would resolve
against the other's connection — picked by `LIMIT 1`.

So the rule is not weakened, it is stated precisely: **the table is project-scoped;
the external identity is global.** Those are consistent, because the external
identity belongs to the platform, not to us — one Slack installation exists once in
the world, so it may belong to exactly one project.

The constraint is what makes this true rather than hoped-for. Two projects claiming
one installation now fails at the database with a unique violation, at configuration
time, loudly — instead of silently misrouting at 3am.

**`slug` is out of the identity.** Today's key is
`(project_id, provider_key, integration_key, slug)`, which means two rows differing
only by slug are two names for one installation — exactly what `LIMIT 1` cannot
resolve. Slug stays unique per `(project, channel)` as a human label, and has
nothing to do with routing.

**`channel` is a plain `String`, not `ConnectionProviderKind`.** The enum was
always the wrong type here — `contract.md` already notes that a third party cannot
add a member to a Python enum, which is why every bridge shares one key. Leaving
the table free of the enum removes the coupling entirely: the adapter registry is
what decides which channels exist, and it is the thing that already knows.

### Multiple bots in one workspace: what actually makes it work

This is the case that started the redesign, and it is worth being exact about which
change fixes it, because it is not the one it appears to be.

Two Slack bots in one workspace are two rows differing in `api_app_id` — two
distinct apps, since a workspace cannot install the same app twice. Today they
collide because `integration_key` holds `team_id`, which is the *workspace*, so both
rows carry the same value and `LIMIT 1` picks one arbitrarily.

Three changes together fix it, and all three are needed:

1. **The key includes `api_app_id`**, so the two rows differ. The adapter declares
   this; core does not know the field exists.
2. **`slug` leaves the identity**, so the two rows cannot be *deliberately*
   distinguished by a name that resolution never reads.
3. **The lookup returns at most one row by constraint**, so `LIMIT 1` stops being
   load-bearing. A second match is now impossible rather than merely unlikely.

The same key covers the Enterprise Grid cases without a special path: an org-wide
install keys on `(api_app_id, enterprise_id)` and a workspace install on
`(api_app_id, team_id)`, which cannot collide with each other because the fields
differ. One project can hold an org-wide connection and per-workspace connections
for the same app at once, which is exactly what Slack permits.

### What moves onto the table

`data` carries two blocks:

- **`connection_locator`** — the platform's own fields, structured, exactly as
  reported. Same role as `space_locator` and `thread_locator`, and read back whole.
- **`credentials`** — encrypted at rest, never returned by any read, shaped by the
  credential schema the channel declares (`capabilities-v2.md` §1). A configured
  credential reads as "set", never as its value.

`StatusDBA` carries the verification outcome, which is what makes a connection
**configured** and separately **verified** (`provisioning.md` §3). Only a verified
connection is routable.

Per-connection capability overrides also live here, in `data`, because
`capabilities-v2.md` makes the declaration a property of the connection: two Slack
connections differ when one is an Agenta-owned app and the other the customer's own,
and when a workspace declines a scope at install.

## The interface change

`installation_hint(body: bytes)` cannot answer for Telegram, whose identity is a
header, and answers only half the cases for Slack, whose interactivity payloads nest
`team` where events put `team_id`. It is replaced:

```python
@abstractmethod
def connection_locator(
    self, *, headers: Mapping[str, str], path: str, body: bytes,
) -> Optional[Dict[str, Any]]:
    """The connection this request claims to come from, read without any secret.

    Returns the platform's own fields — core composes the key. Unverified and
    untrusted: it only selects which secret the signature is then checked with.
    A wrong or forged locator resolves to no connection, or to one whose secret
    fails, and both refuse identically.
    """
```

Three changes in one signature, each forced by a platform:

- **headers** — Telegram's secret token, and it is the only identity it has
- **path** — a per-bot URL is the alternative Telegram mechanism, and they compose
- **returns a locator, not a string** — so core composes the key, keeping *one
  function composes it, no exceptions* true here as everywhere else

It stays **abstract**. Defaulting it to `None` is what silently broke the mock
adapter once already: an adapter that does not answer refuses every event, which is
invisible. Non-participation must fail at construction.

`verify_signature` already takes the connection and is unchanged.

## The resolve, rewritten

```python
async def get_project_and_connection_by_external_key(
    self, *, channel: str, external_key: UUID,
) -> Optional[Tuple[UUID, UUID]]:
```

`LIMIT 1` goes. The unique constraint means at most one row matches, so a second
match is a database error rather than a silent arbitrary pick.

The ingress order is unchanged and already correct — resolve the candidate from the
unverified claim, then verify against its secret, then check the verified identity
matches the connection the secret came from. The last step stays, because an adapter
deriving the id from the body could still return one belonging to a different
install.

Two failures collapse into the existing one: a locator that composes to no row, and
a locator missing a declared field (`ChannelLocatorIncomplete`). Both refuse
**identically to a bad signature** — no diagnostic detail, no distinguishable
response. Anything else turns the route into an oracle for which installations
exist. This was a real regression once; it is written down so it is not one twice.

## Migration

Edited into `oss000000021_add_channels.py`, the head revision, which already creates
every channels table.

- add `create_table("channel_connections", ...)` alongside the other eight
- the drop goes in `downgrade()` in reverse order, as the others do
- `ConnectionProviderKind` loses `SLACK` and `BRIDGE`, returning to `COMPOSIO` and
  `AGENTA` — the two the gateway actually has
- `channel_connections.channel` is a `String`, so nothing in channels constrains
  which channels exist except the adapter registry

**Not a pytest test.** Alembic upgrade/downgrade is a by-hand check against Docker
and Postgres: a downgrade drops tables, so a test is either destructive or a lie.

## Still open

- **Whether an operator can move a connection between projects.** The global
  constraint permits it (delete and re-register), but nothing yet decides whether it
  is offered, and what happens to the threads and spaces underneath.
- **Teams' bot-identity convention** is community-sourced, not confirmed. Verify
  before building, not after — the Enterprise Grid result is what happens when a
  plausible model meets the documentation.
- **What a Slack Connect channel does to the key**, where a shared channel spans two
  orgs. Known to be irregular; not yet checked.
