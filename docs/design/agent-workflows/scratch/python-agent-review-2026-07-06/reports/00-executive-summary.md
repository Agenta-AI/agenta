# Python agent review — executive summary

Date: 2026-07-07. Scope: the Python "decide what to run" side of the agents feature: the agent
service (`services/oss/src/agent/`, 611 lines) and the agent SDK
(`sdks/python/agenta/sdk/agents/`, 10,897 lines). Eight reviewers read the code in parallel:
five at high depth (architecture, the wire contract, tools and secrets, the Vercel stream
adapter, Python idioms), three at medium depth (service config and tracing, harness adapters,
tests and QA). Each area's detailed findings live in `../findings/`. This summary ties them
together and reconciles them with the runner review at
`../../runner-review-2026-07-05/reports/00-executive-summary.md`.

## The one-paragraph verdict

The Python side is the healthier half of the system. The same developer who wrote the runner
wrote this code in their native language, and it shows: exemplary Pydantic v2 modeling, one
`type: ignore` in eleven and a half thousand lines, harness knowledge in tables instead of the
runner's 34 scattered branches, least-privilege secret resolution, and a green suite of 544
tests. Several of the runner review's worst patterns simply do not exist here. What does exist
is the POC residue this review was commissioned to find: the service re-implements the SDK's own
orchestration seam and the two copies have drifted in five behaviors; a shipped feature is
silently dead because a code default still points at a directory that was renamed away; policy
parsing fails toward permissiveness in three independent places; and the playground-facing frame
stream is a fourth hand-kept contract mirror whose consumer kills the whole turn on one
malformed frame. Nothing here loses data on its own, so no finding earned the blocker label. But
a handful of highs gate a multi-tenant launch, and they cluster where the runner review said
they would: policy, credentials, and the seams between the mirrors.

## What the codebase got right (keep these)

Every lane, independently, named strengths worth protecting through the cleanup.

- **`batch = fold(stream)` by construction.** One event pipeline; the batch path drains and
  folds the same stream (`handler.py`, `fold.py`). The "batch and stream disagree" bug class
  cannot exist. The single best structural decision on this side.
- **The golden guard network.** Shared fixtures asserted byte-for-byte by both languages, a
  closed key set in both test suites, a schema-equality check, and cross-language permission
  parity against one fixture. All 48 contract tests pass. The runner review called this the
  strongest hand-built guard in the repo; the Python half holds up.
- **Least-privilege secret resolution.** The whole-vault dump is off the live path. One model
  resolves to one connection with one provider's env vars, ambiguity raises specific errors, and
  an allowlist stops a vault record from injecting arbitrary env vars into the harness. Logs
  carry names and counts, never values.
- **The op catalog's self-targeting design.** Server-bound fields are stripped from the
  model-visible schema, mutating schemas are closed, and bindings are applied last, so the model
  cannot retarget another variant or trace (`platform/op_catalog.py`).
- **Tables, not booleans.** Harness identity lives in explicit registries and per-harness config
  classes. The runner review's Theme 6 (34 `isPi` branches) is largely refuted here; the Python
  side already resembles the `HarnessProfile` target the runner is being pushed toward.
- **Fakes that fail loud.** The test fakes subclass the real ports, so a port change breaks
  collection instead of silently passing. The stream adapter carries roughly 1,600 lines of
  behavior tests that encode the regression history.
- **Native-quality Python.** Discriminated unions, frozen import-validated models, annotated
  broad excepts, zero `cast`, zero bare `except`, and mypy in default mode reports only 12
  errors across 60 never-type-checked files. Adopting a checker is cheap because the habits are
  already there.

## Blockers

No lane found a Python-side blocker: nothing here, on its own, loses data, leaks a credential in
the deployed topology, or silently drops a shipped feature for all users. The two blockers that
gate the launch remain the runner review's (no run deadline; no real-run regression test), and
the second one is confirmed from this side as one shared gap, not two: the captured `/run` pairs
sit unused, the replay-test skill targets this exact SDK, and no replay test exists in either
language. Several Python highs join the launch gate below because they are the producer half of
the runner's gating items.

## The cross-cutting themes

Across the eight reports, the findings cluster into root causes. Convergence was deliberate
signal: every theme below surfaced independently in at least two lanes.

### Theme 1: the service re-implements the SDK's own seam, and the copies have drifted

