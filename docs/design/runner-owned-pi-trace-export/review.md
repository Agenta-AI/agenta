# Review

This file reviews the plan in this folder against the code it would change, and records the
decisions the owner made after that review. Every claim about current behavior cites the file and
line it came from. Read [README.md](README.md) first for the shape of the design; read this file
before starting Phase 0.

## Decisions taken by the owner

1. **The credential fix ships first, on its own branch.** The plan already contains it inside
   Phase 2. It moves out and lands alone, before any spool work, because it fixes long turns for
   Daytona Pi, Claude, and Codex by itself.
2. **Redaction moves into Pi, for every placement, with no exceptions.** The extension seeds its
   deny set from its own process environment and from the mount credentials the runner sends in the
   per-turn control file. Both mount credential pairs are included. The redaction mode is hardcoded
   in the extension. One shared builder produces the deny set, so the runner's own redactor and
   Pi's cannot drift.
3. **A cancelled turn still produces a trace.** Pi publishes whatever it holds when the turn is
   cancelled. The runner emits a minimal fallback span carrying the error and the usage totals
   whenever the drain finds nothing. There are no periodic partial batches.

The rest of this file explains why, lists the trims that shrink the plan, and names what is still
underspecified.

## Findings

### 1. The credential fix is correct, and it should not wait for the rest

**What the plan says.** Phase 2 refactors session credential handling into a
`PlatformCredentialLease`, then builds a new `RunnerTraceExportSink` that reads the lease before
every HTTP attempt (architecture.md:110-150, plan.md:55-90).

**What the code says.** The turn passes the request header to the tracer as a plain string
(`services/runner/src/engines/sandbox_agent/run-turn.ts:268`). The tracer freezes that string
(`services/runner/src/tracing/otel.ts:1224`) and registers it as the run's export target
(`otel.ts:1416`, and again on the error path at `otel.ts:1661`). The exporter cache is keyed on
endpoint plus credential (`otel.ts:212-231`), so a rotated credential would build a second cache
entry rather than update the first. A live credential getter already exists
(`services/runner/src/sessions/alive.ts:249`), refreshed every fifth heartbeat
(`alive.ts:225-232`), and the turn already holds a credential closure
(`run-turn.ts:107`).

**Decision.** Land this alone, first. Change `ExportTarget.authorization` to a getter. Resolve it
inside `TraceBatchProcessor.flush`, immediately before the export, so the credential-less skip and
the diagnostics both see the current value (`otel.ts:371-390`). Key the exporter cache on endpoint
alone and rebuild the entry when the resolved value changed. Pass the getter from
`run-turn.ts:107` instead of the string at `run-turn.ts:268`. Runs with no watchdog pass a closure
over the request credential, which reproduces today's behavior exactly.

**Severity.** Blocker for sequencing. The change itself is small and compiler enforced.

### 2. Redaction is missing from the plan, and the cutover would remove it from Daytona

**What the plan says.** Nothing. The word does not appear in any file in this folder.

**What the code says.** The runner redacts every string span attribute, every event attribute, and
the status message at the sink, immediately before export (`otel.ts:184-205`, applied at
`otel.ts:371-373`). The deny set is seeded from the request's typed credential values plus the
mount credentials (`run-turn.ts:270-280`, `services/runner/src/redaction.ts:436-470`). The
in-sandbox extension builds its tracer with no redactor at all
(`services/runner/src/extensions/agenta.ts:466-475`). Today a Daytona Pi run is traced by the
runner from the ACP stream (`run-turn.ts:279`), so its spans are redacted. After this plan's Phase
4, those spans come from the sandbox as opaque bytes and nothing checks them.

**Why the runner cannot fix it after the fact.** Forwarding the exact bytes and redacting them are
mutually exclusive unless the runner decodes the batch, and no decoder exists in the tree. The
pinned `@opentelemetry/otlp-transformer` ships a hand written protobuf writer and a response
deserializer only. There is no request decoder and there are no `.proto` descriptors anywhere in
`services/runner/node_modules`.

**Decision.** Pi redacts, on every placement. Three parts:

- **The machinery is already in the bundle.** The extension imports `otel.ts`, so the per-trace
  accumulator (`otel.ts:160-177`), the sink pass (`otel.ts:371-373`), and `redactSpan`
  (`otel.ts:184-205`) all ship inside `dist/extensions/agenta.js` today. Only the `Redactor` class
  is missing, because `otel.ts:59` imports it with `import type`, which the bundler erases.
  Confirmed against the built artifact: it contains the three `redactString` call sites and no
  other redaction symbol.
