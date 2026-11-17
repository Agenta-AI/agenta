# Tasks

The session drive is stated by a boolean `has_session_drive` beside `drives` (design Decision 3). A drive entry is `{ "kind": "agent" | "project", "slug"?, "access"? }` (Decision 2).

Release 1 has four parts. The SDK and agent service part (section 2) fixes the shape first; the API (section 1) and the runner (section 3) build on the shape at the same time; the web (section 4) starts when task 2.1 fixes the field. Section 5 checks release 1. Section 6 is release 2 and ships in its own pull request, held until every agent service runs release 1.

## 0. Before the build

- [x] 0.1 Run the design review loop on the session drive shape and record the decision in `design.md` Decision 3.

## 1. API (release 1)

- [x] 1.1 Add a read-only form of the STS session policy in `api/oss/src/core/store/storage.py` (`_scope_policy` with a `read_only` flag: `GetObject`, `GetObjectAttributes`, the bucket metadata actions and the scoped `ListBucket`), and pass it through `sign_temp_credentials` and `MountsService.sign_mount_credentials`.
- [x] 1.2 Add `MountsService.fetch_project_mount(slug)`: reject reserved slugs, return an active row with no session and no agent, or none. It never creates.
- [x] 1.3 Add `POST /mounts/projects/sign?slug=&access=` (operation id `sign_project_mount_credentials`) in `api/oss/src/apis/fastapi/mounts/router.py`, registered before `/{mount_id}`, with `USE_MOUNTS`; 404 for a missing or archived drive. `POST /mounts/agents/sign` does not change (the agent drive is always read-write).
- [x] 1.4 Add an optional `slugs` filter to `MountQuery` and the DAO's `query_mounts`.
- [x] 1.5 Add the save check in the async body of `commit_workflow_revision` in `api/oss/src/core/workflows/service.py` (not in the pure `_build_revision_commit`): call the SDK's `validate_agent_drives` (code `invalid_drive_entry`), then check that each project slug has an active project mount, through a callable that wraps `MountsService.fetch_project_mount`, set by the composition root with `set_project_mount_lookup` (the mounts service already depends on the workflows service) (code `drive_not_found`). Both errors use the agent-facing envelope and map to HTTP 422 in the workflows router, as `InvalidAgentHarnessError` does.
- [x] 1.6 Add `["parameters", "agent", "drives"]` and `["parameters", "agent", "has_session_drive"]` to the refused paths of `AGENT_COMMIT_SCOPE` in `api/oss/src/core/workflows/change_set.py`.
- [x] 1.7 Fix the docstring of `sign_mount_credentials` that says the credentials expire in minutes.
- [x] 1.8 Unit tests: the read-only policy; the sign route (reserved slugs, other projects, missing and archived drives, no creation); the `slugs` filter; the save check (both codes, envelope, every entry rule); the refused commit paths.
- [ ] 1.9 Acceptance test in `api/oss/tests/pytest/acceptance/mounts/`: read-only credentials read and list, and fail to put and delete, on the test store. Record whether SeaweedFS honors the policy.
- [x] 1.10 Regenerate the Fern client from an EE spec.

## 2. SDK and agent service (release 1, first)

- [x] 2.1 In `sdks/python/agenta/sdk/agents/dtos.py`: the drive entry model `AgentDrive` (`kind`, `slug`, `access`; `access` only on project entries), `validate_agent_drives` (the one owner of the entry rules), `AgentTemplate.drives` and `AgentTemplate.has_session_drive`; parse them in `from_params`; read a configuration without them as `[{ "kind": "agent" }]` and `true`; refuse broken entries with `AgentTemplateShapeError`.
- [x] 2.2 Put `drives` (with `access` filled in) and `hasSessionDrive` on the `/run` payload; mirror them in `sdks/python/agenta/sdk/agents/utils/wire.py` and the golden fixtures; update `test_wire_contract.py`.
- [x] 2.3 Add both keys to `AgentTemplateSchema` and to `build_agent_v0_default` (so new agents state them) in `sdks/python/agenta/sdk/utils/types.py`, and to `_AGENT_TEMPLATE_KEYS` in `sdks/python/agenta/sdk/middlewares/running/vault.py`.
- [x] 2.4 In `sdks/python/agenta/sdk/agents/platform_instructions.py`: allow links to `drives/<slug>/`, and add the variant for an agent without an agent drive.
- [x] 2.5 Unit tests for parsing, the read-time default, every entry rule, the wire, the schema, the default template and the vault recognition.

## 3. Runner (release 1)

