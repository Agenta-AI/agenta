# Tasks

The design replaces the two-kind model (`{ "kind": "agent" }`, `{ "kind": "project", ... }`) with one kind of drive: entries `{ "slug", "access" }`, a pointer `home_drive`, and the boolean `has_session_drive`. The four open pull requests are reworked in place:

- #8315: API, SDK and docs, plus the release 1 schema migration (new).
- #8316: runner.
- #8319: web.
- #8317: release 2 data migration.

"Parallel" marks a task that can run at the same time as the other parallel tasks of its section. Release 1 ships in this order: agent service, runner, API, web (design Decision 11). An older part may lose a drive but must never gain write access or cause a drive to be created against the configuration.

## 0. Before the build

- [ ] 0.1 Run the design review loop on this change (simplify and naming lenses), and record the result in `review-loop.md`.
- [x] 0.2 Run the security review on the visibility rule (design Decision 4). Round 1 findings are applied to this design.
- [ ] 0.3 Run the security review again on the code of sections 1 to 3.

## 1. API, schema and visibility rule (#8315, new work)

- [ ] 1.1 Release 1 schema migration in `core_oss`: create `mount_visibility` (primary key `(project_id, mount_id)`, `visibility`, nullable `owner_user_id`, cascade on the mount and the project, `ck_mount_visibility_value`, `ck_mount_visibility_private_owner`, `ix_mount_visibility_project_id_owner_user_id`); write a `project` row with no owner for every existing drive with no session and no agent; check that no two `mounts` rows share `(project_id, agent_id)` and stop with a clear message if any do; replace `ix_mounts_project_id_agent_id` with the unique partial index `uq_mounts_project_id_agent_id` `(project_id, agent_id) WHERE agent_id IS NOT NULL`.
- [ ] 1.2 Count rows that share an agent id on a copy of production data before release 1. (Parallel with 1.1.)
- [ ] 1.3 Add `ResourceKind.MOUNT`, `mount_resource(mount_id)` and `_evaluate_mount`, dispatched from `SharingService.evaluate` (no allow for an unknown kind on this path; no second public entry), with the drive policy read cached like `fetch_agent_policy_cached`, rules D1, D2 and the legacy branch (a row with `agent_id` and no `mount_visibility` row follows the agent).
- [ ] 1.2a Add the `run_agent_id` claim to the run credential in `_prepare_invoke` (`api/oss/src/core/workflows/service.py:3783`), from `resolved_revision.workflow_id`, never from caller meta or references, beside the `run_accounts` claim in `sign_secret_token` (`api/oss/src/middlewares/auth.py:1575`); add the one reader `run_agent_id_of_request`. Check that child runs, triggers and evaluations mint their credential through `_prepare_invoke`.
- [ ] 1.3a The channel exception in `_evaluate_mount`: only on the binding's own channel turn, for `USE_MOUNTS`, when the run's agent (from `run_agent_id_of_request`) is private and its owner is the binding's creator and the drive's owner; never for a child run, the save check, or a credential without the claim. Add a line to the channel binding docs: a private agent on a channel can read its listed drives for anyone in that channel.
- [ ] 1.4 Route `allow_mount` through `allow_resource` with `mount_resource` for every non-session row; keep the session rules.
- [ ] 1.4a Add `SharingService.check_home_drive(agent_policy, mount_policy)`, the one owner of the home rule; its four callers are the save check (3.2), the sign with `is_home=true` (2.2), the legacy route (2.3) and the change to `private` (3.4).
- [ ] 1.5 Unit tests for every case of the case table in design Decision 4, each condition of the channel exception, and the apps tools.

## 2. API, drives (#8315, rework)

