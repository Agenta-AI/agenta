# Implementation plan

Six pull requests. Each one is independently useful and independently revertible. The order
front-loads the fix: step 2 stops long turns from losing traces on every placement, before any
of the architecture work lands.

Every step lists the files it touches, the tests that prove it, and how to verify it by hand.

---

## Step 1: untangle the stack and salvage the two good API fixes

**Why first.** Pull request 6164 (`write-only-secrets-api`) is based on `fix/otlp-per-turn-credential`,
not on `main`, so it currently carries all five of the rejected branch's commits. Nothing else can
proceed cleanly until that base moves. Two changes on the rejected branch are worth keeping and
belong on `main` on their own.

**Do.**

1. Close pull request 6135 as rejected, with a comment pointing at this workspace.
2. Rebase `write-only-secrets-api` onto `main`, dropping the five commits `d99a8115cd`,
   `9e82494e08`, `c09a75ad44`, `88e2f68ad0`, `f20bede3cb`. Re-target the pull request base to
   `main`.
3. Open a small pull request against `main` with only the two salvaged fixes:
   - the `iat` claim on every Secret token (`api/oss/src/middlewares/auth.py`, in
     `sign_secret_token`),
   - the `except HTTPException: raise` guard placed before the catch-all in
     `verify_secret_token`, so a 401 is not turned into a 500.
4. Fix the one file on another lane that depends on the rejected work:
   `api/oss/tests/pytest/unit/access/test_grant_exchange.py` imports `TRACE_INGEST_SCOPE` and
   asserts on `body["telemetry_credentials"]`. Both go away. Drop the assertion and the import.

**Files.** `api/oss/src/middlewares/auth.py`,
`api/oss/tests/pytest/unit/middlewares/test_auth_secret_token.py`,
`api/oss/tests/pytest/unit/access/test_grant_exchange.py`.

**Tests.** A case asserting `iat` is present and `exp - iat` equals the default expiry. A case
asserting an expired token yields 401 rather than 500. Run
`cd api && py-run-tests --layer unit`.

**Verify by hand.** `git log --oneline main..write-only-secrets-api` shows only that pull
request's own commits.

**Risk.** Low. The rebase is mechanical. The one cross-lane test import is known and named above.

---

## Step 2: resolve the export credential at export time

**Why.** This alone fixes long turns for Daytona Pi, Claude, and Codex, which are already
runner-exported. It needs none of the record work.

**Do.** Change `ExportTarget.authorization` from `string | undefined` to
`(() => string | undefined) | undefined` in `services/runner/src/tracing/otel.ts`. Resolve it in
`TraceBatchProcessor.flush`, immediately before the export, so the credential-less-export skip
and the export diagnostics both see the current value. Key the exporter cache by endpoint alone
and hold the credential the entry was built with; rebuild the entry when the resolved value
differs. Do not shut down an evicted exporter eagerly, so a rotation cannot cancel an export
already on the wire.

Feed it from the alive watchdog. `run-turn.ts` passes a string today
(`services/runner/src/engines/sandbox_agent/run-turn.ts:280`). Pass the watchdog's
`credential` getter instead (`services/runner/src/sessions/alive.ts:193`, `:249`), which the
records emitter already uses. Runs with no watchdog pass a closure over `runCredential(request)`,
which reproduces today's behavior for those runs. Confirm the watchdog handle is in scope at the
`createSandboxAgentOtel` call site and thread it through the turn if it is not.

**Files.** `services/runner/src/tracing/otel.ts`,
`services/runner/src/engines/sandbox_agent/run-turn.ts`, and whichever of
`services/runner/src/server.ts` or `services/runner/src/engines/sandbox_agent/runtime-contracts.ts`
carries the watchdog handle into the turn.

**Tests.** New `services/runner/tests/unit/otel-credential-refresh.test.ts`:

- the getter is called at export time, not at run start (assert call ordering against a counter),
- a credential that changes between run start and flush exports with the later value,
- the exporter cache holds one entry per endpoint across three rotations, not three,
- a getter returning empty against Agenta's own ingest still skips the export and logs
  `outcome: "skipped"`, preserving the rule at `otel.ts:340-347`.

