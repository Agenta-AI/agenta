# Runner review — executive summary

Date: 2026-07-05. Scope: `services/runner/` (the TypeScript agent runner) in the context of the
Python agent service and the SDK adapters that call it. Seven reviewers read the code in parallel:
three at high depth (architecture, the sandbox_agent engine, security), four at medium depth
(entrypoints and sessions, tracing, tests and QA, TypeScript idioms). The detailed findings for
each area live in `../findings/`. This summary ties them together.

## The one-paragraph verdict

The runner is in good shape for something that grew out of a POC. The core discipline is real:
fail-loud gates that refuse any capability the runner cannot honestly deliver, a golden-fixture
contract that pins the wire format across two languages, dependency-injection seams that let the
whole engine run under test with fakes, and a credential-clearing routine that keeps one tenant's
provider keys out of another's run. A Python developer wrote strict-mode TypeScript here and mostly
wrote it well. The gaps are not sloppiness. They are the parts a POC never has to face and a
production service does: what happens when a run hangs, when two runs share a process, when a
sandbox fails to unmount, when the harness is not Pi, and when the deployment is multi-tenant. Those
are the areas to close before launch.

## What the whole codebase got right (keep these)

Every reviewer, independently, flagged the same strengths. They are worth stating because the
roadmap builds on them rather than replacing them.

- **Fail-loud gates.** `run-plan.ts` refuses code tools, stdio MCP, tools on non-Pi remote
  sandboxes, and unenforceable policy before it creates any resource. This is the single best
  property of the runner. Every "silent drop" finding below is really a place where this discipline
  has a hole, not a place where the discipline is wrong.
- **The cross-language wire contract.** Shared golden fixtures asserted by both Python and
  TypeScript, plus a compile-time key guard that fails `tsc` on drift. It is close to the strongest
  guard you can build by hand.
- **Injection seams everywhere.** `createAgentServer(run)`, `runCli(raw, {run})`, and the
  `SandboxAgentDeps` bag let the tests drive real orchestration with fakes. The suite is green: 525
  unit tests, plus integration and acceptance layers, all wired into CI.
- **Credential clearing.** The managed-run daemon inherits zero provider keys and applies only the
  resolved secrets. Secrets are logged by name, never by value.
- **Layered leak backstops.** Per-run cleanup, a SIGTERM sweep, and Daytona self-reap each cover the
  next one's failure. The design anticipated leaks. The findings below are the cases the backstops
  miss.
- **Comments that carry the why.** Nearly every odd branch cites the incident or finding that
  created it. A new reader can reconstruct the reasoning. This is rare.

## The two blockers

Two findings gate the launch on their own.

1. **No run has a deadline.** `session.prompt()` has no timeout, the transport timeouts were
   disabled to support human-in-the-loop pauses, and a session-owned run never aborts when the
   client disconnects. A hung provider, a wedged adapter, or a stalled Daytona proxy means the run
   never finishes. The cleanup never runs. The daemon, the sandbox, the mount, and the HTTP socket
   all leak, and the watchdog keeps reporting the session as healthy while it is wedged. Under load,
   N hung runs leak N daemons on one Node process. (Engine review, F1.)

2. **No real agent run is pinned by a regression test.** The QA effort captured roughly 70 real
   `/run` pairs and wrote a skill to convert them into replay tests. None of that happened. The
   orchestration tests drive a hand-built fake harness that encodes the author's mental model of how
   Pi and Claude behave over ACP, never a real transcript. The append_system bug (F-001) was caught
   and re-verified by hand three times because no test pins it. (Tests review, finding 1.)

## The cross-cutting themes

Read across all seven reports, the individual findings cluster into a small number of root causes.
Fixing the root cause is cheaper than fixing each symptom.

### Theme 1: resource lifecycle is the weakest system

This is the largest risk and it shows up in four reports. The blocker above (no deadline) is the
core of it. Around it sit: no admission control, so a burst of runs forks unbounded daemons and FUSE
mounts on a process with no memory limit (architecture, A-6); the CLI transport has no signal
handling at all, so killing the subprocess leaks the Daytona sandbox it created (entrypoints, 1);
the server's own shutdown sweeps in-flight sandboxes without first refusing new connections, so a
run that races the SIGTERM still leaks (entrypoints, 2); and teardown deletes a workspace directory
through a FUSE mount that may still be live, which can erase the session's durable data (engine,
F4). These are one system, resource lifecycle, and it needs a deliberate pass before launch, not
four separate patches.

### Theme 2: process-global state breaks the moment two runs share a process

The runner is a long-lived server, but several pieces of state assume one run at a time. The request
handler writes `process.env.AGENTA_API_URL` from the first request's data, and that value then
routes every later session's authenticated calls for the life of the process (architecture A-2,
entrypoints 3, idioms 4). The OTLP exporter cache is keyed on a per-run ephemeral credential, so it
never hits and grows without bound (tracing 7, idioms 3). The trace export buffers are keyed only by
trace id, so two runs that share a traceparent corrupt each other's export (tracing 5). None of
these show up in tests, because the tests run one request at a time. All of them surface the first
busy day in production.

