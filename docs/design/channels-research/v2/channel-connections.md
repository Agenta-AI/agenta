# channel_connections

Channels stops sharing `gateway_connections` and gets its own table. This is the
design of that table, of the key it resolves on, and of the two interface changes
the platforms force.

Written after reading the design set and the channels source rather than from
memory. Where it contradicts an earlier document, the contradiction is stated
rather than left for a reader to find — `entities.md` §1 in particular argues the
opposite conclusion and is superseded here.

Nothing is released, so the existing revision is edited in place. No compatibility
shims, no rename migration on the shared table.

## What `entities.md` decided, and why it no longer holds

`entities.md` is explicit that the connection is reused, and the argument was
sound when written:

> A Slack app becomes a `gateway_connections` row with a native `provider_key`.
> The existing service already has an adapter port documented as awaiting a second
> implementation, and a registry keyed by provider — so this is the second use of
> an existing pattern, not a new one.
>
> **No channels-specific columns are added to the shared table.**

That second sentence is the load-bearing one, and it is the one that has since
failed. The premise was that channels needs nothing on the connection. Four things
now do, and each was discovered by building rather than by arguing:

- **A credential schema.** Six key names across two adapters — `signing_secret`,
  `bot_token`, `bot_user_id`, `team_id` for Slack; `secret`, `delivery_url` for the
  bridge — none declared anywhere, one pair admitted invented (`F47`).
- **A per-connection capability declaration.** Two app models differ in capability,
  and a workspace can decline a scope at install (`capabilities-v2.md`).
- **Verification state.** A connection is configured and separately verified, and
  only a verified one is routable (`provisioning.md` §3).
- **A globally-unique identity.** `F46`, still open, and the subject of the next
  section.

`capabilities.md` §6 already conceded the direction without naming the table:
*"Provisioning state… lives with the connection."*

So the choice is not "reuse a clean shared table" versus "fork it". It is "add four
channel-specific concerns to a table shared with tools and triggers" versus "own
one". `entities.md`'s own rule — *no channels-specific columns on the shared table*
— is what forces the split once the concerns exist. The conclusion is reversed;
the rule that produced it is kept.

A second reason, weaker but real: the gateway may not survive in its current form,
and channels should not be coupled to a table whose future is someone else's.

**The scope is small, and smaller than I first claimed.** All eight channel tables
land in one head revision (`oss000000021_add_channels.py`), so a ninth is an edit to
a file no released database has run. Four source files touch the gateway connection:
`core/channels/service.py`, `core/channels/dtos.py`,
`apis/fastapi/channels/router.py`, `dbs/postgres/channels/dao.py`. The ~300
`integration_key` references in the tree are overwhelmingly tools, triggers and
Composio, which this does not touch. Channels holds exactly one connections route,
read-only, and never writes the shared table.

## What the platforms actually do

Checked against the platforms' own documentation. Two results decide the schema.

### Enterprise Grid: an org-wide install is ONE connection

Settled, and it was the open question. An org-wide install is installed once at the
organization level and issues **a single token** covering every workspace in the
org. Events carry `is_enterprise_install: true` in their `authorizations`.

The consequence is the one that breaks the earlier rule: **both models can coexist
for one app.** Slack's own guidance is explicit that some installations may be on a
single workspace while others are deployed org-wide. So for one `api_app_id` there
can be an org-wide row *and* per-workspace rows, live at the same time.

Therefore `team_id` cannot be the identity:

- for the org-wide row it identifies nothing — the install spans many `team_id`s
- keying strictly on `team_id` fragments one logical installation into many rows,
  each holding the same token
- and a per-workspace install in the same org would collide with the org-wide one

The discriminator is **`enterprise_id` when `is_enterprise_install`, and `team_id`
otherwise** — chosen by the adapter, per install model. Core cannot make that choice
and must not try.

This also confirms, from a second direction, something `channels.md` already
recorded about the *same* field set:

> **`identity.scope` is a per-install fact, not a per-channel one.** Whether a
> Slack workspace sits inside an Enterprise Grid changes what a user id means,
> but the capability declaration is fetched once per *channel*, not per
> *connection*.

Same defect, different block of the same declaration. That is what makes the
per-connection declaration one change rather than two.

### Telegram carries no identity in the body at all

Confirmed against the `Update` object's full field list: no bot field on any update
variant. The bot is identified **by the transport** — the webhook URL was registered
with that bot's token.

The mechanism Telegram gives us is `setWebhook`'s `secret_token`, echoed on every
request as `X-Telegram-Bot-Api-Secret-Token`. Per-bot, chosen by us, present always.

It also collapses two steps into one for that adapter: the secret is on every
request, so resolving the connection and verifying it are the same act — which is
what the ingress already assumes.

