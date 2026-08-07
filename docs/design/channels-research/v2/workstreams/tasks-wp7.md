# WP7 tasks — Identity links

Depends on nothing structural, but needs WP2's capability declaration shape
(the `identity` block) to key correctly — code against WP2's seed-commit stub
first, do not wait for WP2's implementation. **Writes no migration file** —
WP7's tables are content inside WP1's `oss000000021`; coordinate the table
definitions with WP1's worktree instead of running `alembic revision`.

## Table definitions (handed to WP1, not owned as a migration)

- [ ] Draft the identity link table's dbas (`dbs/postgres/channels/identity_dbas.py`): `project_id`, `connection_id`, `user_id`, `external_user_key` (the derived, scope-aware key), lifecycle columns, following the same `ProjectScopeDBA`/`LifecycleDBA`/`IdentifierDBA` composition every other channels table uses (`entities.md` §2).
- [ ] Add a unique constraint on `(project_id, connection_id, external_user_key)` so one platform identity maps to at most one link per connection.
- [ ] Hand the table definition to WP1's worktree for inclusion in `oss000000021` — confirm in review that no separate revision file appears in this package's diff.

## Key composition

- [ ] Write the single key-composition function in `core/channels/identity.py` that reads the adapter's `identity` capability block (`scope`, `stable`) and returns one canonical `external_user_key` string — no second call site permitted to build this key by hand (mirrors the `external_key` discipline in `entities.md` §2.2).
- [ ] Branch only on `scope`: embed the scope id (e.g. workspace/team id) in the key when `scope` names a non-global boundary; omit it when the platform's user id is already globally unique.
- [ ] Unit test: two connections with the same raw platform user id under `scope: "workspace"` produce two distinct keys.
- [ ] Unit test: a capability block with no scope (or a global-uniqueness value) produces a key from the raw platform user id alone.

## Service: lookup, create, rebind

- [ ] Implement `ChannelIdentityService.resolve_link(project_id, connection_id, external_user_key) -> Optional[ChannelIdentityLink]` as a DAO passthrough; `None` means unlinked.
- [ ] Implement `ChannelIdentityService.create_link(project_id, user_id, connection_id, external_user_key) -> ChannelIdentityLink`.
- [ ] Implement `ChannelIdentityService.rebind_link(project_id, connection_id, old_external_user_key, new_external_user_key) -> Optional[ChannelIdentityLink]`, reachable only when the adapter declares `identity.stable == false`; re-keys the existing row rather than inserting a new one, so attribution history does not fork.
- [ ] Guard `rebind_link` (or its caller) so it is a no-op / rejected path when the adapter declares `identity.stable == true` — there is nothing to rebind on a stable identity.

## Refusal (D17)

- [ ] Write one shared formatting function that renders `"No agent named \`{slug}\` is available in this space"` and route every D17-relevant failure through it: slug not found in the roster at all, slug found but zero grants anywhere, slug found with grants but none covering this space.
- [ ] Confirm the three underlying causes keep distinct internal exception types (`ChannelAgentNotFound`, `ChannelAgentNotGranted`, etc. — WP1's `types.py`) for logging/diagnosis, while the rendered text produced for the user is byte-identical across all three.
- [ ] Test: byte-for-byte identical refusal text across the three causes, using the same requested slug in each case.
- [ ] Test: refusal text echoes back a typo'd slug that matches no real agent, unchanged from the "exists but not granted" case's wording.
- [ ] Test: the unlinked-user case (not one of D17's three causes) does not produce D17's sentence — it must be visibly a different situation internally, so WP4 can prompt to link rather than imply no agent exists.

## Tests (link resolution and attribution)

- [ ] Test: a linked user's `resolve_link` returns a link whose `user_id` matches the Agenta account created for it.
- [ ] Test: a turn invoked using a resolved link's `user_id` is attributed to that account (assert on whatever attribution field the invoke path reads — the linked user, not a service identity).
- [ ] Test: `rebind_link` under `identity.stable == false` preserves the link's row identity and `user_id` while changing `external_user_key`.

## Definition of done

Feeds **C2**. Exit condition, verbatim from `plan.md`:

> end to end with a fake adapter — mention in, answer out, in the right
> thread, attributed to the linked user. An unaddressed message writes its
> log row and nothing else. Two agents in one thread run independently. A
> mention during a running turn is retried until accepted, never dropped,
> never duplicated.

WP7's own done condition, verbatim from `plan.md`:

> an unlinked user can link, a linked user's turn is attributed to them, and
> refusals are indistinguishable across the three causes.