Use the existing exporter-capture helper `services/runner/tests/utils/otel-export.ts`, which
spies on the shared exporter base prototype because the module builds instances from an internal
cache. Update `services/runner/tests/unit/otel-trace-target-attribution.test.ts` and
`otel-export-diagnostics.test.ts` for the new type.

Run: `cd services/runner && pnpm run test:unit` and `pnpm run typecheck`.

**Verify by hand.** On the local dev stack, start a Pi Daytona run, wait past the 15 minute
token life inside a single turn (a long-running tool works), and confirm the trace lands. Before
this step the same run exports with an expired token and Agenta rejects the batch.

**Risk.** Low and contained to the runner. The type change is compiler-enforced across every
call site.

---

## Step 3: the span record contract and the extension writer

**Why.** Ship the producer before the consumer, so the record file can be inspected on a real
run before anything depends on it.

**Do.**

1. Add `services/runner/src/tracing/span-records.ts`: the `SpanRecord` types, a `parseSpanRecord`
   that validates the envelope and returns a typed record or a drop reason, and the shared
   constant for the environment variable name.
2. Rewrite `createAgentaOtel` in `services/runner/src/tracing/otel.ts:675-925` into
   `createSpanRecordWriter`. Keep every hook: `before_agent_start`, `agent_start`, `context`,
   `turn_start`, `before_provider_request`, `message_end`, `tool_execution_start`,
   `tool_execution_end`, `turn_end`, `agent_end`. Keep the usage accumulator, which the usage
   writeback still needs. Replace `tracer.startSpan` with a pending map keyed by the harness's
   own ids, and on each unit's end append one line with `appendFileSync`.
3. In `services/runner/src/extensions/agenta.ts`, replace the `hasTracing` gate
   (`:444-446`) with a gate on the record path variable, drop the `createOtlpAuthRefresher` hook
   and the `otel.flush()` on `agent_end`, and keep the usage writeback unchanged.
4. In `services/runner/src/engines/sandbox_agent/pi-assets.ts`, set
   `AGENTA_AGENT_SPAN_RECORD_PATH` in `buildPiExtensionEnv` beside
   `AGENTA_AGENT_USAGE_CAPTURE_PATH`, on both placements. Add `spanRecordPath` to the run plan
   next to `usageOutPath` (`run-plan.ts:721`).
5. Remove the OpenTelemetry SDK and OTLP exporter imports from the extension bundle's dependency
   graph, and confirm the built bundle shrank.

**Files.** `services/runner/src/tracing/span-records.ts` (new),
`services/runner/src/tracing/otel.ts`, `services/runner/src/extensions/agenta.ts`,
`services/runner/src/engines/sandbox_agent/pi-assets.ts`,
`services/runner/src/engines/sandbox_agent/run-plan.ts`.

**Tests.** New `services/runner/tests/unit/span-record-writer.test.ts`. Drive the real extension
factory against a fake `ExtensionAPI` built as a plain object literal, the way
`services/runner/tests/unit/extension-tools.test.ts:65` builds `fakePi`. Write to a temp file
and read the lines back. Cases:

- a turn with one model call and two tool calls produces exactly four records with the parent
  links `turn -> null`, `chat -> turn`, `tool -> turn`,
- a failed tool call sets `isError` and a failed assistant message sets `error`,
- `AGENTA_AGENT_CONTENT_CAPTURE_ENABLED=false` omits `inputMessages`, `outputMessages`, `input`,
  and `output`, and keeps every other field,
- with no record path set, the extension writes nothing and still writes the usage file,
- every emitted line parses as JSON and round-trips through `parseSpanRecord`.

Commit the expected lines as fixtures under `services/runner/tests/fixtures/span-records/`, and
have both this test and step 4's reader test read the same files, so the producer and the
consumer can never drift against different copies. This mirrors how the wire contract goldens are
shared between `sdks/python/oss/tests/pytest/unit/agents/golden/` and the runner's
`tests/utils/golden.ts`.

Run: `cd services/runner && pnpm run test:unit`.

**Verify by hand.** Run a local Pi turn on the dev stack, then read
`$TMPDIR/agenta/relay/<cwd-basename>/.agenta-spans.jsonl`. Traces still export from inside the
sandbox at this step, so nothing user-visible changes yet.

**Risk.** Medium. This rewrites the extension's tracing half. The mitigation is that its output
is not consumed yet, so a defect shows up in the file and in tests rather than in a user's trace.

---