### The rest, in brief

| platform | discriminator | where it rides |
| --- | --- | --- |
| slack | `api_app_id` + (`enterprise_id` or `team_id`) | body, in two shapes |
| telegram | a secret token we minted | **header only** |
| discord | `application_id`; guild absent in DMs | body |
| bridge | the credential the bridge presents | header |
| agenta | the project | — |

Slack has **two payload shapes**: `team_id` flat on Events API and slash commands,
`team` nested on interactivity. The current extractor reads both, which is right,
and is the only part of `installation_hint` that survives unchanged.

## The rule, corrected

`connection-identity.md` concluded *"the key is the bot, and the tenant is a
qualifier."* **That rule is wrong** and this document supersedes it. It fails at
both ends: Enterprise Grid has no single tenant to qualify with, and the bridge has
no bot at all — a bridge fronts a platform we never see. `contract.md` already said
so, and I should have read it before generalising Slack's shape into a rule.

What replaces it is not new — it is the rule `entities.md` and `capabilities.md`
already state for the other grains:

> **One function composes the key, and adapters never call it.** What an adapter
> supplies is the locator, plus a declaration of which of its fields identify a
> place at each grain. Core does the composing, the same way every time.

A connection is the third grain of that same thing. So:

```text
CONNECTION → connection_locator → external_key
SPACE      → (the event locator) → external_key
THREAD     → (the event locator) → external_key
```

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

The bridge row is what disproves any universal framing: many bridges, many
connections, one `provider_key`. `contract.md` commits to exactly this — the fixed
key `bridge` selects the one adapter, and the second level distinguishes every
bridge.

### `compose_external_key` needs one behaviour change

It is generic over grain, so composing takes no new code. But it returns `None` when
the declaration names no fields for a grain, and `entities.md` calls that
totality a load-bearing property:

> **It is total over grains.** A `None` at thread grain is a legitimate answer, not
> an error — it is what makes the platform-has-no-threads case the same code path as
> scope-is-the-space.

At `CONNECTION` grain there is no such case. A channel that declares no connection
key fields cannot be routed to at all, and a `None` there would resolve to no
connection and refuse every event **silently** — the same failure the defaulted
`installation_hint` produced once already.

So `None` stays legitimate at `THREAD` and raises at `CONNECTION`. The function
stays total over the grains where totality means something, which is the property
`entities.md` was actually protecting.

## The table

```python
class ChannelConnectionDBA(
    ProjectScopeDBA, LifecycleDBA, IdentifierDBA, SlugDBA,
    HeaderDBA, DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    __abstract__ = True
    channel      = Column(String, nullable=False)   # the registry key
    external_key = Column(UUID,   nullable=False)   # uuid5 over the declared fields
    # data: { connection_locator: {...}, credentials: {...}, capabilities: {...} }
```

Mixins per `entities.md` §2, which is followed literally including the parts that
look like ceremony (D31). `ProjectScopeDBA`, `LifecycleDBA`, `IdentifierDBA`,
`FlagsDBA`, `TagsDBA`, `MetaDBA` on everything, no exceptions. Then the four that
answer a question: `SlugDBA` because an operator addresses a connection by name;
`HeaderDBA` because they label it; `DataDBA` for the locator, credentials and
per-connection declaration; `StatusDBA` because verification is an attempt against
the outside world that can fail — which is exactly what `entities.md`'s status table
already lists `gateway_connections` as using.

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

### The one constraint that is not project-scoped

This is the part that departs from every other table in the domain, so it needs to
survive the rule it appears to break.

`entities.md` states the rule as structural: *"Tenant scope is structural, not a
filter someone remembers"*, with exactly one sanctioned exception — the ingress
lookup, unscoped *"because an inbound platform event carries no tenant, so this
lookup recovers the project before anything else can be scoped."*

The table is project-scoped: `project_id` is in the primary key, and every read
except that one is scoped by it. What is global is only the **uniqueness of the
external identity**, and it has to be, for the same reason the read is unscoped: the
read establishes the scope, so its key cannot depend on the scope it establishes. A
key unique only per project would let two projects register the same installation,
and one tenant's event would resolve against the other's connection — chosen by
`LIMIT 1`.

That is `F46`, open, found as a real nondeterministic test failure where a fixture
reusing an `integration_key` across parallel workers resolved into a different
test's project. It is filed as *"decide whether the cross-tenant uniqueness is an
invariant to enforce… or whether the lookup should carry a scope."* This is that
decision: **enforce it**, because the lookup provably cannot carry a scope.

So the rule is not weakened but stated precisely: **the table is project-scoped; the
external identity is global.** Those are consistent, because the external identity
belongs to the platform rather than to us — one Slack installation exists once in
the world, so it may belong to exactly one project.

