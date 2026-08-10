# WP22 — Schema: connections, grants, secrets

Three schema changes, one migration, edited **in place** into `oss000000021`.
Nothing is released, so there is no compatibility to preserve and no second
revision to add.

Design: `channel-connections.md`, `grants.md`, `journeys.md` §0.

## Why the three land together

They are one migration and one set of DTO changes. Splitting them means three
hand-verified migration runs against Docker Postgres for one wave, and two of the
three are prerequisites for WP23's single write path.

## 1. `channel_connections`

Channels stops sharing `gateway_connections`. The full argument is in
`channel-connections.md`; the two load-bearing reasons are that the constraint
channels needs is *wrong* for the gateway, and that four channel-specific concerns
now want columns on a table shared with tools and triggers.

```python
class ChannelConnectionDBA(
    ProjectScopeDBA, LifecycleDBA, IdentifierDBA, SlugDBA,
    HeaderDBA, DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    __abstract__ = True
    channel      = Column(String, nullable=False)
    external_key = Column(UUID,   nullable=False)
    # data: { connection_locator, credentials_ref, capabilities, setup }
```

```python
__table_args__ = (
    ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
    PrimaryKeyConstraint("project_id", "id"),
    UniqueConstraint("channel", "external_key",
                     name="uq_channel_connections_external_key"),
    UniqueConstraint("project_id", "channel", "slug",
                     name="uq_channel_connections_project_channel_slug"),
    Index("ix_channel_connections_flags", "flags", postgresql_using="gin"),
)
```

**The first unique constraint is deliberately not project-scoped**, and it is the
only such constraint in the domain. The ingress resolves the project *from* this
key, so the key cannot depend on the scope it establishes. `F46` is that gap, found
as a real cross-tenant test failure; this is its fix. The table itself is
project-scoped — `project_id` is in the primary key and every other read is scoped.

**`slug` leaves the identity.** Two rows differing only by slug are two names for
one installation, which is what makes today's `LIMIT 1` resolve arbitrarily.

**`channel` is a plain `String`.** `ConnectionProviderKind` loses `SLACK` and
`BRIDGE`, returning to the two the gateway actually has. A third party cannot extend
a Python enum, which is why every bridge already shares one key.

`ChannelKeyGrain` gains `CONNECTION`, and `compose_external_key` **raises** at that
grain when the declaration names no fields — where `None` at `THREAD` grain stays
legitimate. A connection that composes to nothing is unroutable and would refuse
every event silently.

## 2. Grants carry allow and deny, by kind or by id

`F51`: permission is encoded today as *"somebody pre-created a space row"*, which
only `topic` spaces can be. Every DM is silently refused.

```python
class ChannelGrantDBA(...):
    agent_id = Column(UUID, nullable=False)
    effect   = Column(Enum(ChannelGrantEffect), nullable=False)   # ALLOW | DENY
    kind     = Column(Enum(ChannelSpaceKind),   nullable=True)
    space_id = Column(UUID,                     nullable=True)
```

Exactly one of `kind` and `space_id` is set; both null matches nothing and is
rejected at write time.

Evaluation, in `resolve`: **any matching DENY refuses; else any matching ALLOW
allows; else refuse.** Deny wins regardless of specificity — most-specific-wins is
what D25 rejects, and a narrow deny beating a broad allow *is* D25's own rule.

**Space rows stop authorising.** They are still created — they own the inbox log,
the backfill guard, a policy level and the session-id fallback — but by
get-or-create on first contact, exactly as threads are.

**The unique constraints must be rebuilt.** `(project_id, agent_id, space_id)` stops
preventing duplicates the moment `space_id` is nullable, because Postgres treats
NULLs as distinct. Two partial unique indexes replace it, one per branch, each
including `effect`. `uq_channel_grants_default` must cover `kind` too, since "the
default agent for any DM" becomes expressible; a DENY row may never carry
`is_default`.

## 3. `CHANNEL_SECRET`

A new `SecretKind`, **nested** the way `PROVIDER_KEY`/`StandardProviderKind` already
is: `data.kind` is the channel and decides the body.

| outer | `data.kind` | body |
| --- | --- | --- |
| `CHANNEL_SECRET` | `slack` | `bot_token`, `signing_secret` |
| `CHANNEL_SECRET` | `agenta` | empty |

Wrapped as `data.channel`, matching `data.provider` and `data.secret` on the four
kinds that exist. `ChannelSecretDTO` / `ChannelSecretSettingsDTO`.

**Not `CUSTOM_SECRET`**, which is for secrets a person names and manages; a channel
credential is machine-written from a fixed shape and meaningless outside its
connection.

**That nesting is the credential schema.** `capabilities-v2.md` proposes a separate
field-list mechanism; the discriminator already validates what is stored, so the
declaration's remaining job is what the *form* renders — labels, help text, which
field is a password box.

## Files

- the migration `oss000000021_add_channels.py` — edited in place
- `dbs/postgres/channels/{dbas,dbes,mappings,dao}.py`
- `core/channels/{dtos,interfaces,service}.py` — DTOs, grain, grant evaluation
- `core/secrets/{enums,dtos}.py` — one member, one inner enum, one branch
- `core/gateway/connections/dtos.py` — remove `SLACK`, `BRIDGE`

## Tests

Unit, plus integration for the DAO.

- `compose_external_key` at `CONNECTION` grain: composes from declared fields;
  **raises** on an empty declaration; still returns `None` at `THREAD` grain.
- The ingress lookup returns at most one row, by constraint rather than by `LIMIT 1`.
- Two projects cannot register the same `(channel, external_key)`.
- Grant evaluation: kind-allow admits an unconfigured space; id-deny beats
  kind-allow; no rule refuses; a deny with no allow refuses.
- Both partial unique indexes reject their duplicate.
- A `CHANNEL_SECRET` round-trips through `PGPString` and never appears in a read.

## Done when

- The migration applies and downgrades cleanly **by hand** against Docker Postgres.
- A DM resolves to an agent where a kind-allow exists and no space row was
  pre-created.
- `F46`, `F51` closed; `F6`/`F47` remain open until WP23.

## Out of scope

The write path (WP23). This package makes the rows expressible; nothing yet creates
one through an API.

Migration tests in pytest. A downgrade drops tables; verify by hand.