- [ ] 2.1 Rename `fetch_project_mount` to `fetch_mount_by_slug`: an active row with that slug and no `session_id`; accept rows with `agent_id`, including reserved `__ag__agent__...` slugs of existing agent drives; keep the reserved-prefix refusal on creation only.
- [ ] 2.2 Move `POST /mounts/projects/sign` to `POST /mounts/sign?slug=&access=&is_home=` (operation id `sign_mount_credentials_by_slug`, registered before the `/{mount_id}` routes); call `evaluate` after the role check; a denied drive answers 404. With `is_home=true`, take the agent from `run_agent_id_of_request` and call `check_home_drive`; a refusal or a missing claim answers 403 `home_drive_not_allowed`.
- [ ] 2.3 `POST /mounts/agents/sign` (legacy): take the agent from `run_agent_id_of_request`, which must equal `artifact_id`; only for an agent with no stored revision that has a `drives` key (one indexed query), find the drive by `agent_id` (create with `create_agent_drive` when none exists), call `evaluate` and `check_home_drive`; otherwise answer 404 and create nothing. Open an issue to delete the route in the release after release 2. `POST /mounts/agents/query`: find by `agent_id`, then `evaluate`.
- [ ] 2.3a `POST /mounts/`: refuse a caller-supplied `agent_id`; write a `project` `mount_visibility` row with no owner for each new drive.
- [ ] 2.4 `POST /mounts/query` with `slugs`: filter by the drive rule.
- [ ] 2.5 Keep the read-only credentials, the read-only mount and their tests as built (both verified live on the earlier design).
- [ ] 2.6 Apps tools `list_starters` and `create_app`: read the home drive of the run's configuration; fall back to the legacy lookup by the agent id for a configuration without `drives`; call `evaluate` with the run's principal before any read or write; never create a drive.
- [ ] 2.7 Template loader: write template files only into a drive created in the same load; when the first revision names an existing home or `null`, write none and list the skipped files in the answer; strip a leading `agent-files/` from seed paths.

## 3. API, creation, save check and sharing (#8315, new work)

- [ ] 3.1 Add the pure slug rule `agent_drive_slug(agent_slug, taken_slugs)` and `MountsService.create_agent_drive`, the one owner of creating an agent's drive (slug from `agent_drive_slug`, name from the agent, `agent_id`, an explicit `mount_visibility` row with the agent's visibility, upsert on `uq_mounts_project_id_agent_id`). In `commit_workflow_revision`, before the first agent revision of an artifact is stored: when no drive has this `agent_id` and the revision has no `home_drive` key, call it with the visibility the agent will have (the existing `agent_access` row, or the row `_ensure_first_agent_access` will write), append the drive to `drives` and set `home_drive`.
- [ ] 3.2 Save check: rules through the SDK (`invalid_drive_entry`, `invalid_home_drive`, `invalid_session_drive`); each slug resolves to a drive the saver may use (`drive_not_found`); a shared agent lists no private drive (`drive_not_shared`); a private agent's home passes `check_home_drive` (`home_drive_not_allowed`). The check calls `evaluate` with the saver's principal and no channel exception. Rename `set_project_mount_lookup` to `set_mount_lookup` (stored as `_mount_lookup`), wrapping `fetch_mount_by_slug`.
- [ ] 3.2a Add the pure `fill_agent_drive_keys(agent_config, own_drive, agent_policy)`: only when `drives` is absent; `has_session_drive: true`; the own drive (found by `agent_id`) as only entry and home when `check_home_drive` allows it for the agent's current visibility, else `drives: []` and `home_drive: null`. Call it in the commit before the checks and in `_normalize_revision_for_read`; the visibility change and the change to `private` read revisions through it. Check that every agent run reads its revision through it.
- [ ] 3.3 Add `["parameters", "agent", "home_drive"]` to the refused paths of `AGENT_COMMIT_SCOPE`.
- [ ] 3.4 Visibility change to `project`: read the latest revision of every variant through the fill; refuse with 409 `drive_not_owned` naming the slug when one lists a private drive of another owner; otherwise make the acting owner's listed private drives shared in the same transaction under the agent's lock, return `drives_made_shared`, and list the drives and the other agents that use them in the disclosure. Visibility change to `private`: refuse with 409 `home_drive_not_allowed` while `check_home_drive` fails for a latest revision's home.
- [ ] 3.5 Unit tests: `check_home_drive` from its four callers, including a credential without `run_agent_id`; `run_agent_id` from the resolved workflow, not from meta or references; a child run's own agent; `fetch_mount_by_slug` with a reserved agent slug and with a session row; the commit and read fills, including `drives: []` when the rule does not allow the own drive; the legacy route for agents with and without a `drives` key; the transfer case (the new owner's runs do not get the old owner's private drives, and he cannot share them); creation on each path (create plus commit, simple create, application create, template load; fork creates none; `home_drive` null or a slug creates none; a retry creates one); every save code; the visibility change.
- [ ] 3.6 Regenerate the Fern client from an EE spec.