And it is why the constraint could not live on the shared table. The gateway needs
the opposite rule: two projects legitimately connect to the same Composio product.
One table cannot hold both.

**`slug` leaves the identity.** Today's key is
`(project_id, provider_key, integration_key, slug)`, so two rows differing only by
slug are two names for one installation — exactly what `LIMIT 1` cannot resolve.
Slug stays unique per `(project, channel)` as a human label, with no routing role.

**`channel` is a plain `String`, not `ConnectionProviderKind`.** That enum was
always the wrong type here: `contract.md` notes a third party cannot add a member to
a Python enum, which is why every bridge shares one key, and `F4` records the enum
serving two vocabularies with the underlying question left open — *"revisit when the
second adapter lands"*, which has now happened twice. Leaving the table free of it
removes the coupling: the adapter registry decides which channels exist, and it is
the thing that already knows. `ConnectionProviderKind` returns to `COMPOSIO` and
`AGENTA`, the two the gateway actually has.

### Multiple bots in one workspace: what actually makes it work

The case that started the redesign, and worth being exact about, because the change
that appears to fix it is not sufficient alone.

Two Slack bots in one workspace are two rows differing in `api_app_id` — two
distinct apps, since a workspace cannot install one app twice. Today they collide
because `integration_key` holds `team_id`, the *workspace*, so both rows carry the
same value and `LIMIT 1` picks one arbitrarily.

Three changes are each necessary:

1. **The key includes `api_app_id`**, so the two rows differ. The adapter declares
   this; core does not know the field exists.
2. **`slug` leaves the identity**, so two rows cannot be deliberately distinguished
   by a name resolution never reads.
3. **The lookup returns at most one row by constraint**, so `LIMIT 1` stops being
   load-bearing. A second match becomes impossible rather than merely unlikely.

Enterprise Grid needs no special path: org-wide keys on
`(api_app_id, enterprise_id)`, workspace on `(api_app_id, team_id)`, and they cannot
collide because the fields differ. One project can hold an org-wide connection and
per-workspace connections for the same app at once, which is what Slack permits.

**But routing to the right row is not yet enough**, because of the registry.

## The registry holds one adapter per channel, and that is the deeper problem

`ChannelAdapterRegistry` is `Dict[str, ChannelAdapterInterface]` — **one instance per
channel key**. So one `SlackAdapter` serves every Slack connection and one
`BridgeAdapter` serves every bridge. Three consequences are live in the tree today:

- **`fetch_capabilities()` takes no connection at all.** `BridgeAdapter` and
  `MockAdapter` return `self._capabilities`, fixed at construction. So a second
  bridge is validated against the first's declared locator fields — the open half of
  `F45`, guarded by a strict-xfail test.
- **`parse_event` reads `self._connection`** for the bot-user id, with no per-call
  override. Under the shared instance that is `None`, so bot-authored filtering
  silently does not work for any tenant — the safeguard D23 and §8.7 both rely on.
- **`verify_signature` falls back to `self._connection`** when the caller passes
  none.

So resolving to the correct connection row fixes *which credentials* are used, and
does not fix *which declaration* is read. The table is necessary and not sufficient.

That makes the per-connection declaration part of the same change rather than a
follow-on, which is what `capabilities-v2.md` §"Why these three are one change"
argues on independent grounds — and `channels.md` reached it a third time from rate
limits: *"backfill limits are therefore per connection, not per channel."* Three
routes to one conclusion.

**The declaration therefore hangs off the connection row**, in `data`, with the
channel supplying the default. `fetch_capabilities` takes the connection.

## The two interface changes

Both touch `ChannelAdapterInterface`, which is frozen after C0 and edited only at a
checkpoint. This is that conversation.

### 1. Ingress resolution must see the whole request

`installation_hint(body)` cannot answer for Telegram, whose identity is a header:

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

Three changes, each forced by something:

- **headers** — Telegram's secret token, its only identity
- **path** — a per-bot URL is Telegram's alternative mechanism, and they compose
- **returns a locator, not a string** — so core composes the key, keeping *"one
  function composes it, no exceptions"* true here as everywhere else

It stays **abstract**. Defaulting it to `None` silently broke the mock adapter once;
non-participation must fail at construction rather than refuse every event quietly.

Note the plan already named the ordering constraint this lives inside: *"`_ingest`
looks the adapter up before verifying, but a credential-derived channel is not known
until verification."* Resolution by locator does not dissolve that for the bridge —
the bridge's locator is its credential — which is why the claim selects the secret
and decides nothing.

### 2. The interface must stop lying about `verify_signature`

Found while reading, and it is a defect independent of this design.