Three lanes hit this from different angles (architecture A-1, idioms 1, tests 2). `app.py`
duplicates `make_agent_handler` almost line by line: 33 of 55 non-comment lines are
byte-identical, and `_agent_model_ref` is copied verbatim. The `AgentComposition` seam was built
for exactly this use and has an injection field for every service behavior, yet its only
consumers are two unit tests. Worse, the SDK copy is not dead code: it is the seeded default
handler for the same URI, and it already disagrees with the service in five enumerated behaviors
(capability gating, degradation policy, MCP gating, `run_kind`, backend and template defaults).
No test would catch further drift because nothing tests the seam at all. This confirms and
upgrades runner A-14. The fix is a one-file refactor: the service constructs the composition,
the seam gains a request-aware `run_context`, and the duplicated body is deleted.

### Theme 2: a renamed directory left a shipped feature silently dead

The runner moved from `services/agent` to `services/runner`, and the Python side never followed
(architecture A-2, idioms 2, tests 1). The service's code default still points at the old path,
so the editable-template feature falls back to hello-world constants in every deployment with no
log line, and the documented local CLI fallback cannot work without an env override. An orphaned
test directory sits outside the pytest roots, never runs in CI, and contains a test that crashes
on the same stale path. Nine SDK docstrings send readers to the phantom directory. This is the
runner review's Theme 9, except here the stale path reached executable defaults, not just prose.
The whole fix is about an hour.

### Theme 3: the platform credential design is confirmed at its producer, with one refinement

Four lanes traced runner A-1/F2 to its origin (wire B-1, security C2, tracing E-1, idioms).
`trace_context()` captures the caller's live Authorization header and the wire nests it under
the OTLP exporter's headers; the runner digs it out as its platform credential and injects it
into the agent-readable environment. The refinement: the wire shape was already fixed since the
runner review (the credential now sits under the exporter it authenticates, with honest
docstrings), but the value is still wrong. It is the caller's reusable platform bearer doing
triple duty as exporter credential, session and mount credential, and (via a second copy on
`toolCallback`) the tool-dispatch credential. Turning off tracing would still break sessions.
The fix has two halves that both belong here: a first-class `platform {endpoint, authorization}`
wire block, and a short-lived trace-ingest token minted by the service so the reusable bearer
stops traveling. The capture function itself has no test (tests 3), and the goldens deliberately
pin the current design, so the fix must regenerate them on purpose (tests 6).

### Theme 4: policy fails toward permissiveness

The runner's best property is failing loud on anything it cannot honestly serve. The Python side
inverts that in three independent places, and separate lanes found each one twice.

- An unrecognized `permissions.default` silently coerces to `allow_reads`, which is more
  permissive than three of the four valid values. A misspelled `deny` grants read execution with
  no error (wire B-4, security C8).
- The harness capability table returns permissive for a harness with no entry, so a partially
  wired new harness reaches every provider, mode, and deployment silently (harness F-3,
  architecture A-6, wire B-13).
- Nothing validates the sandbox axis at all. Any tenant can author `sandbox:"local"` plus
  `default:"allow"`; the string is not checked against a known set, and the published `/inspect`
  default seeds every new agent onto `local` (security C1, tracing E-3). This is the Python home
  of the runner review's Theme 4 launch gate, and it is unimplemented.

The pattern fix is one doctrine: policy parsing never widens silently. Fail loud on unknown
values, fail closed on missing table entries, and gate the sandbox and permission axes with a
deployment policy in the service.

### Theme 5: the playground contract is a fourth mirror, and its consumer hard-fails

The stream adapter lane corrected the review brief: the ai-sdk v6 client does not silently
reject a malformed frame, it throws and kills the entire turn, including text already rendered
(vercel D-1). That raises the stakes on three gaps. Optional runner fields pass straight into
required string slots, so one absent tool-call id strands the whole turn. A run that ends
`ok:true` with zero content renders as a silent blank bubble with a clean finish, and the
runner-side scan that should catch it is dead for the agenta harness, so both defense layers are
open at launch (D-2, confirming runner F6). And nothing pins the emitted frames against the
exact beta the frontend ships, so an FE `ai` bump can break every streamed turn with zero
Python-side signal (D-3). The adapter is otherwise the best-tested module in the tree; the gap
is schema conformance, not coverage. Three short fixes close it: a normalization gate at the
yield boundary, a ten-line zero-content backstop, and a conformance test against a vendored
chunk schema.

### Theme 6: the mirrors are already leaking, which settles the schema-first question

Runner A-9 argued the hand-mirrored contract has hit its ceiling. The Python evidence agrees.
The published JSON-Schema mirror has drifted from the real wire in five places, including a
phantom MCP `headers` credential field that no producer emits (wire B-5). The wire carries a
field that is dead on both ends yet defended by four tests (B-7). The permission vocabulary is
defined five times, the capability flags four times, and the hand-map defaults a missing flag to
`False` silently (B-9). Within Python alone, one wire field costs four hand-synced edits
(idioms 14). The migration was costed from this end: roughly a week, safely staged, and the
first two steps (fix the drifts, normalize the absence convention) pay for themselves now
(B-15).