## 4. SDK and agent service (#8315, rework; ships first)

- [ ] 4.1 `AgentDrive` becomes `{ slug, access }`; `validate_agent_drives` owns the entry rules; add `validate_home_drive`; an absent `drives` key reads as legacy, not as a list.
- [ ] 4.2 Wire: `drives` (access filled in), `homeDrive`, `hasSessionDrive`; no `drives` on the wire for a legacy configuration; golden fixtures and `test_wire_contract.py`.
- [ ] 4.3 Editor schema accepts `home_drive`; the default template keeps `has_session_drive: true` and drops `drives`; the vault keys include `home_drive`.
- [ ] 4.4 Platform text: keep the `agent-files/` passages for an agent with a home drive; the variant without for none; replace the project drives paragraph with the drives paragraph of design Decision 10.
- [ ] 4.5 Unit tests for parsing, the legacy read, every rule, the wire, the schema, the default template and the vault.

## 5. Runner (#8316, rework; parallel with sections 1 to 3 once 4.2 fixes the wire)

- [ ] 5.1 `protocol.ts`: `drives?: { slug, access }[]`, `homeDrive?: string | null`, `hasSessionDrive?`; update `tests/unit/wire-contract.test.ts`.
- [ ] 5.2 One module for all drives: `signMountCredentialsBySlug(slug, access, isHome)`, which sends `is_home=true` for the home drive (a 403 `home_drive_not_allowed` means no home); a refused home sign means no home for this run (no `.tools` restore, no `agent-files` link, the agent is told) against `/mounts/sign`, `driveMountPath(cwd, slug)` = `<cwd>-drive-<slug>`, `DRIVES_DIR_NAME`, `HOME_DRIVE_LINK_NAME`. Keep `signAgentMountCredentials` only for a request without `drives`.
- [ ] 5.3 Resolve the run's drives once into `RunDrive` items with an `isHome` flag; every consumer reads that list (setup, links, turn-start refresh, remount, lease, teardown).
- [ ] 5.4 Links: one function for `drives/<slug>` and `agent-files` with the rules of design Decision 3; prune leftover links and a leftover `agent-files` link; remove the agent drive recovery that moves files.
- [ ] 5.5 `local`, `daytona`, `inprocess`: mount every drive in the existing parallel group; read drives with `-o ro`; repair every link every turn on all three kinds (`daytona` and `inprocess` gain the `agent-files` repair). (Parallel per sandbox kind.)
- [ ] 5.6 Home drive: README seed on all three kinds, `.tools` restore from the home drive, cache keyed by mount id; drop `AGENTA_AGENT_MOUNT_DIR`.
- [ ] 5.7 Write `drives/README.md` at every start, listing only the drives mounted in this run, with the text of design Decision 9.
- [x] 5.7a Record in the follow-up pull request that signs again on each warm turn: a drive whose new sign fails is unmounted, its link removed, and the agent told in the same turn. Done in #8324: the warm turn signs every mounted drive again, the home drive included; a failed sign deletes the sandbox (on `inprocess`, the command sandbox) and the turn starts a fresh environment without the drive. Checked live on `local` only; `inprocess` and `daytona` are covered by unit tests.
- [ ] 5.8 Environment notes per drive (path, access, shared-write rule, not available); log `kind=drive_mount slug=` and the stage `drive_mounts` for every drive (`kind=agent_mount` only on the legacy path); write texts that never call a drive shared because it is writable; `drives` and `homeDrive` in the fingerprint.
- [ ] 5.9 Unit tests for every task above, and `tests/integration/inprocess/sandbox-drive.test.ts` with three roots (one home, one failing).