## Step 4: the runner drains, materializes, and exports

**Why.** This is the change. Everything before it is preparation, everything after it is cleanup.

**Do.**

1. Add the drain to `services/runner/src/tracing/span-records.ts`:
   `createSpanRecordDrain({ host, path, onRecord })`, holding a byte offset, reading through
   `RelayHost.read` (`services/runner/src/tools/relay.ts:227-261`), consuming only up to the last
   newline, and leaving a partial tail for the next pass.
2. Add `applySpanRecord(record)` to `createSandboxAgentOtel` in
   `services/runner/src/tracing/otel.ts`. Map records to spans per the table in `design.md`,
   resolve `parent` through an id-to-span map, hold orphans in a pending map and attach any
   leftovers to the root at the end of the drain, clamp timestamps into the root's interval, and
   stamp the `ag.meta.trace.*` counters on the root.
3. Replace `emitSpans` with `spanSource: "records" | "acp"`
   (`services/runner/src/tracing/otel.ts:1153-1159`) and set it at the call site
   (`run-turn.ts:293`) as `plan.isPi ? "records" : "acp"`, with an operator override
   `AGENTA_RUNNER_SPAN_SOURCE` read through `services/runner/src/env.ts`.
4. Wire the turn lifecycle in `run-turn.ts`: remove the record file and reset the offset when the
   turn is dispatched (replacing the `refreshOtlpAuthFile` call at `:263-271`), drain every 2
   seconds while the turn runs, drain once more after the prompt resolves at the point
   `readRunUsage` is called (`:1149-1156`), then `finish()` and `await flush()`.
5. Add the budgets `AGENTA_RUNNER_SPAN_RECORD_MAX_BYTES` (default 262144) and
   `AGENTA_RUNNER_SPAN_RECORD_MAX_PER_TURN` (default 5000) through `services/runner/src/env.ts`,
   which clamps a bad override rather than trusting it.
6. Delete the in-sandbox export path: `writeOtlpAuthFile` and `readOtlpAuthFile`,
   `AGENTA_AGENT_OTLP_AUTH_FILE`, `otlpAuthFilePath` on the plan and in
   `services/runner/src/environment/runtime-lifecycle.ts:215-219`, the `<relayDir>.otlp-auth`
   file, and `TRACEPARENT` and `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` from `buildPiExtensionEnv`
   (`pi-assets.ts:488-492`).

**Files.** `services/runner/src/tracing/span-records.ts`,
`services/runner/src/tracing/otel.ts`,
`services/runner/src/engines/sandbox_agent/run-turn.ts`,
`services/runner/src/engines/sandbox_agent/pi-assets.ts`,
`services/runner/src/environment/runtime-lifecycle.ts`, `services/runner/src/env.ts`,
`services/runner/src/engines/sandbox_agent/run-plan.ts`.

**Tests.** New `services/runner/tests/unit/span-record-drain.test.ts`:

- a file written in three appends is drained in three passes with no duplicates and no gaps,
- a partial tail line is not consumed and is consumed on the next pass once completed,
- a malformed line is skipped and counted, and the lines after it still apply,
- an unknown `type` and an unknown `v` are skipped and counted,
- a record over the byte budget has its content attributes truncated and is counted,
- the per-turn cap stops materialization and counts the rest,
- the drain works identically against a fake `RelayHost` whose `read` returns the whole file, so
  the Daytona path is covered without a sandbox.

New `services/runner/tests/unit/span-record-spans.test.ts`, reading the same fixtures step 3
produced:

- the fixture turn materializes as `invoke_agent` with a `turn 0` child, a `chat <model>` child
  of the turn, and two `execute_tool <name>` children of the turn,
- span names, `openinference.span.kind`, and every `gen_ai.*` key match what the current
  in-sandbox builder produces for the same run,
- a record whose `parent` never arrives attaches to the root and increments
  `ag.meta.trace.records.orphaned`,
- a record with times outside the root's interval is clamped and sets
  `ag.meta.trace.clock_clamped`,
- `spanSource: "acp"` ignores records entirely, and `spanSource: "records"` builds no spans from
  ACP updates while still building the `AgentEvent` log from them.

Extend `services/runner/tests/unit/wire-contract.test.ts` only if a wire field moved. It should
not have.