### Theme 3: the platform credential rides inside telemetry config

The most load-bearing secret in the system, the token the runner uses to heartbeat, persist, sign
mounts, and refresh itself, has no wire field. The runner digs it out of the OTLP exporter headers,
and it recovers the Agenta API base by slicing the OTLP endpoint string. Turning off tracing would
silently break sessions and mounts, features that have nothing to do with tracing (architecture,
A-1). The security review found the sharp edge of the same design: that token is the caller's
reusable user bearer, and it gets injected as an environment variable the harness process can read.
On Daytona it crosses into the sandbox, where a prompt-injected agent can read it and impersonate the
user (security, F2). One first-class `platform { endpoint, authorization }` wire block fixes the
design smell, and keeping that token out of the agent's environment fixes the leak.

### Theme 4: the local sandbox is not a tenant boundary

The security review is emphatic and correct: everything isolated by Daytona is solid, and every
sharp edge is the shared-host `local` topology. On `local`, every tenant's LLM-steered harness runs
as a child process on the same host under the same uid. A prompt-injected agent can read another
run's secrets through `/proc`, reach another run's unauthenticated tool server on loopback, and read
or forge another run's relay files (security, F1, F3, F6). The fix is policy before code: force
Daytona for tenant runs, document `local` as single-tenant and development-only, and turn on the
`/run` token that today defaults off (security, F1, F5, F8, F10).

### Theme 5: fail-loud has holes, and they all drop something a user needs

The gate discipline is the codebase's best property, which makes its holes worth naming. Production
compose never sets `PI_CODING_AGENT_DIR`, so a plain Pi run silently loses its extension, and with it
tracing, usage, and tool delivery (engine, F8). The swallowed-error scan reads the wrong directory
whenever skills are present, which is always for the agenta harness, so the "No response" bug is
re-opened for that whole harness (engine, F6). An unknown sandbox id falls back to running on the
host instead of refusing (engine, F5). Cache-token attribute keys do not match the ingest mapping, so
prompt-cache cost data vanishes with no error (tracing, 1). OTLP export failures are never logged, so
a trace can disappear with zero visibility (tracing, 6). Each of these is a one-place fix that
extends the gate discipline to a spot it missed.

### Theme 6: the variability axes are booleans, not seams

The runner has two real axes of variation: which harness (Pi, Claude, and the experimental agenta)
and where it runs (local, Daytona). Both are expressed as scattered booleans. `grep` finds 34 `isPi`
and 35 `isDaytona` branches across nine files. Adding codex or opencode touches at least ten places
across two languages with no checklist (architecture A-4). Adding a k8s or Firecracker backend means
editing every branch (architecture A-5). The fix is the provider pattern the team already knows: one
`HarnessProfile` table and one `SandboxBackend` port. This is the medium-term structural work that
turns "add a harness" from a week into a day. It is not a launch blocker, but every week it waits, a
few more branches accrete.

### Theme 7: two God files hold the next three bugs

`runSandboxAgent` is a single 650-line function with an 8-step cleanup and five ordering invariants
tracked only in comments. `tracing/otel.ts` is 1,315 lines and does four jobs, including owning the
run's event log, which means the engine cannot produce its result without instantiating the tracer.
Both files are where the correctness findings above actually live. Both have a clean extraction path
that the tests already imply. This is medium-term work, but the disposer-stack piece of the engine
cleanup is worth doing early, because it kills the "did the new resource get cleaned up?" class of
leak that Theme 1 keeps producing.

### Theme 8: the boundaries trust their input

The `/run` body, the single most important input, is parsed and cast, never validated (idioms 1).
Downstream code compensates with defensive checks scattered everywhere, which is the Python
"isinstance sprinkles" habit in TypeScript clothing. The SDK handle for the sandbox and session is
typed `any` in ten files, which is where roughly 50 of the 68 `any` sites come from and why the
tracer guesses at event shapes (idioms 2). One zod schema at the boundary and one `acp-types.ts`
file fix both, mechanically, and the schema doubles as contract documentation.

### Theme 9: the docs describe a system that was removed

The README lists an engine file that no longer exists, names a wire field that was never on the wire,
calls the active Claude tool channel "disabled," and ships a quickstart command that fails. The
design docs carry 44 stale paths and cite an environment variable with the wrong name and the wrong
default (architecture, A-19). This trains every new contributor, and every agent run against this
repo, on a false architecture. It is half a day to fix and it should be fixed before launch.

## Severity dashboard

| Area | Blocker | High | Medium | Low |
|---|---:|---:|---:|---:|
| Architecture and boundaries | 0 | 8 | 10 | 3 |
| sandbox_agent engine | 1 | 7 | 9 | 7 |
| Tools, permissions, security | 0 | 3 | 6 | 3 |
| Entrypoints and sessions | 0 | 4 | 6 | 6 |
| Tracing | 0 | 5 | 9 | 3 |
| Tests and QA | 1 | 4 | 6 | 3 |
| TypeScript idioms | 0 | 5 | 12 | 3 |
| **Total** | **2** | **36** | **58** | **28** |

