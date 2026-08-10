# WP22 — tasks

Spec: [specs-wp22.md](specs-wp22.md). Design: `channel-connections.md`, `grants.md`.

Starts after WP21 merges. One migration, edited in place.

## channel_connections

- [ ] `ChannelConnectionDBA` / `DBE` in `dbs/postgres/channels/`, mixins per the spec.
- [ ] `UniqueConstraint("channel", "external_key")` — **no `project_id`**. Comment
      the one line stating why, and only that line.
- [ ] `UniqueConstraint("project_id", "channel", "slug")` — the human label.
- [ ] `ChannelKeyGrain.CONNECTION`.
- [ ] `compose_external_key` raises at `CONNECTION` grain on an empty declared field
      set; unchanged at `THREAD`.
- [ ] `ChannelConnection` becomes a real DTO, not an alias for the gateway's
      `Connection`. Create / Edit / Query variants per D31: `*Create` drops
      `Identifier` and `Lifecycle`; `*Edit` drops `channel` and `external_key`,
      because repointing a connection at another installation is a different row.
- [ ] `get_project_and_connection_by_external_key(channel, external_key)` replaces
      the `external_id` lookup. **Delete the `LIMIT 1`** — the constraint now makes a
      second match impossible, and leaving it hides a violation.
- [ ] The four channels files stop importing `gateway.connections`:
      `core/channels/service.py`, `core/channels/dtos.py`,
      `apis/fastapi/channels/router.py`, `dbs/postgres/channels/dao.py`.
- [ ] `ConnectionProviderKind` loses `SLACK` and `BRIDGE`. Check the eight `.value`
      call sites across tools, triggers and gateway still pass.

## Grants

- [ ] `ChannelGrantEffect` — `ALLOW`, `DENY`.
- [ ] `effect` not-null; `kind` and `space_id` both nullable.
- [ ] Write-time rejection when both are null or both are set.
- [ ] Two partial unique indexes replacing `uq_channel_grants_agent_space`, one
      where `space_id IS NOT NULL`, one where `kind IS NOT NULL`, each including
      `effect`. **NULLs are distinct in Postgres** — the single constraint stops
      working the moment either column is nullable.
- [ ] `uq_channel_grants_default` covers `kind`; a `DENY` row may not carry
      `is_default`.
- [ ] `resolve`: deny-first evaluation. No matching rule still refuses.
- [ ] Space rows are get-or-created on first contact and **no longer gate**
      permission. Delete the default-deny-on-missing-space branch; the refusal now
      comes from the grant evaluation.

## CHANNEL_SECRET

- [ ] `SecretKind.CHANNEL_SECRET`.
- [ ] `ChannelSecretKind` inner enum — `slack`, `agenta` for now.
- [ ] `ChannelSecretDTO` / `ChannelSecretSettingsDTO`, wrapped as `data.channel`.
- [ ] One branch in the secrets DTO discriminator, matching the four beside it.
- [ ] Migration: `ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'CHANNEL_SECRET'`.
      Postgres cannot drop an enum value; say so in the downgrade comment as the
      existing migration does.

## Migration

- [ ] All of the above edited **into `oss000000021_add_channels.py`**. No new
      revision — nothing is released and the chain must stay linear.
- [ ] `downgrade()` drops the new table in reverse order with the others.
- [ ] Applied and downgraded **by hand** against local Docker Postgres. Not a pytest
      test, ever: a downgrade drops tables and the local database is shared.

## Tests

- [ ] `compose_external_key` at `CONNECTION` grain — composes, and raises on empty.
- [ ] Two projects registering one `(channel, external_key)` violate the constraint.
- [ ] Ingress lookup returns one row without `LIMIT 1`.
- [ ] Grants: kind-allow admits an unconfigured space; id-deny beats kind-allow; no
      rule refuses; both-null is rejected at write.
- [ ] A DM resolves where a kind-allow exists and **no space row was pre-created** —
      this is `F51`'s regression test and the reason the wave exists.
- [ ] `CHANNEL_SECRET` round-trips encrypted and never appears in a read response.

## Done when

- [ ] Migration verified by hand, both directions.
- [ ] `grep -rn "gateway.connections" api/oss/src/core/channels api/oss/src/apis/fastapi/channels api/oss/src/dbs/postgres/channels`
      returns nothing.
- [ ] `F46` and `F51` closed with the verification recorded.

## Watch for

- **The nullable-column unique trap.** It is silent: the constraint still exists,
  still shows in `\d`, and stops preventing anything. Assert the duplicate is
  rejected rather than assuming.
- **`resolve`'s deleted branch.** Removing default-deny-on-missing-space is the one
  change that could open access if the grant evaluation is wrong. Land the grant
  tests before deleting the branch, not after.
