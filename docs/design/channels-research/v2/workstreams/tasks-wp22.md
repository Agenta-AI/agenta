# WP22 — tasks

Spec: [specs-wp22.md](specs-wp22.md). Design: `channel-connections.md`, `grants.md`.

Starts after WP21 merges. One migration, edited in place.

## channel_connections

- [x] `ChannelConnectionDBA` / `DBE` in `dbs/postgres/channels/`, mixins per the spec.
- [x] `UniqueConstraint("channel", "external_key")` — **no `project_id`**. Comment
      the one line stating why, and only that line.
- [x] `UniqueConstraint("project_id", "channel", "slug")` — the human label.
- [x] `ChannelKeyGrain.CONNECTION`.
- [x] `compose_external_key` raises at `CONNECTION` grain on an empty declared field
      set; unchanged at `THREAD`.
- [x] `ChannelConnection` becomes a real DTO, not an alias for the gateway's
      `Connection`. Create / Edit / Query variants per D31: `*Create` drops
      `Identifier` and `Lifecycle`; `*Edit` drops `channel` and `external_key`,
      because repointing a connection at another installation is a different row.
- [x] `get_project_and_connection_by_external_key(channel, external_key)` replaces
      the `external_id` lookup. **Delete the `LIMIT 1`** — the constraint now makes a
      second match impossible, and leaving it hides a violation.
- [x] The four channels files stop importing `gateway.connections`:
      `core/channels/service.py`, `core/channels/dtos.py`,
      `apis/fastapi/channels/router.py`, `dbs/postgres/channels/dao.py`.
      Partial: `service.py`'s pre-existing connection-fetching methods
      (`create_agent`, `create_space`, `discover_spaces`, `resolve_effective_policy`,
      `resolve`) still take a duck-typed `connections_service` and resolve
      connections against the shared gateway table — only the import is gone, not
      the runtime dependency. See report.
- [x] `ConnectionProviderKind` loses `SLACK` and `BRIDGE`. Checked the eight `.value`
      call sites across tools, triggers and gateway — all generic over the enum
      value, none hardcode `slack`/`bridge`, unaffected by the removal.

## Grants

- [x] `ChannelGrantEffect` — `ALLOW`, `DENY`.
- [x] `effect` not-null; `kind` and `space_id` both nullable.
- [x] Write-time rejection when both are null or both are set.
- [x] Two partial unique indexes replacing `uq_channel_grants_agent_space`, one
      where `space_id IS NOT NULL`, one where `kind IS NOT NULL`, each including
      `effect`. **NULLs are distinct in Postgres** — the single constraint stops
      working the moment either column is nullable.
- [x] `uq_channel_grants_default` covers `kind`; a `DENY` row may not carry
      `is_default`.
- [x] `resolve`: deny-first evaluation. No matching rule still refuses.
- [x] Space rows are get-or-created on first contact and **no longer gate**
      permission. Delete the default-deny-on-missing-space branch; the refusal now
      comes from the grant evaluation.

## CHANNEL_SECRET

- [x] `SecretKind.CHANNEL_SECRET`.
- [x] `ChannelSecretKind` inner enum — `slack`, `agenta` for now.
- [x] `ChannelSecretDTO` / `ChannelSecretSettingsDTO`, wrapped as `data.channel`.
- [x] One branch in the secrets DTO discriminator, matching the four beside it.
- [x] Migration: `ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'CHANNEL_SECRET'`.
      Postgres cannot drop an enum value; say so in the downgrade comment as the
      existing migration does.

## Migration

- [x] All of the above edited **into `oss000000021_add_channels.py`**. No new
      revision — nothing is released and the chain must stay linear.
- [x] `downgrade()` drops the new table in reverse order with the others.
- [ ] Applied and downgraded **by hand** against local Docker Postgres. Not a pytest
      test, ever: a downgrade drops tables and the local database is shared.
      **Unverified — this is a by-hand step for someone with a local Postgres,
      not taken here.**

## Tests

- [x] `compose_external_key` at `CONNECTION` grain — composes, and raises on empty.
- [x] Two projects registering one `(channel, external_key)` violate the constraint.
      Written as an integration test (`test_channels_default_indexes.py`); unrun.
- [x] Ingress lookup returns one row without `LIMIT 1`. DAO uses `.one_or_none()`,
      which raises `MultipleResultsFound` rather than silently picking one.
- [x] Grants: kind-allow admits an unconfigured space; id-deny beats kind-allow; no
      rule refuses; both-null is rejected at write.
- [x] A DM resolves where a kind-allow exists and **no space row was pre-created** —
      this is `F51`'s regression test and the reason the wave exists.
- [x] `CHANNEL_SECRET` round-trips encrypted and never appears in a read response.
      Written as an integration test (`test_secrets_channel_secret_roundtrip.py`);
      unrun.

## Done when

- [ ] Migration verified by hand, both directions. **Not done — by-hand step.**
- [x] `grep -rn "gateway.connections" api/oss/src/core/channels api/oss/src/apis/fastapi/channels api/oss/src/dbs/postgres/channels`
      returns nothing.
- [x] `F46` closed: the global `(channel, external_key)` constraint now exists and
      is asserted by an (unrun) integration test.
      `F51` closed for `resolve`'s own gate: deny-first grant evaluation replaces
      default-deny-on-missing-space, proven by unit tests against a fake DAO and
      an unrun integration test against real Postgres.

## Watch for

- **The nullable-column unique trap.** It is silent: the constraint still exists,
  still shows in `\d`, and stops preventing anything. Assert the duplicate is
  rejected rather than assuming. Done via the two `IntegrityError` assertions in
  `test_channels_default_indexes.py` (unrun; written against real Postgres).
- **`resolve`'s deleted branch.** Removing default-deny-on-missing-space is the one
  change that could open access if the grant evaluation is wrong. Land the grant
  tests before deleting the branch, not after. Done: `evaluate_grant_effect`'s
  deny-first unit tests (`test_channels_grant_evaluation.py`) were written and run
  green before `resolve`'s branch was touched.
