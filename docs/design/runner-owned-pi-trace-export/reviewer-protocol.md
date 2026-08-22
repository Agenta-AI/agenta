# Reviewer protocol: runner-owned Pi trace export

Use this protocol to review the implementation PR. The PR targets
`release/v0.114.0` and depends on:

- #6217 for refreshed platform credentials at the runner export boundary.
- #6218 for preserving Secret token timing and authentication errors.

Review those contracts before judging the credential behavior in this PR.

## Intended result

Pi still creates its native span tree. Pi does not send the spans over the
network. At the end of a turn, Pi serializes a standard OTLP protobuf request
and atomically publishes the bytes to a private telemetry directory. The runner
picks up those bytes and sends them through its normal OTLP endpoint and
credential boundary.

Local and Daytona use the same protocol and runner consumer. Only the file host
adapter changes:

- Local uses bounded file-descriptor reads on the shared filesystem.
- Daytona bounds the read inside the sandbox and also caps the sandbox process
  response before decoding it in the runner.

## Scope boundaries

The PR intentionally does not add:

- a longer-lived Pi credential;
- an endpoint or authorization header in the Pi control file;
- a custom trace DTO or a second trace schema;
- an exporter-specific 401 retry protocol;
- a feature flag;
- a separate Daytona export path.

If any of those appear in the diff, treat the change as a scope regression.

## Review order

### 1. Standard byte format

Read these files first:

- `src/tracing/otel.ts`
- `src/tracing/pi-file-exporter.ts`
- `src/tracing/pi-spool-protocol.ts`
- `src/extensions/agenta.ts`

Verify that Pi serializes an OTLP `ExportTraceServiceRequest` and writes the
exact protobuf bytes. The extension must instantiate the atomic file transport. Its bundle must not
contain the runner-only `exportOtlpBytes` helper or spool consumer; it may share the tracer
and standard OTLP serializer with runner tracing.

Run:

```bash
cd services/runner
pnpm run build:extension
pnpm exec vitest run --project unit \
  tests/unit/otel-trace-serialization.test.ts \
  tests/unit/pi-file-exporter.test.ts \
  tests/unit/pi-spool-protocol.test.ts \
  tests/unit/extension-tools.test.ts
```

### 2. Process boundary and secrets

Read:

- `src/engines/sandbox_agent/run-turn.ts`
- `src/engines/sandbox_agent/pi-assets.ts`
- `src/redaction.ts`

Verify these invariants:

- The Pi control file contains capture policy, propagation, skills, known
  redaction values, and a random channel ID.
- It contains no OTLP endpoint and no authorization value.
- Runner and mount credentials are included in known-value redaction.
- The control file is published atomically and consumed once per turn.
- A warm Pi session resets its tracer and usage state before the next turn.

### 3. Local and Daytona adapters

Read:

- `src/engines/sandbox_agent/workspace.ts`
- `src/tracing/telemetry-file-host.ts`
- `src/tracing/pi-spool-consumer.ts`

Verify that both placements create the same telemetry directory shape and feed
the same consumer. Confirm the limits remain bounded: four batches per turn,
8 MiB per batch, bounded directory listings, and bounded reads. Pickup deletes
the file before network export so a later poll cannot forward it twice.

Run:

```bash
cd services/runner
pnpm exec vitest run --project unit \
  tests/unit/telemetry-file-host.test.ts \
  tests/unit/pi-spool-consumer.test.ts \
  tests/unit/sandbox-agent-workspace.test.ts
```

### 4. Runner-owned authorization and lifecycle

Read:

- `src/engines/sandbox_agent/runtime-policy.ts`
- `src/tracing/pi-trace-turn-export.ts`
- `src/tracing/otlp-bytes-export.ts`
- `src/engines/sandbox_agent/environment.ts`
- `src/engines/sandbox_agent/run-turn.ts`

Verify that Agenta ingest reads the current platform authorization immediately
before export. A third-party collector must keep its configured exporter
authorization and must never receive the platform token.

Trace finalization must cover normal completion, cancellation, an approval
pause, approval resume, and parked-environment eviction. A resumed approval must
keep the original Pi trace ID. The runner may emit its fallback span only when
Pi produced no valid batch, and the fallback callback must be idempotent.

Run:

```bash
cd services/runner
pnpm exec vitest run --project unit \
  tests/unit/otel-bytes-export.test.ts \
  tests/unit/pi-trace-turn-export.test.ts \
  tests/unit/sandbox-agent-orchestration.test.ts \
  tests/unit/session-keepalive-approval.test.ts
```

## Full validation

Run from `services/runner`:

```bash
pnpm run typecheck
pnpm run test:unit
pnpm run build:extension
```

The implementation run passed 138 unit files: 2,276 tests passed and 7 existing
tests remained marked as expected failures. Typecheck and the extension build
also passed.

## Live acceptance

Drive `/services/agent/v0/invoke` once with `pi_core` and `sandbox=local`, then
once with `pi_core` and `sandbox=daytona`. For each run:

1. Capture the `messageMetadata.traceId` from the SSE stream.
2. Find one `stage=pi_trace_spool_export` runner log with the matching trace
   suffix, the expected placement, `outcome=exported`, and `status=200`.
3. Fetch `/api/tracing/traces/{trace_id}` with a key for the same project.
4. Confirm the stored trace contains Pi-native span names such as `pi`, `chat`,
   and `turn 0`.

The implementation run persisted both paths:

- Local: `89ce156bd188780fb61b8f7853ffc350`.
- Daytona: `d7cc51df721601b355e02af617b2f583`.

The shared OpenAI test secret did not produce a successful model response in
that run. This does not invalidate the export evidence because both Pi native
batches were exported and fetched back from storage. Repeat the model-response
portion with a working project credential before treating the broader Pi run as
a release-gate pass.