- **Provider keys cost nothing.** `curatedEnvSecretValues` seeds the values of every process
  environment variable whose name matches the suffix list (`redaction.ts:193-201`, list at
  `redaction.ts:117-134`). Called inside the sandbox it picks up the provider key the harness reads
  from its own environment (`services/runner/src/environment/runtime-lifecycle.ts:202`). When
  Daytona Secrets are active the variable holds a placeholder instead of the key
  (`services/runner/src/engines/sandbox_agent/daytona-secret-plan.ts:22-60`), so there is nothing
  to leak and nothing to do.
- **Mount credentials ride the control file.** They are not in Pi's environment today. On Daytona
  they are passed as the environment of the single process call that backgrounds geesefs
  (`services/runner/src/engines/sandbox_agent/mount.ts:669`, built at `mount.ts:236-243`), and
  deliberately kept out of argv. The sandbox can already read them from the geesefs process,
  because both run as the same user, so sending them to the extension exposes nothing new. Send
  them in the per-turn control file as read-once values, never as an environment variable: the
  Daytona daemon environment is frozen at sandbox creation (`runtime-lifecycle.ts:243-246`), the
  project already rejected plain environment delivery for this class of value
  (`services/runner/src/engines/sandbox_agent/pi-assets.ts:468-473`), and a variable in the
  harness's own environment would land in a span the moment the model runs `env`.

**Both credential pairs, not one.** `agentMountCreds`, the per-harness session and transcript mount
(`services/runner/src/engines/sandbox_agent/runtime-contracts.ts:294`, set at
`services/runner/src/engines/sandbox_agent/environment.ts:756`), is absent from the deny set today,
because `run-turn.ts:277-279` seeds only `env.mountCreds`. Add it on both sides.

**One builder, no drift.** Export a single helper next to `requestSecretValues`
(`redaction.ts:414-433`) that returns the sandbox-visible subset of the deny set. The control-file
writer and the runner's own `seedForRun` call at `run-turn.ts:274-280` both use it. The runner's
deny set stays a superset, because it also holds the run credential and its own environment
secrets, and neither of those can appear in a Pi span.

**Hardcode the mode.** `redactionMode` reads `AGENTA_REDACTION_MODE` from the process environment
(`redaction.ts:27-30`). Pass the mode explicitly in the extension so an operator's runner-side
"off" can never silently disable redaction inside a sandbox.

**Rotation.** On Daytona the re-sign and remount path returns early
(`services/runner/src/environment/mount-lifecycle.ts:357`), so an environment's mount credentials
are fixed for its life and the pool retires the environment when the lease expires
(`services/runner/src/environment/acquire-context.ts:88`). Sending the values every turn is
therefore correct and also future proof if Daytona ever gains re-signing.

**Cost and risk.** Roughly fifteen to twenty five lines on top of the control file the plan already
builds, plus about ten kilobytes on an eight hundred kilobyte bundle. False positives are already
bounded by the library: four characters minimum for whole-value variants, eight plus word-boundary
matching for decomposed halves, and a junk allowlist (`redaction.ts:243-262`, `:93-110`). Empty
values are skipped, so an absent session token is a no-op. Cost at flush is a handful of
`String.includes` passes per attribute, which the runner already pays for every other harness.

**Severity.** Blocker.

### 3. A cancelled or killed turn must still produce a trace

**What the plan says.** The only loss case listed is the runner stopping after pickup
(architecture.md:230).

**What the code says.** Today an aborted turn still exports, because the spans live in the runner
and the catch path flushes them (`run-turn.ts:1245`), including the standalone error span
(`otel.ts:1645-1667`). After Phase 4 sets `emitSpans: !plan.isPi`, an aborted Daytona turn has no
spans anywhere except inside a sandbox that may already be gone.

**Decision.** Pi publishes what it holds when the prompt is cancelled. The runner emits its minimal
fallback span, carrying the run error and the usage totals it already resolved, whenever the drain
finds no batch. No periodic partial batches: the processor deliberately sends one trace as one
batch because Agenta computes cumulative token and cost rollups per ingest batch
(`otel.ts:288-295`), and splitting a turn across batches loses the root aggregation. State that
reason in architecture.md next to the failure table so nobody reintroduces checkpointing.

**Severity.** Should, and it is the main functional regression the cutover would otherwise cause.

## Trims

These shrink the plan without changing its shape.

### 4. Reuse the OTel exporter with a thin bytes post

**What the plan says.** A new `RunnerTraceExportSink` owns HTTP, timeout, retry, diagnostics, and
credential lookup (interfaces.md:186-205).

**What the code says.** The existing path already has the timeout, the diagnostics, the
credential-less skip for Agenta's own ingest, and per-run target attribution
(`otel.ts:216-231`, `otel.ts:355-390`), all covered by existing tests.