## 6. Web (#8319, rework; parallel with section 5 once 4.2 fixes the shape)

- [ ] 6.1 Rename `projectDrives.ts` to `drives.ts`. Read `drives` and `home_drive` from the revision; resolve slugs with `POST /mounts/query`; keep the agent-id lookup for a configuration without `drives`.
- [ ] 6.2 Fold each drive under `drives/<slug>/`, the home drive once under `agent-files/`; `FileOrigin` `"session" | "home" | "drive"`.
- [ ] 6.3 Tool paths: match `<session>-drive-<slug>` first, then the old `-agent` suffix for recorded sessions, so `<session>-drive-support-agent` maps to the drive `support-agent`; add a test for it. Chat links under `drives/<slug>/` and `agent-files/`.
- [ ] 6.4 Agent page card: list the drives of the configuration, home first; works before the first conversation.
- [ ] 6.5 Check that the playground editor keeps `home_drive` on save.
- [ ] 6.6 Unit tests; `pnpm lint-fix` in `web`.

## 7. Docs and release 1 checks (#8315 docs; checks after sections 1 to 6)

- [ ] 7.1 Rewrite the docs pages on agent drives, project drives and read access for one kind of drive, the home drive and the visibility rule.
- [ ] 7.2 Live, per sandbox kind: an existing agent finds its files at `agent-files/`; a new agent has its drive before the first conversation; a crew shares a drive; a read drive refuses writes; a support agent with `home_drive: null` has no `agent-files/`.
- [ ] 7.3 Live: a teammate's run of an agent that lists a private drive gets no such drive; an API key run gets shared drives only.
- [ ] 7.4 Live: an older runner against the new API finds the agent's drive by its id.
- [ ] 7.5 Live: a channel turn of a personal agent gets its home drive; a binding of the same owner on a shared agent does not get the owner's private drives.
- [ ] 7.5a Live: an older runner gets 404 from the legacy route for an agent with an explicit configuration, and creates no drive.
- [ ] 7.5b Live: two personal agents of one owner share a private home; sharing one makes the other run without a home, and the sharing answer lists it.
- [ ] 7.6 Ship release 1 in the order agent service, runner, API, web.

## 8. Release 2 migration (#8317, rework; after every API pod and agent service runs release 1)

- [ ] 8.1 Replace the backfill with one data migration that calls no app service and carries frozen copies of the slug rule and the fill: readable slugs for rows with a reserved agent slug (keep `agent_id` and the storage prefix; skip static catalog ids); explicit `mount_visibility` rows copied from `agent_access` (ownerless shared agents give `project` with no owner); `project` rows for drives that older API pods created during the release 1 rollout; drive rows inserted for agents without one; `has_session_drive`, `drives` and `home_drive` added to agent revisions that lack them; every revision reference (`drives`, `home_drive`) to a renamed slug rewritten, including references saved during release 1; merged as text in Python; batches; idempotent; no-op downgrade.
- [ ] 8.2 Migration tests: references to reserved slugs saved during release 1, legacy rows, never-run agents, private agents, static catalog ids, revisions with and without keys, stored JSON that the `jsonb` cast refuses, a second run.
- [ ] 8.3 Count the affected rows and time the migration on a copy of production data.
- [ ] 8.4 Live: an existing agent before and after the migration, with an older runner and with the new runner.

## 9. After release 2 (once no older runner or agent service remains)

- [ ] 9.1 Delete the legacy route `POST /mounts/agents/sign`.
- [ ] 9.2 Delete the read-time fill of agent revisions without `drives`. Before the deletion, confirm with a query that no stored agent revision lacks the keys `drives`, `home_drive` and `has_session_drive`, because the release 2 migration leaves a revision unchanged when it cannot write its JSON back with the same values (for example a stored number such as `1e400`).
- [ ] 9.3 Delete the reserved slug lookup by agent id in `fetch_mount_by_slug`.
- [ ] 9.4 Delete the runner's path for a run request without `drives`.
- [ ] 9.5 Make `list_starters` read the revision the run uses, not the variant's latest revision (needs a tool context binding for the run's revision).
