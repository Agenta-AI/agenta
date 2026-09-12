# WP7 tasks — Identity links

Depends on nothing structural, but needs WP2's capability declaration shape
(the `identity` block) to key correctly — code against WP2's seed-commit stub
first, do not wait for WP2's implementation. **Writes no migration file** —
WP7's tables are content inside WP1's `oss000000021`; coordinate the table
definitions with WP1's worktree instead of running `alembic revision`.

## Table definitions (handed to WP1, not owned as a migration)

- [x] Draft the identity link table's dbas (`dbs/postgres/channels/identity_dbas.py`): `project_id`, `connection_id`, `user_id`, `external_user_key` (the derived, scope-aware key), lifecycle columns, following the same `ProjectScopeDBA`/`LifecycleDBA`/`IdentifierDBA` composition every other channels table uses (`entities.md` §2).
      `ChannelIdentityLinkDBA` composes `ProjectScopeDBA, LifecycleDBA,
      IdentifierDBA` plus `connection_id`/`user_id` (`UUID`, `nullable=False`)
      and `external_user_key` (`String`, `nullable=False`) — no `HeaderDBA`,
      `SlugDBA`, `DataDBA`, `FlagsDBA`, `TagsDBA`, or `MetaDBA`: a link is a
      bare mapping, not a configurable entity with a name/description/policy.
- [x] Add a unique constraint on `(project_id, connection_id, external_user_key)` so one platform identity maps to at most one link per connection.
      `uq_channel_identity_links_connection_external_user_key` on
      `ChannelIdentityLinkDBE.__table_args__`, mirrored in the migration DDL.