**Recommendation.** Keep `OTLPTraceExporter`. Add one thin function that posts pre-serialized bytes
for the spool case. Severity: should.

### 5. Do not rewrite the tool relay

**What the plan says.** Phase 1 extracts a `RuntimeFileHost` and rebuilds `relay.ts` on top of it
(plan.md:32-50).

**What the code says.** The sandbox file API is already binary safe: `readFsFile` returns a
`Uint8Array`, `writeFsFile` takes a body, and `moveFs` is a same-directory rename
(`services/runner/node_modules/sandbox-agent/dist/index.d.ts:3249-3253`, used at
`services/runner/src/tools/relay.ts:310-325`). The relay only decodes UTF-8 on top
(`relay.ts:310-316`).

**Recommendation.** Add the small byte host for telemetry alone. Let the relay adopt it later, or
never. `relay.ts` is eight hundred and fifty four lines of hard-won behavior and this fix does not
need to touch it. Severity: should.

### 6. Put the spool beside the relay directory

**What the plan says.** A new runtime IPC root, with the relay migrated under it
(architecture.md:60-76).

**What the code says.** The relay directory is already ephemeral, off the durable mount, and keyed
per conversation (`services/runner/src/engines/sandbox_agent/run-plan.ts:645-651`), chosen that way
because a relay inside the mount routes every tool call through FUSE. Its stale sweep only removes
relay-suffixed names (`relay.ts:495-502`).

**Recommendation.** Use a sibling directory with the same key. Severity: nice.

### 7. Allow several files per turn

**What the plan says.** One accepted file per turn in version 1 (interfaces.md:160-170).

**What the code says.** The processor flushes per trace id and also fires on its own whenever a
span with no in-process parent ends (`otel.ts:308-318`), which is exactly a run started without a
caller traceparent. The error path can flush a second batch (`otel.ts:1661-1665`).

**Recommendation.** Accept a sequence in the filename, with a bounded count, and drain every file
until the turn ends. Severity: should.

### 8. Serialize parent first

**What the plan says.** "Serializes the batch", with no ordering rule (architecture.md:128-140).

**What the code says.** The export sends `orderParentFirst(group)` (`otel.ts:370`, helper at
`otel.ts:440-460`) because Agenta stores millisecond timestamps and attaches a span only when its
parent was already seen.

**Recommendation.** Serialize the ordered array, and assert the tree survives the round trip in the
Phase 0 fixture test. Severity: should.

### 9. The size limit is ten megabytes, and the runner needs its own cap

**What the plan says.** Mirror the API's configured maximum (interfaces.md:168).

**What the code says.** The API default is ten megabytes (`api/oss/src/utils/env.py:357`), while the
endpoint docstring still claims four (`api/oss/src/apis/fastapi/otlp/router.py:100`). The runner
cannot read the API's environment.

**Recommendation.** Add a runner-side maximum with a default below the ingest limit, check the size
before reading the file, and fix the stale docstring. Severity: should.

### 10. Add the consumer to the bundle leak gate

**What the plan says.** The Pi exporter and the runner consumer live in the same directory
(plan.md:96-100).

**What the code says.** `services/runner/scripts/build-extension.mjs` fails the build when a
runner-side symbol reaches the sandbox bundle, and it currently lists three.

**Recommendation.** Add the spool consumer's exported name to that list in the same pull request.
Severity: nice.

### 11. Keep the per-turn usage reset, and test it

**What the plan says.** One line about resetting per-turn counters (plan.md:141-143).

**What the code says.** The run totals object is created once per extension instance
(`otel.ts:725`) and never resets, so in a warm session every later turn stamps cumulative totals on
its agent span and writes cumulative totals to the file the runner reads back as that turn's usage
(`services/runner/src/engines/sandbox_agent/usage.ts:6-26`).

**Recommendation.** This is a real bug fix, and it changes reported numbers. Give it its own test
covering turn two of a warm session, and check whether the turn ledger or any cost rollup depends
on the old behavior. Severity: should.

### 12. Drop the compatibility flag

**What the plan says.** An exclusive feature flag or a capability handshake if the runner and the
extension can drift (status.md:48-50, interfaces.md:210-222).

**What the code says.** They cannot drift. The runner installs its own bundle from its own build
output on the local path (`pi-assets.ts:706`, `pi-assets.ts:850`) and uploads that same bundle into
the sandbox on the Daytona path (`services/runner/src/engines/sandbox_agent/daytona.ts:234`).

**Recommendation.** Delete the flag from the plan. Keep one diagnostic instead: if the control file
is still present when the turn ends, Pi never read it. Severity: nice.

### 13. Drop the serializer spike

