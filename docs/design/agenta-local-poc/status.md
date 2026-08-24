# Status

Last update: 2026-08-24

## Where things stand

- Product framing complete.
- Codebase research complete for the implementation plan.
- POC architecture proposed.
- Interface and SQLite contracts drafted.
- Local service package and DAO placement settled.
- File-by-file implementation plan drafted.
- Independent architecture and executability reviews passed after blocker fixes.
- Slice 1 packets S1.1 (project scaffold, mapping, composition) and S1.2 (SDK adapter,
  observer, smoke script, replay harness) implemented; unit + replay + live cold-turn +
  tool-denial tests green against a real runner and OpenAI key; redacted replay fixtures
  committed.
- Implementation of S1.3 (relocatable runner) has not started.

## Settled decisions

1. Build a new single-user local service instead of packaging the current platform API.
2. Reuse the Python agent SDK, shared runner wire contract, Node runner, and Pi harness.
3. Execute cold turns with SDK `session_id=None` (`sessionId: null` on the wire), so no
   platform session is owned or resumed in the first POC.
4. Force `runner.permissions.default=deny`; the POC is text-only because Pi built-ins
   otherwise reach the host filesystem.
5. Persist only agents, revisions, sessions, messages, and turns in SQLite.
6. Finish the POC with a localhost browser UI and managed runtime bundle.
7. Treat Electron as post-POC productization.
8. Keep the existing Agenta Cloud application unchanged during the POC.
9. Use an explicit cloud handoff rather than synchronization or embedded cloud login.
10. Target Linux for the first distributable artifact.
11. Put the standalone application under `services/local/`, with core interfaces under
    `src/agenta_local/core/` and concrete SQLite adapters under
    `src/agenta_local/dbs/sqlite/`.
12. Do not add `api/oss/src/dbs/sqlite/` for the POC; that location is reserved for a
    future SQLite implementation of the full platform contracts.
13. Give `services/local` its own `pyproject.toml` and lockfile instead of extending the
    broad API or services dependency environments.
14. Put the narrow renderer at `web/agenta-local`, alongside the existing `web/mobile`,
    `web/oss`, and `web/ee` applications.
15. Build the renderer as a static Next export served by FastAPI from the same origin.
16. Make a relocatable Linux directory archive the first required artifact; evaluate
    AppImage only after that artifact passes.

## Open decisions

1. Resolve and record exact Python and Node archive versions and hashes during the
   relocatable-runtime spike.
2. Confirm that cancelling the local streaming task reliably closes the runner connection
   and terminates the unowned run.

## Observed findings (Slice 1 live capture, 2026-08-24)

One cold Pi turn (openai/gpt-4o-mini) through `SDKAgentExecutor` against a
source-checkout runner, with outbound connections attributed via `strace -f`:

| Destination                | Owner                    | Assessment                                                                        |
| -------------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| api.openai.com             | pi                       | expected provider traffic                                                         |
| registry.npmjs.org         | `npm`, spawned by pi-acp | runtime download; must be eliminated or pinned for the relocatable/offline bundle |
| Cloudflare edge (104.26.x) | sandbox-agent daemon     | update/telemetry-style check; same requirement                                    |

Both non-provider destinations confirm the plan's "runtime downloads" risk. S1.3's
staging recipe must bake or neutralize them (pre-install whatever pi-acp fetches via npm,
pin or disable the daemon update check), then re-run this strace gate on a clean VM.

Also verified: wire request carries `sessionId: null`; Pi built-in tools are denied by
the effective policy (adversarial prompts could not read `/etc/passwd`, `/etc/hostname`,
or run shell commands); process teardown after SIGTERM left no owned children.

## Current blocker

None. Slice 1 packets S1.1/S1.2 are done and green. Next: S1.3 relocatable runner, whose
build recipe must address the two observed runtime-download sources above.

## Next actions

1. Implement S1.3: `packaging/runner/build_runner.py` + `verify_runner.py` (full frozen
   install, Pi patch, staged Node launch, npm/pi-acp and sandbox-agent update-check
   neutralization), then the clean-VM gate with a repeat of the strace network check.
2. Update this workspace with the relocation results before starting Slice 2 (SQLite).

## Deferred product work

- Unified local and cloud connection selector.
- Cloud authentication in the desktop application.
- Publish, pull, and synchronization flows.
- Registered local runners for cloud projects.
- Cross-platform installers and updates.
- Full local tools, mounts, approvals, and background execution.