### Theme 7: version skew and transport lifecycle are the client half of the runner blocker

The SDK never probes `/health`, still posts the deprecated `/run` alias, and sends no protocol
version, so skew between independently tagged images is undetectable until a bare 404
(architecture A-3, wire B-2, tests 5). The subprocess transport pipes stderr and never drains
it, so a chatty runner deadlocks the standalone-SDK path at 64KB and dies as a fake timeout
(B-3). The same env var means a total deadline on one transport and an idle timeout on the
other, read at import time in two places, so the deployed path has no real deadline at all
(A-5) — the client half of the runner's no-deadline blocker. And the SSE stream has no
keepalive, so a multi-minute silent tool run is proxy-killable while the run completes and bills
server-side (D-8). These are all small diffs with a natural home in `Backend.setup()` and one
timeout policy.

### Theme 8: hand-copied tables have already diverged

Two lanes independently caught the same live drift: the provider-to-env-var table exists three
times and `minimax` is present in only one, so a standalone user's MiniMax key silently resolves
to nothing (security C7, idioms 4). The same shape repeats: the default model and instructions
literal exists three times with a "kept in sync" comment naming files that do not contain it
(tracing E-2), and harness identity spans four registries plus per-backend sets (harness F-4,
architecture A-9). The fix is the pattern the codebase already proved with
`build_agent_v0_default()`: one owner, derived views, and a completeness test.

### What the Python side already fixed

Reconciliation also ran the other way, and three runner findings die here. Runner A-10 is
refuted in its strong form: the SDK always emits an explicit `permissions.default`, so the
runner's fallback is dead code for every SDK-produced request (confirmed by lanes A, B, C, and
E independently). Runner A-2's process-global env mutation has no Python equivalent: zero
`os.environ` writes exist. And runner Theme 6's scattered-boolean smear is largely refuted: the
residue is one filename branch in the port base and one Claude vocabulary in a shared module
(F-1, F-2), both one-line moves.

## Severity dashboard

| Lane | Blocker | High | Medium | Low |
|---|---:|---:|---:|---:|
| A — Architecture, boundaries, orchestration | 0 | 3 | 6 | 3 |
| B — Wire contract and DTOs | 0 | 4 | 8 | 4 |
| C — Tools, connections, secrets, MCP | 0 | 2 | 5 | 8 |
| D — Vercel stream adapter | 0 | 3 | 5 | 3 |
| E — Service config, schemas, tracing | 0 | 2 | 3 | 3 |
| F — Harness and platform adapters | 0 | 1 | 3 | 3 |
| G — Tests and QA | 0 | 3 | 3 | 4 |
| H — Python idioms and code quality | 0 | 3 | 9 | 5 |
| **Total** | **0** | **21** | **42** | **33** |

Test run (2026-07-07): 540 unit + 4 integration passed. The orphaned directory outside CI holds
5 passing tests and 1 crash on a stale path (Theme 2).

## The roadmap

The short-horizon items split into two groups: those that gate the launch because they break
tenant isolation, widen policy silently, or turn a recoverable failure into a wrong or invisible
result for the user, and those worth doing in launch week without blocking on them.

### Must gate the launch

1. **Gate the sandbox and permission axes in the service.** Whitelist sandbox ids, force Daytona
   for tenant runs, refuse `local` + `default:"allow"` on shared deployments, and stop seeding
   new agents onto `local` where the deployment is multi-tenant. This is the Python half of the
   runner's own launch gate. (C1, E-3.)
2. **Stop the silent permissive coercion of an unknown permission default.** Fail loud or coerce
   to `deny`; never widen. One line plus a test. (B-4, C8.)
3. **Close the three stream-adapter gaps.** The null-normalization gate at the yield boundary,
   the zero-content error backstop, and the frame-conformance test against a vendored ai@6
   chunk schema with the version pinned in CI. One malformed frame currently kills the whole
   turn; one empty run currently renders as a clean blank bubble. (D-1, D-2, D-3.)
4. **Fix the phantom `services/agent` defaults and re-integrate the orphaned tests.** Point the
   defaults at `services/runner`, log the template fallback, move
   `sdks/python/agenta/tests/agents/` under the pytest roots, and sweep the nine stale
   docstrings. (A-2, H-2, G-1, A-10, B-12.)
5. **Adopt the composition seam in the service.** Construct `AgentComposition` in `app.py`,
   extend `run_context` to see the request, delete the duplicated body, and add the first direct
   test of `make_agent_handler`. This removes a live behavioral fork on a public URI. (A-1,
   H-1, G-2.)