The two blockers and a subset of the highs gate the launch. The rest is the medium and long-term
cleanup the review was commissioned to produce.

## The roadmap

The horizon labels come from the individual reports. I have triaged the "short" items into two
groups: those that must gate the launch because they lose data, burn credits, break tenant isolation,
or silently drop a core feature, and those worth doing in launch week but not worth blocking on.

### Must gate the launch

These prevent data loss, credential leaks, credit burn, or the silent loss of a shipped feature.

1. **Add a run deadline.** Overall and first-response, raced alongside the pause signal, so the
   existing cleanup reclaims everything. (Engine F1, the blocker.)
2. **Add admission control.** A max-inflight semaphore returning 503, a body-size cap, and memory
   limits in compose and Helm sized to the semaphore. (Architecture A-6.)
3. **Close the sandbox-leak paths.** Signal handling in the CLI, `server.close()` before the
   shutdown sweep, and never delete a workspace through a mount that may still be live. (Entrypoints
   1 and 2, engine F4.)
4. **Force Daytona for tenant runs and refuse the unsafe local combinations.** Reject `local` for
   multi-tenant, reject `default:"allow"` on local, require an explicit `credentialMode`, and turn on
   `AGENTA_RUNNER_TOKEN` by default in compose. (Security F1, F5, F8, F10.)
5. **Keep the caller bearer out of the agent-readable environment**, especially on Daytona, and
   authenticate the internal tool MCP channel. (Security F2, F3.)
6. **Fix the Daytona durable-session bugs.** Mount before materializing the workspace so instructions
   and permission files are not hidden, and clear or scope the relay directory per turn so stale
   requests are not re-executed. (Engine F2, F3.)
7. **Whitelist sandbox ids.** Refuse an unknown provider instead of silently running on the host.
   (Engine F5.)
8. **Restore the silently-dropped Pi features.** Set `PI_CODING_AGENT_DIR` in the gh compose and make
   missing extension delivery fail loud, and point the swallowed-error scan at the effective agent
   directory so the agenta harness regains its protection. (Engine F8, F6.)
9. **Fix the tracing silent drops.** Correct the cache-token attribute keys, log OTLP export
   failures, and wrap `finish()` so a tracing error cannot turn a clean failure into an unhandled
   rejection. (Tracing 1, 6, 8.)
10. **Delete the request-time `process.env` mutation.** Thread the API base explicitly. (Architecture
    A-2, entrypoints 3.)
11. **Add the replay regression test.** Convert the F-001 append_system cell, already captured and
    re-verified three times, into a TS-side replay through the real orchestration. Add direct tests
    for the four zero-coverage load-bearing functions: `resolveDaemonBinary`, `refreshCredential`,
    the interactions lifecycle, and `callAgentaTool`. (Tests 1, 4, 5, 6, 7, the second blocker.)
12. **Rewrite the README and sweep the stale docs.** (Architecture A-19.)
13. **Validate the `/run` body with zod** and fix the `sessionId` narrowing and the unbounded body
    read. (Idioms 1, 7, 8.)

### Launch week, not launch-blocking

Cheap wins that harden the service without gating the release: the first-class `platform` wire block
and its single accessor (A-1), scoping `/kill` to a session instead of the whole process (A-15,
entrypoints 6), the SDK probing `/health` for version skew (A-7), the exporter-cache eviction
(tracing 7), the helper de-duplication and the one logger module (idioms 6, 13), adopting eslint with
`no-floating-promises`, and deleting the committed npm lockfile.

### Medium term (one to two months)

The structural work that pays for itself on the next harness and the next backend: phase-structure
`runSandboxAgent` with a disposer stack (A-3), split the event log out of the tracer (A-11, tracing
15), introduce the `HarnessProfile` table and fold the name-keyed branches into it (A-4, A-8), define
the `SandboxBackend` port and type the sandbox handle (A-5), build the executor registry (A-17), make
the service use the SDK's orchestration seam instead of re-implementing it (A-14), and make the
extension's cross-process boundary visible in the tree (A-12).

### Long term (structural)

Move the hand-mirrored contract to a schema-first source so the Python side is generated, not
hand-kept (A-9). Give the runner a real build so production stops running TypeScript through `tsx`
with full dev dependencies (A-20). Revisit multi-replica routing when scale demands it (A-16).

## How to read the detail

Each area has its own report in `../findings/`, with file-and-line references, concrete failure
scenarios, and a per-area top-10:

- `arch-boundaries.md` — the system, the contract, extensibility, the target structure.
- `engine-sandbox-agent.md` — the run flow across every local-vs-Daytona and Pi-vs-Claude cell, and
  the lifecycle bugs.
- `tools-permissions-security.md` — the permission model, the local-vs-Daytona trust boundary, and
  secret hygiene.
- `entrypoints-sessions.md` — the server, the CLI, and session coordination.
- `tracing-otel.md` — the event-to-span state machine and its silent drops.
- `tests-qa.md` — the coverage map, the seam discipline, and the highest-value tests to add.
- `ts-idioms-quality.md` — the type-safety and organization sweep, with an eslint and knip config
  ready to adopt.