Run: `cd services/runner && pnpm run test:unit && pnpm run typecheck`, then
`pnpm run test:integration` and `pnpm run test:acceptance`.

**Verify by hand.** On the dev stack, run one local Pi turn and one Daytona Pi turn, then query
the trace and compare the tree against a trace captured before the change. Confirm no
`.otlp-auth` file is created, and confirm `env` inside the sandbox contains no `TRACEPARENT`, no
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, and no Agenta credential.

**Risk.** High, and it is the step to be careful on. See the risk table below.

---

## Step 5: delete the rejected credential surface from the API, the SDK, and the wire

**Why.** After step 4 nothing reads any of it. Doing it separately keeps step 4's diff about
tracing.

**Do.** Delete everything listed under "From pull request 6135, all of it" in `design.md`, minus
the two salvaged fixes step 1 already landed. Since pull request 6135 is closed, most of this is
a matter of confirming the surface never reached `main`. What did reach other lanes, or reaches
`main` on its own, is:

- `OtlpExporter.exportAuthorization` in `services/runner/src/protocol.ts`, if it landed,
- the `exportAuthorization` key in
  `sdks/python/oss/tests/pytest/unit/agents/golden/run_request.pi_core.json`,
- the SDK fields in `sdks/python/agenta/sdk/agents/dtos.py`,
  `wire_models.py`, `contexts/tracing.py`, `decorators/running.py`, `decorators/routing.py`, and
  `middlewares/routing/auth.py`.

A changed golden is a contract change. Update `protocol.ts` and `KNOWN_REQUEST_KEYS` in the same
pull request and read the golden diff before committing.

**Files.** As listed. Then `ruff format` and `ruff check --fix` in `sdks/python` and `api`.

**Tests.** `cd sdks/python && py-run-tests --layer unit`, `cd api && py-run-tests --layer unit`,
`cd services/runner && pnpm run test:unit`. The two wire contract tests must agree:
`sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py` and
`services/runner/tests/unit/wire-contract.test.ts`, which reads the same golden files by relative
path.

**Risk.** Low, but the golden change touches both sides of the wire and must land atomically.

---

## Step 6: release gate coverage for trace trees

**Why.** The agent release gate has no tracing coverage at all today. Every cell and journey in
`.agents/skills/agent-release-gate/resources/` asserts on the streamed frames, on stored side
effects read back through the REST API, or on runner log lines. Nothing queries a span. This
design changes where every span comes from, so the gate needs a fourth evidence channel.

**Do.** Add a `trace` journey to `JOURNEYS` in
`.agents/skills/agent-release-gate/resources/qa_product.py`. It runs one turn that provokes a
model call and at least one tool call, captures the `trace_id` the `/invoke` response already
carries, polls until the spans are ingested, and asserts on the tree.

Model the polling on `api/oss/tests/pytest/utils/polling.py`, which already handles
asynchronous ingest against `/tracing/spans/query` and `/tracing/traces/{id}`. The endpoint shapes
are documented by `api/oss/tests/pytest/acceptance/tracing/test_traces_preview.py`.

Assert on structure, never on prose:

- exactly one `invoke_agent` span with kind `AGENT`,
- at least one `turn` span with kind `CHAIN`, parented to it,
- at least one `chat` span with kind `LLM`, carrying `gen_ai.request.model` and non-zero
  `gen_ai.usage.total_tokens`,
- one `execute_tool` span per tool call the stream reported, with matching
  `gen_ai.tool.call.id`,
- no span attribute contains the run's API key or any value from the run's secret set.

Run it on three cells, which together cover both placements and both span sources:

| Cell | Harness and placement | Proves |
| --- | --- | --- |
| `C3` | `pi_core`, local | The record path replaces the in-sandbox exporter with no loss of richness. |
| `C4` | `pi_core`, Daytona | The identical record path works over the Daytona filesystem API, and the tree gains the model call detail it did not have. |
| `C1` | `claude`, local | The ACP-derived path is unchanged. |

Add a second journey, `trace_long`, that holds one turn open past the run credential's 15 minute
life and asserts the trace still lands. That is the case pull request 6135 could not satisfy, and
it is the one that must not regress.

Note for whoever runs the gate: `.agents/skills/agent-release-gate/SKILL.md` says `qa_product.py`
is broken with unresolved conflict markers. That is stale. The file has no conflict markers and
the cell definitions are clean. Fix the line while you are in there.

