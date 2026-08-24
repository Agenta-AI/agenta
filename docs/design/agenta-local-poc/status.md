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
- Slice 1 packet S1.3 (relocatable runner) implemented: `packaging/runner/build_runner.py`
  stages the runner tree with a pinned Node 24 runtime, and `verify_runner.py` proves
  relocation (path-with-spaces copy, explicit-env launch, health + authed readiness,
  live cold turn, optional strace classification). Build + gate + live turn all pass;
  strace on the staged runner shows only loopback, DNS, and api.openai.com.
- Slice 2 is complete (S2.1–S2.5): SQLite schema with crash-safe migration, layered
  agent/session DAOs and services with idempotency-first turn admission and concurrency
  tests, protected provider credential file store, ExecutionService orchestration
  (admit/stream split, session-keyed active registry, stop vs disconnect reasons,
  timeout budget), and the FastAPI HTTP surface with the browser boundary (process
  cookie, pinned Host/Origin, JSON mutations) plus SSE turn streaming and explicit
  stop. Full suite: 179 passed; replayed runner acceptance runs end to end over real
  HTTP against recorded fixtures.

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

1. RESOLVED for Node: pin v24.19.0 (URL
   https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz, sha256
   14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647, glibc >= 2.28),
   recorded in the generated manifest. Python runtime pin remains open (Slice 4).
2. Confirm that cancelling the local streaming task reliably closes the runner connection
   and terminates the unowned run.

## Runtime-download neutralizations (verified 2026-08-24)

The two non-provider destinations from the live capture are both neutralized in the
staged bundle:

| Source | Mechanism | Neutralization |
| --- | --- | --- |
| `npm view @earendil-works/pi-coding-agent version` spawned by pi-acp every session/new | update banner only; no env gate | runner child env gets `npm_config_offline=true`; cold cache fails fast and the notice silently nulls |
| sandbox-agent daemon boot telemetry to tc.rivet.dev | anonymous event, rate-limited daily; env vars ignored at daemon 0.4.2 | shipped `bin/sandbox-agent-wrapper` execs the real ELF with appended `--no-telemetry`, selected via `SANDBOX_AGENT_BIN`; state redirected via fresh `XDG_DATA_HOME` |

Remaining hardening follow-up: extend the pi-acp patch to stub `buildUpdateNotice`
(recorded as a known-open item in the manifest). Full clean-VM strace gate still to run
before Slice 4.

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

None. Slices 1 and 2 are complete. The clean-VM strace rerun is a Slice 4 gate.

## Next actions

1. Slice 3: static renderer at web/agenta-local consuming the local contract.
2. Slice 4: Linux bundle + launcher (Python runtime pin still open), then the clean-VM
   strace gate and AppImage evaluation.

## Deferred product work

- Unified local and cloud connection selector.
- Cloud authentication in the desktop application.
- Publish, pull, and synchronization flows.
- Registered local runners for cloud projects.
- Cross-platform installers and updates.
- Full local tools, mounts, approvals, and background execution.