6. **Drain the subprocess transport's stderr.** The standalone-SDK path deadlocks on chatty
   runs today and reports it as a timeout. (B-3.)
7. **Mask the two unmasked secret fields.** `repr=False` on `SessionConfig.secrets` and
   `TraceContext.authorization`. Two lines. (C5.)
8. **Add the shared replay regression test.** Convert one captured QA `/run` pair into a
   Python-side replay through `result_from_wire`, `AgentStream`, and `fold`. This is the runner
   review's second blocker, confirmed as one shared gap. (G reconciliation.)
9. **Unify the provider-to-env table.** The minimax drift is live and fails a real user
   silently. One table, three imports, one completeness test. (C7, H-4.)
10. **Fix the MCP-flag documentation everywhere.** Eight docs and the runner's own comment state
    the wrong name and the wrong polarity for a security-relevant flag that is on by default.
    (C11, runner A-19.)

### Launch week, not launch-blocking

The `/health` probe, protocol check, and `/stream` switch in `Backend.setup()` (A-3, B-2). One
timeout policy with total and idle semantics enforced identically on both transports (A-5,
H-11). Decide-side refusals for code tools, stdio MCP, and Pi user-MCP before any secret
resolution runs (C4). Fail-closed capability lookups plus an import-time table-completeness
assert (F-3, A-6). The five schema-mirror drift fixes, led by deleting the phantom MCP `headers`
field from the published schema (B-5). Synthesizing the tool part before orphan `tool_result`
frames (D-4) and sanitizing the projection catch-all (D-6). Malformed `agent.json` handling in
the service (E-6). A direct test for `trace_context()` (G-3). The mypy-default and ruff ratchet:
12 errors buys a permanent type gate, and 849 autofixes end the style split (H-7). Validating
the terminal result against the existing `WireRunResult` so the schema models earn their keep at
runtime (H-8, B-11).

### Medium term (one to two months)

Split `dtos.py` and move the harness config classes into `adapters/`, which dissolves the one
layering inversion (B-8, H-5, A-7). Collapse the stream adapter's twin projections into one core
and point the tests at the live entry point (D-7, H-3). Introduce the typed exception spine
(`RunnerTransportError`, `AgentRunFailedError`) so callers stop string-matching (B-10, H-10).
Mint the scoped trace-ingest token and land the `platform` wire block with a deliberate golden
regeneration (C2, B-1, E-1, G-6). Normalize the wire absence convention (B-6). Tier the public
API: delete the dead dev aliases, export the live projection, lazy-load the Vercel egress (A-8,
H-6). Delete the dead provisioning channel and move the instructions filename onto the adapters
(A-4, F-1). One env accessor module and one shared httpx client (H-9, H-17). Wire `pytest-cov`
(G-9). The SSE keepalive if the launch proxy did not already force it (D-8). The secret-isolation
project takes provider keys and MCP headers out of the sandbox (C3).

### Long term (structural)

Run the schema-first contract migration: commit the runner-emitted schema artifact, generate the
Pydantic mirror, delete the 517 hand-kept lines. Costed at roughly a week from this side, safely
staged (B-15, H-14, runner A-9). Consolidate harness identity into one `HarnessProfile` registry
with derived views, shape-coordinated with the runner's table so the two can eventually share a
generated source (A-9, F-4). Regroup the flattened model fields and the free-floating `secrets`
bag on the next deliberate contract change (B-14). Revisit the `Sandbox`/`Environment` port
weight when `LocalBackend` lands (A-11, A-12, G-7).

## How to read the detail

Each lane's report carries file-and-line anchors, concrete failure scenarios, and a per-lane
top-10:

- `../findings/arch-boundaries.md` — the responsibility split, the duplicated seam, the ports,
  and the target structure with a migration path.
- `../findings/wire-contract-dtos.md` — the three mirrors, the field-role classification, and
  the costed schema-first migration.
- `../findings/tools-secrets-security.md` — where every secret travels, the missing policy
  gate, and the reconciliation with the runner's security findings.
- `../findings/vercel-stream.md` — the frame-by-frame verification against the real ai@6
  client, and the hard-fail correction to the brief.
- `../findings/service-config-tracing.md` — the credential producer, the config parsing, and
  the local-sandbox default.
- `../findings/harness-adapters.md` — the harness tables, the two knowledge leaks, and what
  adding a harness actually touches.
- `../findings/tests-qa.md` — the coverage map, the orphaned suite, and the shared replay-test
  gap.
- `../findings/python-idioms-quality.md` — the offenders table, the measured tooling ratchet,
  and the dead-surface cleanup.