**Files.** `.agents/skills/agent-release-gate/resources/qa_product.py`,
`.agents/skills/agent-release-gate/resources/qa_matrix_lib.py` (a `trace_tree` helper next to
`turn_ledger`), `.agents/skills/agent-release-gate/resources/coverage.md`,
`.agents/skills/agent-release-gate/SKILL.md`.

**Risk.** Low. Test-only, and it adds coverage that does not exist.

---

## Step 7: documentation

Apply the `keep-docs-in-sync` skill. The changes that reach a reader:

- The self-hosting reference loses `AGENTA_AGENT_OTLP_AUTH_FILE` and gains
  `AGENTA_RUNNER_SPAN_SOURCE`, `AGENTA_RUNNER_SPAN_RECORD_MAX_BYTES`, and
  `AGENTA_RUNNER_SPAN_RECORD_MAX_PER_TURN`.
- Any page stating that a local Pi sandbox needs network access to Agenta's OTLP endpoint is now
  wrong. It does not.
- Any page describing what crosses into a sandbox should say that no Agenta credential does.
- The interface inventory gains the span record contract and its version.

---

## Rollout

**One operator switch, one release.** `AGENTA_RUNNER_SPAN_SOURCE` accepts `records` or `acp` and
overrides the per-harness default. Setting it to `acp` puts every run back on the ACP-derived
tracer without a code change or a rollback, at the cost of the model call detail. It exists so a
tracing regression found in production is a restart, not a redeploy.

Remove the switch one release after step 4 ships clean.

**No feature flag on the wire.** The wire field removal in step 5 is compatible in both
directions. A newer runner receiving `exportAuthorization` from an older SDK ignores it. An older
runner receiving a request without it falls back to `runCredential(request)`, which is what it
did before pull request 6135 existed. So the SDK and the runner can ship in either order.

**Ship order across steps.** Steps 1 and 2 can go out immediately and independently. Step 3 is
dark and can go out with step 2. Steps 4, 5, 6, and 7 go out together as one release, because
step 4 is the behavior change and steps 5 through 7 describe it.

---

## Risks

| Risk | Why it could happen | What we do about it |
| --- | --- | --- |
| The trace tree changes shape on the local Pi path, and a user notices before we do. | The span builder moves from the extension to the runner. A missed attribute is invisible until someone opens a trace. | Step 4's span test asserts every span name, kind, and `gen_ai.*` key against fixtures captured from the current builder. Step 6 asserts the tree on a live deployment. The `acp` switch is the escape hatch. |
| Records are written but never drained, so a trace has only a root span. | A path mismatch, or a permission problem on the record file. | The runner stamps `ag.meta.trace.records.applied` on every root span. A root with zero applied records and a non-empty ACP tool call list logs a diagnostic. That makes the condition queryable rather than invisible. |
| A long turn buffers too many spans and the runner runs out of memory. | A 12 hour turn with thousands of tool calls, each `chat` record repeating the full context. | `AGENTA_RUNNER_SPAN_RECORD_MAX_PER_TURN` and `AGENTA_RUNNER_SPAN_RECORD_MAX_BYTES`, both clamped through `services/runner/src/env.ts`. The behavior itself is not new: every runner-exported path buffers a whole turn today. |
| Daytona clock skew produces child spans outside the root's interval. | The sandbox and the runner are different machines. | The runner clamps record times into the root's interval and stamps `ag.meta.trace.clock_clamped`, so the tree renders and the skew is visible. |
| The extra Daytona daemon calls slow a turn down. | One `deleteFsEntry` per turn plus one `readFsFile` every 2 seconds. | The tool relay already polls the same directory at 300 ms backing off to 1500 ms (`services/runner/src/tools/relay.ts:107-119`), so the added load is a fraction of what is already there. If it still shows up, fold the drain into the relay poll loop rather than running a second timer. |
| Pull request 6164's rebase drops something it needed from the rejected branch. | It was written on top of it. | Step 1 rebases before anything else, and the two changes it genuinely needed (`iat` and the exception guard) land on `main` first. |
| A malicious sandbox floods the record file. | The relay directory is sandbox-writable by design. | The per-turn cap bounds it, the runner sets every attribute key itself, and the worst outcome is noise in a trace whose content the same agent already controls. `design.md` has the full table. |