The interface declares `verify_signature(headers, body)`. **Both adapters implement
`verify_signature(headers, body, connection=None)`, and the ingress calls it with
`connection`.** So the declared contract describes a method nobody implements and
nobody calls, and an adapter written against it breaks at the ingress.

The contract suite does not catch this: it calls `verify_signature(headers=…,
body=…)` and passes only because every adapter defaults `connection` to `None` and
falls back to a constructor-held one. That is the recurring defect shape — the suite
exercises a construction production does not use — and it is the *fourth* instance.

`connection` becomes a declared parameter, not an optional afterthought.

### What the contract suite does and does not enforce

Worth stating, because it is weaker than it looks. The AST check asserts every
method is keyword-only after `*` — but it walks `ast.AsyncFunctionDef` only, and
asserts a hardcoded `checked == 7`. There are **eight** abstract methods;
`installation_hint` is the one sync method, so **it is invisible to the check**. Any
new sync method is equally invisible.

So the suite would not have caught either defect above. It should walk
`FunctionDef` as well, and derive the count from the class rather than hardcoding
it.

## Migration

Edited into `oss000000021_add_channels.py`, the head revision, which already creates
every channels table.

- add `create_table("channel_connections", ...)` alongside the other eight
- the drop goes into `downgrade()` in reverse order, as the others do
- `ConnectionProviderKind` loses `SLACK` and `BRIDGE`

**Not a pytest test.** `plan.md` states the rule and the reason: a downgrade drops
the tables, so running it against a shared database destroys whatever else is using
them. Checked by hand against local Docker Postgres.

## Who resolves the credential reference

The credential is a secret row, and the connection carries a reference to it. That
leaves a question no document had answered: **every adapter reads its credential as
a flat key off `connection.data`** — `signing_secret`, `bot_token`, `secret`,
`delivery_url` — so a connection carrying only a reference hands each adapter
nothing, and every channel with credentials stops working the moment the write path
starts storing them properly.

**The service hydrates; the adapter never sees the store.** `fetch_connection`
resolves the reference and returns a connection whose `data` carries the credential
fields where the adapters already read them. What is *stored* is a reference; what is
*passed to an adapter* is resolved. Three reasons this is the right seam:

- An adapter that reached the secret store would need the store, the request-scoped
  key, and a reason to be trusted with both. Its whole contract is that it is handed
  what it needs.
- The alternative — every adapter learning to resolve a reference — is the same
  logic written once per channel, which is what the port exists to prevent.
- The layering already puts this in the service: the router never touches a DAO, and
  the adapter is not a layer at all.

**Nothing serialises a hydrated connection.** The routes answer with their own
response models, where a configured credential reads as `"set"` and never as its
value. A hydrated connection is a runtime object on the path from the service to an
adapter, and if one ever reaches a response body that is a defect in the response
model, not in this rule.

## What this does not change

**`external_locator` keeps its name**, and no locator is renamed. I proposed
`message_locator` in conversation; that was wrong twice over.

`entities.md` argues the naming rule directly: *"Prefixing with `space_` or
`thread_` would restate the table name in the column name and make two identical
concepts look like two different ones."* The stored column is `external_locator` on
all four entities and stays that way.

The second reason is that my premise about the DTO was factually wrong.
`ChannelInboundEvent` does carry `space_locator` and `thread_locator` — but **the
ingress drops both.** Only `external_locator` reaches `ChannelInboxEventData`, and
both grains compose from it via `identity.keys[grain]`. Nothing in production reads
the other two; only tests do. So there is no three-locator naming inconsistency to
resolve — there is one locator that survives and two vestigial fields, which is a
finding rather than a rename.

`connection_locator` is consistent with that: it is a **parameter name** on a method,
not a stored column, and it names the grain because at that point there is no table
to say which grain it is.

## Still open

- ~~**The two vestigial DTO fields.**~~ **Settled: both deleted.** Composition takes
  the declared subset of the one `external_locator` per grain, which is what made a
  per-grain locator redundant rather than merely unused. `F28` turned out to be a
  live defect in `external_locator` too, not a harmless one in a field nothing reads.
- **Whether an operator can move a connection between projects.** The global
  constraint permits delete-and-re-register, but nothing decides whether it is
  offered, or what happens to the threads and spaces underneath.
- **Teams' bot-identity convention** is community-sourced and unconfirmed. Verify
  before building — Enterprise Grid is what happens when a plausible model meets the
  documentation.
- **Slack Connect channels**, where a shared channel spans two orgs. Known to be
  irregular; not checked.
- **`architecture.md` §8.1 says "there is no shared vendor app to compromise."**
  `provisioning.md` §0 now designs one. That is a real contradiction in the security
  posture and needs settling as a product decision, not silently by whichever
  document is read second.