**What the plan says.** Phase 0 must discover which serializer to use (status.md:44-47).

**What the code says.** `ProtobufTraceSerializer.serializeRequest` is a public export of
`@opentelemetry/otlp-transformer` (`build/src/index.d.ts:6`, contract at `i-serializer.d.ts`). Two
corrections to research.md: the installed version is 0.219.0, not 0.220.0, and it arrives
transitively through `exporter-trace-otlp-proto@0.220.0`.

**Recommendation.** Pin it as a direct dependency, record the seam in status.md, and shrink Phase 0
to a fixture test. Bundle size is not a new risk, since the extension already bundles the OTLP
exporter and its protobuf dependencies. Severity: nice.

## Trust and blast radius

A prompt-injected sandbox can write any bytes into the spool, so the runner forwards attacker
controlled protobuf under its own credential. The bounds are worth stating precisely, because they
are better than they look.

- It cannot cross projects. The ingest takes project, organization, and user from the credential
  (`api/oss/src/apis/fastapi/otlp/router.py:110-118`, `:253-258`).
- It cannot smuggle identity in the payload. The parser walks straight to spans and discards
  resource and scope entirely (`api/oss/src/apis/fastapi/otlp/opentelemetry/otlp.py:129-131`), so no
  resource attribute is read by anything.
- It can overwrite spans inside the caller's own project. Storage upserts on the primary key
  project, trace, and span, and updates every other column on conflict
  (`api/oss/src/dbs/postgres/tracing/dao.py:104-127`). The sandbox knows the caller's trace id and
  parent span id from its own traceparent, so it can overwrite the caller's own root span.
- This is still strictly less authority than today's local Pi, which holds a reusable bearer and can
  post anywhere the caller can reach.

Record this in architecture.md as the accepted position. If a later change adds a decoder for any
reason, add two checks in the same pass: the batch's trace id equals the turn's expected trace id,
and no span id equals the caller's parent span id.

## Idempotency

A retried export is safe and needs no extra machinery. Storage upserts on the span key
(`dao.py:104-127`), so a resent batch overwrites rather than duplicates. The paid counter only
counts spans with no parent (`otlp/router.py:217`), and a Pi batch nested under the caller's
traceparent contains none. Keep the retry bounded anyway, and say this in architecture.md so nobody
builds a deduplication layer that is not needed.

## Still underspecified

1. **Framing.** One export request per file needs no framing, but that only holds once several
   files per turn are allowed. Say it, rather than leaving it implied.
2. **Encoding.** Say raw bytes, no base64 wrapper, and cite that the sandbox read returns a byte
   array so nothing forces a text round trip.
3. **Partial writes.** Write to a temporary sibling and rename. Cite the existing proof that the
   sandbox move is a real rename (`relay.ts:318-322`) instead of restating it as an assumption.
4. **Cleanup.** Nobody owns deleting the spool directory when the environment is released, and
   nothing says what happens to a file Pi writes after the consumer stopped. Sweep at teardown and
   at the start of every turn, and log the leftover rather than deleting it silently.
5. **An unread control file.** Decide what the runner does when the control file is still present at
   drain time. That is the one signal that separates "Pi failed" from "Pi never got the turn".

## Carry-overs from the span record design

Three pieces of `docs/design/agent-trace-export/` survive this plan and should be folded into it.

1. **The credential getter, as specified there.** Its Step 2 names the call sites, the exporter
   cache rule, and the tests, including that a getter returning empty against Agenta's own ingest
   must still skip the export and log the skip.
2. **Release gate coverage.** Its Step 6 adds a `trace` journey to the agent release gate that
   asserts on structure: exactly one agent span, a turn span parented to it, a model span carrying
   the request model and non-zero total tokens, one tool span per reported tool call with a matching
   call id, and no secret value in any attribute. Run it on local Pi, Daytona Pi, and local Claude.
   Add its `trace_long` journey too, which holds one turn open past the credential's life. This
   folder's qa.md has strong unit coverage but leaves live verification manual.
3. **The explicit redaction point.** That design names redaction as a first-class requirement. This
   one did not, which is how the gap in finding 2 stayed invisible.

## Verdict

The design is sound and its core claim holds: Pi should keep producing spans, and the runner should
be the only component that sends them.
Two findings had to be resolved before implementation, and the owner resolved both: redaction moves
into Pi on every placement, and a cancelled turn still produces a trace.
The credential fix leaves Phase 2 and ships first, alone, because it repairs long turns for three
harnesses without any of the spool work.
Two of the plan's open questions are already answered by the code, which removes the serializer
spike and the compatibility flag outright.
With the trims applied, the remaining work is smaller than the plan currently describes: a small
byte host, a control file, a spool consumer, and a cutover.