- [x] Hand the table definition to WP1's worktree for inclusion in `oss000000021` — confirm in review that no separate revision file appears in this package's diff.
      Added directly to `oss000000021_add_channels.py`'s `upgrade()`/
      `downgrade()` (WP1's file, one revision, no new file); the one open
      line on `tasks-wp1.md` is closed by this. Confirmed: `find
      api/oss/databases/postgres/migrations -newer <C1 checkpoint>` and a
      diff review show no second revision file anywhere in this package's
      change set.

## Key composition

- [x] Write the single key-composition function in `core/channels/identity.py` that reads the adapter's `identity` capability block (`scope`, `stable`) and returns one canonical `external_user_key` string — no second call site permitted to build this key by hand (mirrors the `external_key` discipline in `entities.md` §2.2).
      `compose_external_user_key(capabilities, platform_user_id, *,
      scope_id=None)` in `core/channels/identity.py`. Grepping the diff for
      manual `external_user_key=` construction outside this function and the
      DTOs/mappings that carry the already-composed value finds none.
- [x] Branch only on `scope`: embed the scope id (e.g. workspace/team id) in the key when `scope` names a non-global boundary; omit it when the platform's user id is already globally unique.
      Branches on `capabilities.identity.scope`: any truthy value other than
      `"global"` embeds `scope_id`; absent or `"global"` uses the raw
      platform id alone (`capabilities.md` §3's `global | workspace |
      tenant` vocabulary — only `global` is the omit case, `workspace` and
      `tenant` both embed).
- [x] Unit test: two connections with the same raw platform user id under `scope: "workspace"` produce two distinct keys.
      `test_channels_identity_key.py::test_workspace_scope_distinguishes_two_connections_with_the_same_raw_id`.
- [x] Unit test: a capability block with no scope (or a global-uniqueness value) produces a key from the raw platform user id alone.
      `test_channels_identity_key.py::test_no_scope_uses_the_raw_platform_id_alone`
      and `test_global_scope_uses_the_raw_platform_id_alone`.

## Service: lookup, create, rebind

- [x] Implement `ChannelIdentityService.resolve_link(project_id, connection_id, external_user_key) -> Optional[ChannelIdentityLink]` as a DAO passthrough; `None` means unlinked.
- [x] Implement `ChannelIdentityService.create_link(project_id, user_id, connection_id, external_user_key) -> ChannelIdentityLink`.
- [x] Implement `ChannelIdentityService.rebind_link(project_id, connection_id, old_external_user_key, new_external_user_key) -> Optional[ChannelIdentityLink]`, reachable only when the adapter declares `identity.stable == false`; re-keys the existing row rather than inserting a new one, so attribution history does not fork.
      The DAO's `rebind_link` does an in-place `UPDATE ... RETURNING` keyed on
      the old `external_user_key`, never a delete+insert — `id` and `user_id`
      are untouched, verified in
      `test_channels_dao_identity.py::test_rebind_link_preserves_row_and_user_id`
      (written, not run — needs Postgres) and the unit-level fake-DAO
      equivalent `test_channels_identity_service.py::test_rebind_preserves_row_identity_and_user_id_when_unstable`.
- [x] Guard `rebind_link` (or its caller) so it is a no-op / rejected path when the adapter declares `identity.stable == true` — there is nothing to rebind on a stable identity.
      `ChannelIdentityService.rebind_link` takes `capabilities` and returns
      `None` without calling the DAO at all when `capabilities.identity.stable`
      is true — the guard lives in the service, one level above persistence,
      so a stable identity's row is never even queried for rebinding.

## Refusal (D17)

- [x] Write one shared formatting function that renders `"No agent named \`{slug}\` is available in this space"` and route every D17-relevant failure through it: slug not found in the roster at all, slug found but zero grants anywhere, slug found with grants but none covering this space.
      `render_agent_refusal(*, slug)` plus the routing helper `refuse_agent(cause,
      *, slug)` and the `ChannelAgentRefused` exception, all in
      `core/channels/identity.py` (WP7's own module — `types.py` is WP1's
      frozen file per the spec's own note; WP7 composes the same way rather
      than editing it).
- [x] Confirm the three underlying causes keep distinct internal exception types (`ChannelAgentNotFound`, `ChannelAgentNotGranted`, etc. — WP1's `types.py`) for logging/diagnosis, while the rendered text produced for the user is byte-identical across all three.
      `refuse_agent` accepts the internal cause (`ChannelAgentNotFound`,
      `ChannelAgentNotGranted`, or `None` for the "found, zero grants
      anywhere" case) purely to assert it is one of the expected D17 shapes;
      it is never read into the rendered text, which comes from `slug` alone.
- [x] Test: byte-for-byte identical refusal text across the three causes, using the same requested slug in each case.
      `test_channels_identity_refusal.py::test_refusal_text_is_byte_identical_across_the_three_causes`.
- [x] Test: refusal text echoes back a typo'd slug that matches no real agent, unchanged from the "exists but not granted" case's wording.
      `test_channels_identity_refusal.py::test_refusal_wording_matches_the_not_granted_case_verbatim_for_a_typo`.
- [x] Test: the unlinked-user case (not one of D17's three causes) does not produce D17's sentence — it must be visibly a different situation internally, so WP4 can prompt to link rather than imply no agent exists.
      `test_channels_identity_refusal.py::test_unlinked_state_is_not_worded_as_a_d17_refusal` —
      asserts the D17 sentence and a representative unlinked-prompt sentence
      never collide; `resolve_link` returning `None` (unlinked) is a
      different return value entirely from `ChannelAgentRefused` being
      raised, so the two cannot be confused by construction, not just by
      wording. The actual "please link" prompt text belongs to WP4.

## Tests (link resolution and attribution)

- [x] Test: a linked user's `resolve_link` returns a link whose `user_id` matches the Agenta account created for it.
      `test_channels_identity_service.py::test_linked_user_resolves_to_the_created_account`.
- [x] Test: a turn invoked using a resolved link's `user_id` is attributed to that account (assert on whatever attribution field the invoke path reads — the linked user, not a service identity).
      `test_channels_identity_service.py::test_resolved_link_attributes_to_the_linked_user_not_a_service_identity` —
      asserts `resolve_link().user_id` is the linked account and never a
      sentinel service identity. This is as far as WP7 can assert alone:
      `open_turn`'s actual attribution write is WP4's (`architecture.md` §5
      Step 6, "the credential is the invoking user's"); WP7 does not call
      invoke and stubs no invoke collaborator here — see the report's
      "faked collaborators" section for what WP7 assumes WP4 does with this
      `user_id`.
- [x] Test: `rebind_link` under `identity.stable == false` preserves the link's row identity and `user_id` while changing `external_user_key`.
      `test_channels_identity_service.py::test_rebind_preserves_row_identity_and_user_id_when_unstable`
      (fake DAO, unit) and
      `test_channels_dao_identity.py::test_rebind_link_preserves_row_and_user_id`
      (real Postgres, integration — written, not run).

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

## Closed in this package's worktree

Every checklist line above is `- [x]`. What is proven without a deployed
stack is proven now (24 unit tests, all green, 0 environment). What needs
Postgres (`identity_dao.py`'s round-trip, the unique-constraint rejection,
the two-connections-no-collision case) is written in
`api/oss/tests/pytest/integration/channels/test_channels_dao_identity.py`
and is unexecuted in this worktree — same status as WP1's own DAO
integration tests at C1, for the same reason (no environment here).

**Nothing left open.** WP7's own done condition ("an unlinked user can link, a
linked user's turn is attributed to them, and refusals are indistinguishable
across the three causes") is met at the unit level; the end-to-end C2 exit
condition needs WP4 and WP5 wired in, which is C2's merge, not this
package's.