- [ ] 3.1 Add `drives` and `hasSessionDrive` (both optional; entry type `AgentDrive`) to `AgentRunRequest` in `services/runner/src/protocol.ts`; update `tests/unit/wire-contract.test.ts`.
- [ ] 3.2 New `engines/sandbox_agent/project-mount.ts`: `signProjectMountCredentials(slug, access)` against `/mounts/projects/sign` with the 10-second limit of the agent sign, `projectMountPath(cwd, slug)` = `<cwd>-project-<slug>`, `PROJECT_DRIVES_DIR_NAME = "drives"`, and the `drives/<slug>` link through `ensureDurableSymlink`.
- [ ] 3.3 In `environment-setup.ts`, resolve the drives of the run once, into one list that every later consumer reads (backend handoff, `harness-host.ts`, `turn-start-refresh.ts`, remount, expiry, teardown). Decide the drives from the request: the agent drive only when the list names it (always read-write), the session drive only when `hasSessionDrive` is not false, today's rule when the request has no `drives`. Send all signs at the same time.
- [ ] 3.4 In `mount.ts`, add a `readOnly` option to the shared geesefs argument builder that adds `-o ro`.
- [ ] 3.5 `local`: mount each listed drive in `mount-lifecycle.ts` in one `Promise.allSettled` group; link after the session drive is up; include all in the `ENOTCONN` remount and in teardown.
- [ ] 3.6 `daytona`: mount each listed drive in the group of `environment.ts` beside `daytonaCwdMount`.
- [ ] 3.7 `inprocess`: rename `inRunnerRunFacts().drives` to `roots`, add each signed drive as one `DriveRoot`, and make `harness-host.ts` read the resolved list instead of rebuilding `[session, agent]`; make `turn-start-refresh.ts` refresh every listed drive. Keep today's rule that every root must mount before a file command runs.
- [ ] 3.8 Empty list: no agent drive, no `agent-files` link, no `AGENTA_AGENT_MOUNT_DIR`, no `.tools` restore, and a prompt paragraph that says no agent or project drive is attached and how long the working folder lasts. `hasSessionDrive: false` on `inprocess`: refuse the run with the error code `session_drive_required`.
- [ ] 3.9 Add `drives` and `hasSessionDrive` to `configShape` in `session-identity.ts`, and each drive's expiry to `InstalledMountExpiries`.
- [ ] 3.10 Prompt guidance: one paragraph per project drive with its path, its access and the shared-write rules, and the "not available" sentence for a drive that could not be signed.
- [ ] 3.11 Log `mount degraded kind=project_mount slug=<slug>` (keep `kind=agent_mount`) and a `project_mounts` timing stage.
- [ ] 3.12 Unit tests for every task above, including a test that the run request parse keeps working with an unknown field; extend `tests/integration/inprocess/sandbox-drive.test.ts` to three roots.

## 4. Web (release 1, after 2.1)

- [ ] 4.1 Add `"project"` to `FileOrigin` in `web/packages/agenta-entities/src/drive/useSessionDrive.ts`, for paths under `drives/<slug>/`, resolved from the `drives` list of the session's agent configuration through `POST /mounts/query` with `slugs`.
- [ ] 4.2 Show the project drives in the session files pane and resolve chat links under `drives/<slug>/`.
- [ ] 4.3 Check that the playground editor keeps the new keys when it saves; if it drops unknown keys, teach it both keys.
- [ ] 4.4 Unit tests for the third origin; run `pnpm lint-fix` in `web`.

## 5. Release 1 checks (after sections 1 to 4)

- [ ] 5.1 On the local deployment, per backend (`local`, `inprocess`; `daytona` within the rules for cloud sandboxes): two agents read one drive; two agents share a read-write drive and see each other's files after the upload and a cache refresh.
- [ ] 5.2 Per backend: a write to a read drive fails with a read-only error, from a file tool and from a shell command, and the store holds no change.
- [ ] 5.3 Per backend: an existing agent saved before the release runs exactly as before; an agent with an empty list has no `agent-files/`; `has_session_drive: false` gives a throwaway folder.
- [ ] 5.4 Saving an agent that names a missing drive answers 422 `drive_not_found`; the agent's own commit tool cannot change `drives`.
- [ ] 5.5 Measure the cold start with zero, one and three project drives on each backend and record the numbers in this change.
- [ ] 5.6 Ship release 1 in this order: the API, then the runner, then the agent service. No configuration with the new keys is saved before the agent service runs release 1.

## 6. Release 2: backfill (own pull request, after every agent service runs release 1)

- [ ] 6.1 Add an alembic data migration in `api/oss/databases/postgres/migrations/core_oss/versions/` that adds `"has_session_drive": true` and `"drives": [{ "kind": "agent" }]` to `data.parameters.agent` of every agent revision that lacks them, reading `data` as `jsonb` and writing it back as `json`. It adds only missing keys, so a second run changes nothing. The downgrade does nothing.
- [ ] 6.2 Count the affected rows on the local deployment and time the migration.
- [ ] 6.3 Migration tests: only agent revisions change; revisions that state the keys are unchanged; a second run changes nothing; the migration gate passes.

## 7. Archive on a warm session (own pull request, stacked on the runner)

- [x] 7.1 In `session-coordinator.ts`, before a warm or approval reuse, sign every project drive that the environment holds credentials for again (`unsignableProjectDrives` in `project-mount.ts`, through the engine seam `signProjectDrive`); on the warm path at the same time as the turn-log read, on the approval path before it. A failed sign evicts with the mismatch and teardown reason `drive-revoked`, and the turn runs cold.
- [x] 7.2 `drive-revoked` deletes the sandbox on `local` and `daytona` (`teardownDisposition`) and the command sandbox on `inprocess` (`commandSandboxDisposition`).
- [x] 7.3 Unit tests: the warm and approval paths, the parallel sign, and the teardown disposition per backend.
- [x] 7.4 Live check on the local deployment (`local` provider): archive a shared drive between two turns of a warm session; the second turn cannot write it. `inprocess` could not be checked on the dev stack (its Daytona sandbox cannot reach the local file store without a public tunnel); unit tests cover its teardown.

